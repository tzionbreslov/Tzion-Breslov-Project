import type { SubscribeTopic } from "../../lib/api-contract";
import { PublicError, requireBinding, type Env } from "./types";

type TurnstileResult = {
  success?: boolean;
  hostname?: string;
  action?: string;
};

async function providerFetch(url: string, init: RequestInit, provider: string) {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new PublicError("UPSTREAM_FAILURE", `${provider} returned ${response.status}`);
  }
  return response;
}

// Cloudflare's documented always-pass test secret answers with hostname
// "example.com" and no action, so the action/hostname checks can't pass
// locally. Skip them only for that secret AND a localhost-only origin list,
// so a misconfigured production Worker can never take this path.
const TURNSTILE_TEST_SECRET = "1x0000000000000000000000000000000AA";

function isLocalTestSetup(env: Env) {
  const origins = (env.ALLOWED_ORIGINS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  return env.TURNSTILE_SECRET_KEY === TURNSTILE_TEST_SECRET
    && origins.length > 0
    && origins.every((origin) => /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin));
}

export async function validateTurnstile(env: Env, token: string, remoteIp: string, requestId: string, action: string) {
  const body = new FormData();
  body.set("secret", requireBinding(env, "TURNSTILE_SECRET_KEY"));
  body.set("response", token);
  if (remoteIp) body.set("remoteip", remoteIp);
  body.set("idempotency_key", requestId);

  const response = await providerFetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body
  }, "Turnstile");
  const result = await response.json<TurnstileResult>();
  if (result.success && isLocalTestSetup(env)) return;
  const expectedHostnames = requireBinding(env, "TURNSTILE_EXPECTED_HOSTNAMES").split(",").map((value) => value.trim()).filter(Boolean);
  if (!result.success || result.action !== action || !result.hostname || !expectedHostnames.includes(result.hostname)) {
    throw new PublicError("BOT_CHALLENGE_FAILED");
  }
}

/**
 * A Resend call that hasn't answered within 10 s has failed: UPSTREAM_FAILURE,
 * safe to retry (every email carries an idempotency key, and a topic opt-in can
 * be repeated). It bounds how long an RSVP attempt holds its seats unconfirmed
 * while it emails the guest (database.ts, PENDING_STALE_MS), and keeps an
 * RSVP's two emails inside the 30 s the runtime gives its waitUntil work after
 * a visitor disconnects (index.ts, handleRsvp).
 */
const RESEND_TIMEOUT_MS = 10_000;

async function resendRequest(env: Env, apiKeyName: "RESEND_TRANSACTIONAL_API_KEY" | "RESEND_CONTACTS_API_KEY", path: string, init: RequestInit) {
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${requireBinding(env, apiKeyName)}`);
  headers.set("Content-Type", "application/json");
  try {
    return await fetch(`https://api.resend.com${path}`, { ...init, headers, signal: AbortSignal.timeout(RESEND_TIMEOUT_MS) });
  } catch (error) {
    // The timeout answers as an error status would; any other failure is left as it was.
    if ((error as { name?: unknown } | null)?.name === "TimeoutError") throw new PublicError("UPSTREAM_FAILURE", "Resend timed out");
    throw error;
  }
}

export async function sendEmail(
  env: Env,
  input: { to: string; subject: string; text: string; replyTo?: string; idempotencyKey: string }
) {
  const response = await resendRequest(env, "RESEND_TRANSACTIONAL_API_KEY", "/emails", {
    method: "POST",
    headers: { "Idempotency-Key": input.idempotencyKey },
    body: JSON.stringify({
      from: requireBinding(env, "RESEND_FROM_EMAIL"),
      to: [input.to],
      subject: input.subject,
      text: input.text,
      ...(input.replyTo ? { reply_to: input.replyTo } : {})
    })
  });
  if (!response.ok) throw new PublicError("UPSTREAM_FAILURE", `Resend email returned ${response.status}`);
}

const TOPIC_IDS: Record<SubscribeTopic, "RESEND_NEWSLETTER_TOPIC_ID" | "RESEND_EVENTS_TOPIC_ID"> = {
  newsletter: "RESEND_NEWSLETTER_TOPIC_ID",
  events: "RESEND_EVENTS_TOPIC_ID"
};

/**
 * Opt a confirmed email into the chosen Resend topics (the newsletter, the
 * "Event announcements"), creating the contact if needed. Only the chosen
 * topics' ids are required, and other topics are left as they are.
 */
export async function subscribeToTopics(env: Env, email: string, chosen: SubscribeTopic[]) {
  const topics = chosen.map((topic) => ({ id: requireBinding(env, TOPIC_IDS[topic]), subscription: "opt_in" }));
  const createResponse = await resendRequest(env, "RESEND_CONTACTS_API_KEY", "/contacts", {
    method: "POST",
    body: JSON.stringify({ email, unsubscribed: false, topics })
  });
  if (createResponse.ok) return;
  if (createResponse.status !== 409) {
    throw new PublicError("UPSTREAM_FAILURE", `Resend contacts returned ${createResponse.status}`);
  }

  const updateResponse = await resendRequest(
    env,
    "RESEND_CONTACTS_API_KEY",
    `/contacts/${encodeURIComponent(email)}/topics`,
    { method: "PATCH", body: JSON.stringify({ topics }) }
  );
  if (!updateResponse.ok) throw new PublicError("UPSTREAM_FAILURE", `Resend topics returned ${updateResponse.status}`);
}

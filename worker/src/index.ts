import {
  API_PATHS,
  CONFIRMATION_TOKEN_PATTERN,
  SUBSCRIPTION_QUERY,
  SUBSCRIPTION_QUERY_PARAM,
  SUBSCRIPTION_TOKEN_FRAGMENT_PARAM,
  TURNSTILE_ACTIONS,
  type ApiErrorResponse,
  type ContactSuccessResponse,
  type RsvpAvailabilityResponse,
  type RsvpSuccessResponse,
  type SubscribeConfirmSuccessResponse,
  type SubscribeSuccessResponse,
  type SubscriptionQueryStatus
} from "../../lib/api-contract";
import { formatEventWhen } from "../../lib/events.mjs";
import { sha256Hex, verifyResendSignature } from "./crypto";
import {
  cancelRsvp,
  claimRequest,
  cleanExpiredData,
  createSubscriptionConfirmation,
  enforceRateLimit,
  findSubscriptionConfirmation,
  finishRequest,
  markSubscriptionConfirmationUsed,
  reserveRsvp,
  rsvpGuestTotals,
  storeWebhookEvent
} from "./database";
import { findRsvpEvent, loadEventFeed, type FeedEvent } from "./events";
import { sendEmail, subscribeToTopics, validateTurnstile } from "./providers";
import { PublicError, requireBinding, type Env } from "./types";
import {
  readJson,
  subscribeTopics,
  validateContact,
  validateRsvp,
  validateSubscription,
  validateSubscriptionConfirmation,
  type RsvpInput
} from "./validation";

type JsonObject = Record<string, unknown>;
type ExecutionContextLike = Pick<ExecutionContext, "waitUntil">;

const publicPostRoutes = new Set<string>([API_PATHS.contact, API_PATHS.subscribe, API_PATHS.subscribeConfirm, API_PATHS.rsvp]);

function allowedOrigins(env: Env) {
  return new Set(env.ALLOWED_ORIGINS.split(",").map((value) => value.trim()).filter(Boolean));
}

function requestOrigin(request: Request, env: Env) {
  const origin = request.headers.get("origin") ?? "";
  if (!origin || !allowedOrigins(env).has(origin)) throw new PublicError("ORIGIN_NOT_ALLOWED");
  return origin;
}

function responseHeaders(origin = "") {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    "Content-Type": "application/json; charset=utf-8",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Permissions-Policy": "accelerometer=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "X-XSS-Protection": "0"
  });
  if (origin) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  }
  return headers;
}

function json(body: JsonObject, status = 200, origin = "") {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders(origin) });
}

/** Hardened headers for a response a browser navigates to (no JSON body). */
function navigationHeaders() {
  const headers = responseHeaders();
  headers.delete("Content-Type");
  return headers;
}

function logError(correlationId: string, request: Request, error: unknown) {
  const field = error instanceof PublicError ? error.field : undefined;
  console.error(JSON.stringify({
    correlationId,
    method: request.method,
    path: new URL(request.url).pathname,
    error: error instanceof PublicError ? error.code : error instanceof Error ? error.name : "UnknownError",
    ...(field ? { field } : {})
  }));
}

function preflight(request: Request, env: Env) {
  const origin = requestOrigin(request, env);
  const requestedMethod = request.headers.get("access-control-request-method") ?? "";
  const requestedHeaders = (request.headers.get("access-control-request-headers") ?? "").toLowerCase();
  if (requestedMethod !== "POST" || requestedHeaders.split(",").map((value) => value.trim()).filter(Boolean).some((value) => value !== "content-type")) {
    throw new PublicError("CORS_REQUEST_REJECTED");
  }
  const headers = responseHeaders(origin);
  headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type");
  headers.set("Access-Control-Max-Age", "600");
  headers.delete("Content-Type");
  return new Response(null, { status: 204, headers });
}

function remoteIp(request: Request) {
  return request.headers.get("CF-Connecting-IP")?.trim() ?? "unknown";
}

async function privateHash(env: Env, purpose: string, value: string) {
  const salt = requireBinding(env, "RATE_LIMIT_SALT");
  if (salt.length < 32) throw new PublicError("SERVICE_NOT_CONFIGURED", "RATE_LIMIT_SALT must be at least 32 characters");
  return sha256Hex(`${salt}:${purpose}:${value}`);
}

async function rateLimitValue(env: Env, route: string, purpose: "ip" | "email", value: string, limit: number) {
  const hash = await privateHash(env, purpose, value);
  await enforceRateLimit(env, `${route}:${purpose}:${hash}`, limit, 600);
  return hash;
}

async function idempotent(
  env: Env,
  requestId: string,
  route: "contact" | "subscribe",
  operation: () => Promise<JsonObject>
) {
  const claim = await claimRequest(env, requestId, route);
  if (claim.state === "completed") return claim.response;
  if (claim.state === "processing") throw new PublicError("REQUEST_IN_PROGRESS");
  try {
    const response = await operation();
    await finishRequest(env, requestId, true, response);
    return response;
  } catch (error) {
    await finishRequest(env, requestId, false);
    throw error;
  }
}

function confirmationRedirectUrl(env: Env) {
  try {
    const url = new URL(requireBinding(env, "SUBSCRIPTION_CONFIRMATION_REDIRECT_URL"));
    if (!allowedOrigins(env).has(url.origin)) throw new Error("origin");
    return url;
  } catch {
    throw new PublicError("SERVICE_NOT_CONFIGURED", "SUBSCRIPTION_CONFIRMATION_REDIRECT_URL must be on an allowed origin");
  }
}

async function handleContact(request: Request, env: Env, origin: string) {
  const input = validateContact(await readJson(request));
  await rateLimitValue(env, "contact", "ip", remoteIp(request), 20);
  const response = await idempotent(env, input.requestId, "contact", async () => {
    await validateTurnstile(env, input.turnstileToken, remoteIp(request), input.requestId, TURNSTILE_ACTIONS.contact);
    await rateLimitValue(env, "contact", "email", input.email, 4);
    const organizationName = requireBinding(env, "ORGANIZATION_NAME");
    const fullName = [input.firstName, input.lastName].filter(Boolean).join(" ");
    const message = [
      `New contact form submission for ${organizationName}`,
      "",
      `First name: ${input.firstName || "Not provided"}`,
      `Last name: ${input.lastName || "Not provided"}`,
      `Email: ${input.email}`,
      `Phone: ${input.phone || "Not provided"}`,
      `Address: ${input.address || "Not provided"}`,
      "",
      "Message:",
      input.message,
      "",
      `Request ID: ${input.requestId}`
    ].join("\n");
    await sendEmail(env, {
      to: requireBinding(env, "CONTACT_TO_EMAIL"),
      subject: `${organizationName} contact form: ${fullName || input.email}`,
      text: message,
      replyTo: input.email,
      idempotencyKey: `contact/${input.requestId}`
    });
    return { ok: true, requestId: input.requestId } satisfies ContactSuccessResponse;
  });
  return json(response, 202, origin);
}

async function handleSubscription(request: Request, env: Env, origin: string) {
  const input = validateSubscription(await readJson(request));
  await rateLimitValue(env, "subscribe", "ip", remoteIp(request), 15);
  const response = await idempotent(env, input.requestId, "subscribe", async () => {
    await validateTurnstile(env, input.turnstileToken, remoteIp(request), input.requestId, TURNSTILE_ACTIONS.subscribe);
    await rateLimitValue(env, "subscribe", "email", input.email, 3);
    const token = await privateHash(env, "subscription-confirmation", input.requestId);
    const tokenHash = await sha256Hex(token);
    // The token derives from requestId alone and a retry keeps the first attempt's row,
    // so a reused requestId with another email must not get that row's link mailed to it.
    const storedEmail = await createSubscriptionConfirmation(env, input, tokenHash);
    if (!storedEmail || storedEmail !== input.email) throw new PublicError("REQUEST_ID_CONFLICT");
    const confirmationUrl = new URL(API_PATHS.subscribeConfirm, requireBinding(env, "PUBLIC_API_URL"));
    confirmationUrl.searchParams.set("token", token);
    const organizationName = requireBinding(env, "ORGANIZATION_NAME");
    await sendEmail(env, {
      to: storedEmail,
      subject: `Confirm your ${organizationName} email subscription`,
      text: [
        "Hello,",
        "",
        `Please confirm that you would like to receive email updates from ${organizationName}: open this link within 24 hours, then press "Confirm my subscription" on our website.`,
        confirmationUrl.toString(),
        "",
        "If you did not request this, you can ignore this message and you will not be subscribed."
      ].join("\n"),
      replyTo: env.RESEND_REPLY_TO_EMAIL?.trim() || undefined,
      idempotencyKey: `subscribe-confirm/${input.requestId}`
    });
    return { ok: true, requestId: input.requestId, confirmationRequired: true } satisfies SubscribeSuccessResponse;
  });
  return json(response, 202, origin);
}

/**
 * `GET /v1/subscribe/confirm?token=…`, the emailed link. Navigation only: mail
 * and link scanners pre-fetch links, so this never subscribes anyone, and a
 * person opening it never sees JSON. It 303s to the site, which asks for an
 * explicit click (the POST below). The token rides in the fragment, so it never
 * reaches the site's server or a Referer.
 */
async function handleSubscriptionConfirmationLink(request: Request, env: Env) {
  let target: URL;
  try {
    target = confirmationRedirectUrl(env);
  } catch (error) {
    const correlationId = crypto.randomUUID();
    logError(correlationId, request, error);
    const headers = navigationHeaders();
    headers.set("Content-Type", "text/plain; charset=utf-8");
    return new Response(
      `Subscription confirmation is temporarily unavailable. Please try the link again later. (Reference: ${correlationId})\n`,
      { status: 500, headers }
    );
  }

  const token = new URL(request.url).searchParams.get("token") ?? "";
  let status: SubscriptionQueryStatus = SUBSCRIPTION_QUERY.invalid;
  try {
    if (CONFIRMATION_TOKEN_PATTERN.test(token)) {
      const confirmation = await findSubscriptionConfirmation(env, await sha256Hex(token));
      if (confirmation) status = confirmation.used_at ? SUBSCRIPTION_QUERY.confirmed : SUBSCRIPTION_QUERY.confirm;
    }
  } catch (error) {
    logError(crypto.randomUUID(), request, error);
    status = SUBSCRIPTION_QUERY.error;
  }

  target.searchParams.set(SUBSCRIPTION_QUERY_PARAM, status);
  if (status === SUBSCRIPTION_QUERY.confirm) {
    target.hash = new URLSearchParams({ [SUBSCRIPTION_TOKEN_FRAGMENT_PARAM]: token }).toString();
  }
  const headers = navigationHeaders();
  headers.set("Location", target.toString());
  return new Response(null, { status: 303, headers });
}

/** `POST /v1/subscribe/confirm`: the visitor pressed "Confirm my subscription" on the site. */
async function handleSubscriptionConfirmation(request: Request, env: Env, origin: string) {
  const { token } = validateSubscriptionConfirmation(await readJson(request));
  await rateLimitValue(env, "subscribe-confirm", "ip", remoteIp(request), 30);
  const confirmation = await findSubscriptionConfirmation(env, await sha256Hex(token));
  if (!confirmation) throw new PublicError("INVALID_CONFIRMATION");
  // Opt in first, then mark used: if Resend fails, the same token still works on retry.
  if (!confirmation.used_at) {
    await subscribeToTopics(env, confirmation.email, storedTopics(confirmation.topics_json));
    await markSubscriptionConfirmationUsed(env, confirmation.id);
  }
  return json({ ok: true } satisfies SubscribeConfirmSuccessResponse, 200, origin);
}

/** The lists stored with a pending signup; anything unreadable is the newsletter (the only list before 0002). */
function storedTopics(topicsJson: string) {
  try {
    return subscribeTopics(JSON.parse(topicsJson));
  } catch {
    return subscribeTopics(undefined);
  }
}

/**
 * Calendar text in an email subject or a "Label: value" line: one line, no
 * control or bidi characters, at most 200 characters.
 */
function oneLine(value: string) {
  // eslint-disable-next-line no-control-regex
  const flat = value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]+/gu, " ").replace(/\s+/g, " ").trim();
  return flat.length > 200 ? `${flat.slice(0, 199)}…` : flat;
}

type Email = Parameters<typeof sendEmail>[1];

/** The guest's "RSVP received" and the organizer's "New RSVP" (plain text). */
function rsvpEmails(env: Env, input: RsvpInput, event: FeedEvent, confirmationId: string): { guest: Email; organizer: Email } {
  const organizationName = requireBinding(env, "ORGANIZATION_NAME");
  const title = oneLine(event.title);
  const when = formatEventWhen(event);
  const guests = String(input.guests);
  const guest: Email = {
    to: input.email,
    subject: `RSVP received: ${title}`,
    text: [
      `Hello ${input.name},`,
      "",
      `Thank you for your RSVP to ${organizationName}. We look forward to seeing you.`,
      "",
      `Event: ${title}`,
      `When: ${when}`,
      `Guests: ${guests}`,
      `Confirmation ID: ${confirmationId}`,
      "",
      "If your plans change, reply to this email."
    ].join("\n"),
    replyTo: env.RESEND_REPLY_TO_EMAIL?.trim() || undefined,
    idempotencyKey: `rsvp-guest/${input.requestId}`
  };
  const organizer: Email = {
    to: requireBinding(env, "CONTACT_TO_EMAIL"),
    subject: `New RSVP: ${title}`,
    text: [
      `New RSVP for ${organizationName}`,
      "",
      `Event: ${title}`,
      `When: ${when}`,
      `Name: ${input.name}`,
      `Email: ${input.email}`,
      `Guests: ${guests}`,
      "",
      "Accessibility or dietary needs:",
      input.accessibility || "None given",
      "",
      `Confirmation ID: ${confirmationId}`,
      `Request ID: ${input.requestId}`
    ].join("\n"),
    replyTo: input.email,
    idempotencyKey: `rsvp-organizer/${input.requestId}`
  };
  return { guest, organizer };
}

/**
 * The guest first, then the organizer: the organizer never hears of an RSVP
 * the guest wasn't told about.
 * - The guest's email fails (or can't be built): the seats are given back and
 *   the visitor gets the retryable error; a retry with the same requestId books
 *   and mails again (Resend's idempotency keys stop a second copy).
 * - Only the organizer's fails: the guest already holds "RSVP received" and its
 *   confirmation id, so the booking stands. It is logged (a code and the
 *   requestId, no personal data; the row is found by request_id) and the RSVP
 *   succeeds, so a replay returns the same id and sends nothing new.
 */
async function sendRsvpEmails(env: Env, input: RsvpInput, event: FeedEvent, confirmationId: string) {
  let organizer: Email;
  try {
    const emails = rsvpEmails(env, input, event, confirmationId);
    organizer = emails.organizer;
    await sendEmail(env, emails.guest);
  } catch (error) {
    await cancelRsvp(env, confirmationId).catch((cancelError: unknown) => {
      // The seats stay taken and a replay would answer 202 without any email: say so in the logs.
      console.error(JSON.stringify({
        code: "RSVP_CANCEL_FAILED",
        requestId: input.requestId,
        error: cancelError instanceof PublicError ? cancelError.code : cancelError instanceof Error ? cancelError.name : "UnknownError"
      }));
    });
    throw error;
  }
  try {
    await sendEmail(env, organizer);
  } catch (error) {
    console.error(JSON.stringify({
      code: "RSVP_ORGANIZER_EMAIL_FAILED",
      requestId: input.requestId,
      error: error instanceof PublicError ? error.code : error instanceof Error ? error.name : "UnknownError"
    }));
  }
}

/**
 * `POST /v1/rsvp`. Never touches request_log (its route CHECK is live in
 * production): rsvps.request_id is the idempotency key.
 */
async function handleRsvp(request: Request, env: Env, origin: string) {
  const input = validateRsvp(await readJson(request));
  await rateLimitValue(env, "rsvp", "ip", remoteIp(request), 30);
  // After the challenge, so a failed one can't use up someone's email quota (as contact and subscribe).
  await validateTurnstile(env, input.turnstileToken, remoteIp(request), input.requestId, TURNSTILE_ACTIONS.rsvp);
  const emailHash = await rateLimitValue(env, "rsvp", "email", input.email, 6);
  const event = findRsvpEvent(await loadEventFeed(env), input.eventId);
  if (!event) throw new PublicError("EVENT_NOT_FOUND");
  if (Date.now() >= Date.parse(event.startsAt)) throw new PublicError("EVENT_CLOSED");
  const reservation = await reserveRsvp(env, input, event, emailHash);
  if (reservation.created) await sendRsvpEmails(env, input, event, reservation.id);
  return json({ ok: true, requestId: input.requestId, confirmationId: reservation.id } satisfies RsvpSuccessResponse, 202, origin);
}

/**
 * `GET /v1/rsvp/availability`: for each event that takes RSVPs, whether it is
 * full and how many places remain (null = no limit). Counts only. Readable
 * cross-origin by the site's origins only; cacheable for 60 s.
 */
async function handleRsvpAvailability(request: Request, env: Env) {
  const requested = request.headers.get("origin") ?? "";
  const origin = requested && allowedOrigins(env).has(requested) ? requested : "";
  const open = (await loadEventFeed(env)).filter((event) => event.rsvp === "open");
  const totals = await rsvpGuestTotals(env, open.filter((event) => event.limit !== null).map((event) => event.id));
  const events: RsvpAvailabilityResponse["events"] = {};
  for (const event of open) {
    const remaining = event.limit === null ? null : Math.max(0, event.limit - (totals.get(event.id) ?? 0));
    events[event.id] = { full: remaining === 0, remaining };
  }
  const headers = responseHeaders(origin);
  headers.set("Cache-Control", "public, max-age=60");
  headers.set("Vary", "Origin");
  return new Response(JSON.stringify({ ok: true, events } satisfies RsvpAvailabilityResponse), { status: 200, headers });
}

async function readWebhookBody(request: Request) {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > 262_144) throw new PublicError("REQUEST_TOO_LARGE");
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > 262_144) throw new PublicError("REQUEST_TOO_LARGE");
  return body;
}

function webhookIdentity(rawBody: string) {
  try {
    const value: unknown = JSON.parse(rawBody);
    if (!value || typeof value !== "object") throw new Error("shape");
    const record = value as Record<string, unknown>;
    if (typeof record.id !== "string" || typeof record.type !== "string" || record.id.length > 200 || record.type.length > 200) throw new Error("fields");
    return { id: record.id, type: record.type };
  } catch {
    throw new PublicError("INVALID_WEBHOOK");
  }
}

/** Verified audit log of Resend delivery/bounce/complaint/contact events (svix-signed). */
async function handleResendWebhook(request: Request, env: Env) {
  const rawBody = await readWebhookBody(request);
  const valid = await verifyResendSignature(
    rawBody,
    request.headers.get("svix-id") ?? "",
    request.headers.get("svix-timestamp") ?? "",
    request.headers.get("svix-signature") ?? "",
    requireBinding(env, "RESEND_WEBHOOK_SECRET")
  );
  if (!valid) throw new PublicError("INVALID_WEBHOOK_SIGNATURE");
  const event = webhookIdentity(rawBody);
  await storeWebhookEvent(env, "resend", event.id, event.type, rawBody);
  return json({ ok: true });
}

async function route(request: Request, env: Env) {
  const url = new URL(request.url);
  if (request.method === "OPTIONS" && publicPostRoutes.has(url.pathname)) return preflight(request, env);

  if (request.method === "GET" && url.pathname === "/health") {
    await env.DB.prepare("SELECT 1").first();
    return json({ ok: true });
  }
  if (request.method === "GET" && url.pathname === API_PATHS.subscribeConfirm) {
    return handleSubscriptionConfirmationLink(request, env);
  }
  if (request.method === "GET" && url.pathname === API_PATHS.rsvpAvailability) return handleRsvpAvailability(request, env);
  if (request.method === "POST" && url.pathname === "/webhooks/resend") return handleResendWebhook(request, env);

  if (request.method === "POST" && publicPostRoutes.has(url.pathname)) {
    const origin = requestOrigin(request, env);
    if (url.pathname === API_PATHS.contact) return handleContact(request, env, origin);
    if (url.pathname === API_PATHS.subscribe) return handleSubscription(request, env, origin);
    if (url.pathname === API_PATHS.subscribeConfirm) return handleSubscriptionConfirmation(request, env, origin);
    if (url.pathname === API_PATHS.rsvp) return handleRsvp(request, env, origin);
  }

  throw new PublicError("NOT_FOUND");
}

async function fetchHandler(request: Request, env: Env) {
  const correlationId = crypto.randomUUID();
  try {
    return await route(request, env);
  } catch (error) {
    const publicError = error instanceof PublicError ? error : new PublicError("INTERNAL_ERROR");
    logError(correlationId, request, error);
    const origin = request.headers.get("origin") ?? "";
    const safeOrigin = origin && allowedOrigins(env).has(origin) ? origin : "";
    const body: ApiErrorResponse = {
      ok: false,
      error: publicError.code,
      correlationId,
      ...(publicError.code === "INVALID_INPUT" && publicError.field ? { field: publicError.field } : {})
    };
    return json(body, publicError.status, safeOrigin);
  }
}

export default {
  fetch(request: Request, env: Env, _context: ExecutionContextLike) {
    return fetchHandler(request, env);
  },
  scheduled(_controller: ScheduledController, env: Env, context: ExecutionContextLike) {
    context.waitUntil(cleanExpiredData(env));
  }
};

export { fetchHandler };

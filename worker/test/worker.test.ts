import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sha256Hex, verifyResendSignature } from "../src/crypto";
import worker, { fetchHandler } from "../src/index";

const origin = "https://site.test";

type OutboundCall = { url: string; method: string; body: unknown; headers: Headers };

function publicRequest(path: string, body: Record<string, unknown>, ip = "203.0.113.10", requestOrigin = origin) {
  return new Request(`https://api.test${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: requestOrigin,
      "CF-Connecting-IP": ip
    },
    body: JSON.stringify(body)
  });
}

type Payload = Record<string, unknown> & { requestId: string; email: string; message: string };

function envelope(overrides: Record<string, unknown> = {}) {
  const now = Date.now();
  return {
    requestId: crypto.randomUUID(),
    website: "",
    startedAt: now - 2_000,
    submittedAt: new Date(now).toISOString(),
    "cf-turnstile-response": "XXXX.DUMMY.TOKEN.XXXX",
    ...overrides
  } as Record<string, unknown> as Payload;
}

function uniqueEmail() {
  return `visitor-${crypto.randomUUID()}@example.test`;
}

function contactPayload(overrides: Record<string, unknown> = {}) {
  return envelope({
    firstName: "Ada",
    lastName: "Lovelace",
    email: uniqueEmail(),
    phone: "+1 202 555 0100",
    address: "12 Analytical Way, London",
    message: "I would like to learn more about your classes.",
    ...overrides
  });
}

function subscribePayload(overrides: Record<string, unknown> = {}) {
  return envelope({ email: uniqueEmail(), ...overrides });
}

/**
 * Stubs Turnstile siteverify and the Resend API on globalThis.fetch.
 * `action` is what Turnstile reports the token was issued for.
 */
function mockProviders(action: string, options: { contactsCreateStatus?: number; emailStatus?: number } = {}) {
  const calls: OutboundCall[] = [];
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    const rawBody = init?.body;
    const body = typeof rawBody === "string" ? JSON.parse(rawBody) : rawBody;
    calls.push({ url, method, body, headers: new Headers(init?.headers) });
    if (url.includes("/turnstile/v0/siteverify")) {
      return Response.json({ success: true, hostname: "localhost", action });
    }
    if (url === "https://api.resend.com/emails") {
      const status = options.emailStatus ?? 200;
      return Response.json(status === 200 ? { id: "email-id" } : { message: "failure" }, { status });
    }
    if (url === "https://api.resend.com/contacts" && method === "POST") {
      const status = options.contactsCreateStatus ?? 200;
      return Response.json(status === 200 ? { id: "contact-id" } : { message: "exists" }, { status });
    }
    if (url.startsWith("https://api.resend.com/contacts/") && method === "PATCH") {
      return Response.json({ id: "contact-id" });
    }
    throw new Error(`Unexpected outbound request: ${method} ${url}`);
  });
  return {
    spy,
    calls,
    emails: () => calls.filter((call) => call.url === "https://api.resend.com/emails"),
    contacts: () => calls.filter((call) => call.url.startsWith("https://api.resend.com/contacts")),
    turnstile: () => calls.filter((call) => call.url.includes("/turnstile/"))
  };
}

async function errorBody(response: Response) {
  return response.json<{ ok: boolean; error: string; correlationId: string; field?: string }>();
}

async function count(table: string) {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first<{ count: number }>();
  return row?.count ?? -1;
}

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM subscription_confirmations"),
    env.DB.prepare("DELETE FROM request_log"),
    env.DB.prepare("DELETE FROM rate_limits"),
    env.DB.prepare("DELETE FROM webhook_events")
  ]);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("HTTP boundary", () => {
  it("reports healthy D1 access with hardened headers", async () => {
    const response = await fetchHandler(new Request("https://api.test/health"), env);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(response.headers.get("permissions-policy")).toContain("payment=()");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
  });

  it("rejects public requests from unknown or missing origins without CORS headers", async () => {
    const outbound = mockProviders("contact");
    for (const path of ["/v1/contact", "/v1/subscribe", "/v1/subscribe/confirm"]) {
      const response = await fetchHandler(publicRequest(path, contactPayload(), "203.0.113.10", "https://attacker.test"), env);
      expect(response.status).toBe(403);
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
      expect((await errorBody(response)).error).toBe("ORIGIN_NOT_ALLOWED");
    }
    const noOrigin = new Request("https://api.test/v1/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(contactPayload())
    });
    expect((await fetchHandler(noOrigin, env)).status).toBe(403);

    const preflight = await fetchHandler(new Request("https://api.test/v1/contact", {
      method: "OPTIONS",
      headers: {
        Origin: "https://attacker.test",
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type"
      }
    }), env);
    expect(preflight.status).toBe(403);
    expect(preflight.headers.get("access-control-allow-origin")).toBeNull();
    expect(outbound.calls).toHaveLength(0);
    expect(await count("request_log")).toBe(0);
  });

  it("answers a constrained CORS preflight for allowed origins", async () => {
    for (const path of ["/v1/contact", "/v1/subscribe", "/v1/subscribe/confirm"]) {
      const response = await fetchHandler(new Request(`https://api.test${path}`, {
        method: "OPTIONS",
        headers: {
          Origin: origin,
          "Access-Control-Request-Method": "POST",
          "Access-Control-Request-Headers": "content-type"
        }
      }), env);
      expect(response.status).toBe(204);
      expect(response.headers.get("access-control-allow-origin")).toBe(origin);
      expect(response.headers.get("access-control-allow-methods")).toBe("POST, OPTIONS");
      expect(response.headers.get("access-control-allow-credentials")).toBeNull();
    }
    const extraHeader = await fetchHandler(new Request("https://api.test/v1/contact", {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": "content-type, authorization"
      }
    }), env);
    expect(extraHeader.status).toBe(403);
  });

  it("keeps removed RSVP and payment routes closed", async () => {
    const rsvp = await fetchHandler(publicRequest("/v1/rsvp", envelope({ email: uniqueEmail(), eventId: "x", guests: 1 })), env);
    expect(rsvp.status).toBe(404);
    const rsvpPreflight = await fetchHandler(new Request("https://api.test/v1/rsvp", {
      method: "OPTIONS",
      headers: { Origin: origin, "Access-Control-Request-Method": "POST" }
    }), env);
    expect(rsvpPreflight.status).toBe(404);
    expect((await fetchHandler(publicRequest("/v1/checkout", {}), env)).status).toBe(404);
    expect((await fetchHandler(new Request("https://api.test/webhooks/stripe", { method: "POST", body: "{}" }), env)).status).toBe(404);
  });

  it("rejects JSON lookalike content types", async () => {
    const request = publicRequest("/v1/contact", contactPayload());
    request.headers.set("Content-Type", "application/jsonp");
    const response = await fetchHandler(request, env);
    expect(response.status).toBe(415);
    expect((await errorBody(response)).error).toBe("UNSUPPORTED_CONTENT_TYPE");
  });
});

describe("POST /v1/contact", () => {
  it("verifies Turnstile, emails the inbox with every field, and deduplicates by requestId", async () => {
    const outbound = mockProviders("contact");
    const payload = contactPayload();
    const first = await fetchHandler(publicRequest("/v1/contact", payload), env);
    expect(first.status).toBe(202);
    expect(first.headers.get("access-control-allow-origin")).toBe(origin);
    await expect(first.json()).resolves.toEqual({ ok: true, requestId: payload.requestId });

    expect(outbound.turnstile()).toHaveLength(1);
    const turnstileBody = outbound.turnstile()[0].body as FormData;
    expect(turnstileBody.get("response")).toBe("XXXX.DUMMY.TOKEN.XXXX");
    expect(turnstileBody.get("idempotency_key")).toBe(payload.requestId);

    const [email] = outbound.emails();
    const sent = email.body as { from: string; to: string[]; subject: string; text: string; reply_to?: string };
    expect(sent.to).toEqual(["team@example.test"]);
    expect(sent.reply_to).toBe(payload.email);
    expect(sent.from).toBe("Test Organization <no-reply@example.test>");
    expect(sent.subject).toBe("Test Organization contact form: Ada Lovelace");
    for (const fragment of [
      "First name: Ada",
      "Last name: Lovelace",
      `Email: ${payload.email}`,
      "Phone: +1 202 555 0100",
      "Address: 12 Analytical Way, London",
      payload.message,
      `Request ID: ${payload.requestId}`
    ]) {
      expect(sent.text).toContain(fragment);
    }
    expect(email.headers.get("idempotency-key")).toBe(`contact/${payload.requestId}`);
    expect(email.headers.get("authorization")).toBe("Bearer test-transactional-key");

    const second = await fetchHandler(publicRequest("/v1/contact", payload), env);
    expect(second.status).toBe(202);
    await expect(second.json()).resolves.toEqual({ ok: true, requestId: payload.requestId });
    expect(outbound.calls).toHaveLength(2);
    const stored = await env.DB.prepare("SELECT status FROM request_log WHERE request_id = ?")
      .bind(payload.requestId).first<{ status: string }>();
    expect(stored?.status).toBe("succeeded");
  });

  it("accepts a submission with only email and a 2-character message", async () => {
    const outbound = mockProviders("contact");
    const payload = envelope({ email: uniqueEmail(), message: "Hi", firstName: "", lastName: null });
    const response = await fetchHandler(publicRequest("/v1/contact", payload), env);
    expect(response.status).toBe(202);
    const sent = outbound.emails()[0].body as { subject: string; text: string };
    expect(sent.subject).toBe(`Test Organization contact form: ${payload.email}`);
    expect(sent.text).toContain("First name: Not provided");
    expect(sent.text).toContain("Phone: Not provided");
    expect(sent.text).toContain("Address: Not provided");
  });

  it("rejects missing email, invalid email, short message, and bad phone with a field hint", async () => {
    const outbound = mockProviders("contact");
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ email: undefined }, "email"],
      [{ email: "" }, "email"],
      [{ email: "not-an-email" }, "email"],
      [{ email: "two@@example.test" }, "email"],
      [{ message: "a" }, "message"],
      [{ message: "   " }, "message"],
      [{ message: undefined }, "message"],
      [{ message: "x".repeat(5001) }, "message"],
      [{ phone: "call me" }, "phone"],
      [{ firstName: "x".repeat(101) }, "firstName"]
    ];
    for (const [overrides, field] of cases) {
      const response = await fetchHandler(publicRequest("/v1/contact", contactPayload(overrides)), env);
      expect(response.status, JSON.stringify(overrides).slice(0, 80)).toBe(400);
      const body = await errorBody(response);
      expect(body.error).toBe("INVALID_INPUT");
      expect(body.field).toBe(field);
    }
    expect(outbound.calls).toHaveLength(0);
    expect(await count("request_log")).toBe(0);
  });

  it("rejects line breaks and bidi controls in single-line fields", async () => {
    mockProviders("contact");
    for (const [field, value] of [
      ["firstName", "Ada\nBcc: attacker@example.test"],
      ["lastName", "Lovelace\r\nInjected"],
      ["address", "Street\u2028Bcc: attacker@example.test"],
      ["phone", "+1 202\n555 0100"],
      ["lastName", "Hello\u202eBcc"]
    ] as const) {
      const response = await fetchHandler(publicRequest("/v1/contact", contactPayload({ [field]: value })), env);
      expect(response.status).toBe(400);
      expect((await errorBody(response)).field).toBe(field);
    }
  });

  it("rejects a filled honeypot without calling providers or revealing the reason", async () => {
    const outbound = mockProviders("contact");
    const response = await fetchHandler(publicRequest("/v1/contact", contactPayload({ website: "https://spam.test" })), env);
    expect(response.status).toBe(400);
    const body = await errorBody(response);
    expect(body.error).toBe("SUSPICIOUS_SUBMISSION");
    expect(body.field).toBeUndefined();
    expect(outbound.calls).toHaveLength(0);
    expect(await count("request_log")).toBe(0);
    expect(await count("rate_limits")).toBe(0);
  });

  it("rejects submissions completed faster than the minimum fill time", async () => {
    const outbound = mockProviders("contact");
    const now = Date.now();
    const response = await fetchHandler(publicRequest("/v1/contact", contactPayload({
      startedAt: now - 200,
      submittedAt: new Date(now).toISOString()
    })), env);
    expect(response.status).toBe(400);
    expect((await errorBody(response)).error).toBe("SUSPICIOUS_SUBMISSION");
    expect(outbound.calls).toHaveLength(0);
  });

  it("rejects malformed request ids and missing Turnstile tokens", async () => {
    mockProviders("contact");
    const badId = await fetchHandler(publicRequest("/v1/contact", contactPayload({ requestId: "not-a-uuid" })), env);
    expect((await errorBody(badId)).field).toBe("requestId");
    const noToken = await fetchHandler(publicRequest("/v1/contact", contactPayload({ "cf-turnstile-response": "" })), env);
    expect((await errorBody(noToken)).field).toBe("cf-turnstile-response");
  });

  it("rejects a Turnstile token issued for a different form action", async () => {
    const outbound = mockProviders("subscribe");
    const response = await fetchHandler(publicRequest("/v1/contact", contactPayload()), env);
    expect(response.status).toBe(400);
    expect((await errorBody(response)).error).toBe("BOT_CHALLENGE_FAILED");
    expect(outbound.emails()).toHaveLength(0);
  });

  it("does not let a failed bot challenge exhaust an email quota", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ success: false }));
    const response = await fetchHandler(publicRequest("/v1/contact", contactPayload()), env);
    expect(response.status).toBe(400);
    const emailLimits = await env.DB.prepare("SELECT COUNT(*) AS count FROM rate_limits WHERE key LIKE 'contact:email:%'")
      .first<{ count: number }>();
    expect(emailLimits?.count).toBe(0);
  });

  it("reports provider failure as retryable and succeeds on retry with the same requestId", async () => {
    mockProviders("contact", { emailStatus: 500 });
    const payload = contactPayload();
    const failed = await fetchHandler(publicRequest("/v1/contact", payload), env);
    expect(failed.status).toBe(502);
    expect((await errorBody(failed)).error).toBe("UPSTREAM_FAILURE");
    vi.restoreAllMocks();
    const outbound = mockProviders("contact");
    const retried = await fetchHandler(publicRequest("/v1/contact", payload), env);
    expect(retried.status).toBe(202);
    expect(outbound.emails()).toHaveLength(1);
  });

  it("rate limits repeated submissions for the same email", async () => {
    mockProviders("contact");
    const email = uniqueEmail();
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await fetchHandler(publicRequest("/v1/contact", contactPayload({ email })), env);
      statuses.push(response.status);
    }
    expect(statuses).toEqual([202, 202, 202, 202, 429]);
  });
});

describe("newsletter double opt-in", () => {
  async function subscribeAndGetConfirmationUrl(outbound: ReturnType<typeof mockProviders>, payload = subscribePayload()) {
    const response = await fetchHandler(publicRequest("/v1/subscribe", payload), env);
    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ ok: true, requestId: payload.requestId, confirmationRequired: true });
    const [email] = outbound.emails();
    const sent = email.body as { to: string[]; subject: string; text: string; reply_to?: string };
    expect(sent.to).toEqual([payload.email]);
    expect(sent.reply_to).toBeUndefined();
    const link = sent.text.match(/https:\/\/api\.test\/v1\/subscribe\/confirm\?token=[0-9a-f]{64}/)?.[0];
    expect(link, sent.text).toBeTruthy();
    return { payload, link: link as string, token: new URL(link as string).searchParams.get("token") as string };
  }

  function confirmRequest(token: unknown, requestOrigin = origin, ip = "203.0.113.10") {
    return publicRequest("/v1/subscribe/confirm", { token }, ip, requestOrigin);
  }

  async function confirmationRow(requestId: string) {
    return env.DB.prepare("SELECT email, used_at FROM subscription_confirmations WHERE request_id = ?")
      .bind(requestId).first<{ email: string; used_at: number | null }>();
  }

  const newsletterContact = (email: string) => ({
    email,
    unsubscribed: false,
    topics: [{ id: "topic_newsletter", subscription: "opt_in" }]
  });

  it("only navigates on the emailed link and opts in only on the site's explicit POST", async () => {
    const outbound = mockProviders("subscribe");
    const { payload, link, token } = await subscribeAndGetConfirmationUrl(outbound);
    expect(outbound.contacts()).toHaveLength(0);
    expect(await confirmationRow(payload.requestId)).toEqual({ email: payload.email, used_at: null });

    // Opening the link (or a mail scanner pre-fetching it, repeatedly) subscribes nobody.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const opened = await fetchHandler(new Request(link), env);
      expect(opened.status).toBe(303);
      expect(opened.headers.get("location")).toBe(`https://site.test/?subscription=confirm#token=${token}`);
      expect(opened.headers.get("content-type")).toBeNull();
      expect(opened.headers.get("cache-control")).toBe("no-store");
      expect(opened.headers.get("referrer-policy")).toBe("no-referrer");
      expect(await opened.text()).toBe("");
    }
    expect(outbound.contacts()).toHaveLength(0);
    expect((await confirmationRow(payload.requestId))?.used_at).toBeNull();

    const confirmed = await fetchHandler(confirmRequest(token), env);
    expect(confirmed.status).toBe(200);
    expect(confirmed.headers.get("access-control-allow-origin")).toBe(origin);
    await expect(confirmed.json()).resolves.toEqual({ ok: true });
    const contacts = outbound.contacts();
    expect(contacts).toHaveLength(1);
    expect(contacts[0].method).toBe("POST");
    expect(contacts[0].headers.get("authorization")).toBe("Bearer test-contacts-key");
    expect(contacts[0].body).toEqual(newsletterContact(payload.email));
    expect((await confirmationRow(payload.requestId))?.used_at).toEqual(expect.any(Number));

    // A second click is still ok but opts in nothing new; the link now reports "confirmed".
    const again = await fetchHandler(confirmRequest(token), env);
    expect(again.status).toBe(200);
    await expect(again.json()).resolves.toEqual({ ok: true });
    expect(outbound.contacts()).toHaveLength(1);
    const reopened = await fetchHandler(new Request(link), env);
    expect(reopened.status).toBe(303);
    expect(reopened.headers.get("location")).toBe("https://site.test/?subscription=confirmed");
    expect(outbound.contacts()).toHaveLength(1);
  });

  it("updates topics when the Resend contact already exists", async () => {
    const outbound = mockProviders("subscribe", { contactsCreateStatus: 409 });
    const { payload, token } = await subscribeAndGetConfirmationUrl(outbound);
    const confirmed = await fetchHandler(confirmRequest(token), env);
    expect(confirmed.status).toBe(200);
    const [, patch] = outbound.contacts();
    expect(patch.method).toBe("PATCH");
    expect(patch.url).toBe(`https://api.resend.com/contacts/${encodeURIComponent(payload.email)}/topics`);
    expect(patch.body).toEqual({ topics: [{ id: "topic_newsletter", subscription: "opt_in" }] });
  });

  it("keeps the token usable when Resend fails during confirmation", async () => {
    const failing = mockProviders("subscribe", { contactsCreateStatus: 500 });
    const { payload, token } = await subscribeAndGetConfirmationUrl(failing);
    const failed = await fetchHandler(confirmRequest(token), env);
    expect(failed.status).toBe(502);
    expect((await errorBody(failed)).error).toBe("UPSTREAM_FAILURE");
    expect((await confirmationRow(payload.requestId))?.used_at).toBeNull();

    failing.spy.mockRestore();
    const outbound = mockProviders("subscribe");
    const retried = await fetchHandler(confirmRequest(token), env);
    expect(retried.status).toBe(200);
    expect(outbound.contacts()).toHaveLength(1);
    expect((await confirmationRow(payload.requestId))?.used_at).toEqual(expect.any(Number));
  });

  it("deduplicates a resubmitted requestId without sending a second email", async () => {
    const outbound = mockProviders("subscribe");
    const payload = subscribePayload();
    await subscribeAndGetConfirmationUrl(outbound, payload);
    const repeat = await fetchHandler(publicRequest("/v1/subscribe", payload), env);
    expect(repeat.status).toBe(202);
    expect(outbound.emails()).toHaveLength(1);
    expect(await count("subscription_confirmations")).toBe(1);
  });

  it("never mails a retried requestId's link to a different email than the one stored", async () => {
    const failing = mockProviders("subscribe", { emailStatus: 429 });
    const victim = subscribePayload();
    const failed = await fetchHandler(publicRequest("/v1/subscribe", victim), env);
    expect(failed.status).toBe(502);
    expect((await errorBody(failed)).error).toBe("UPSTREAM_FAILURE");
    failing.spy.mockRestore();

    const outbound = mockProviders("subscribe");
    const attacker = { ...victim, email: uniqueEmail() };
    const conflict = await fetchHandler(publicRequest("/v1/subscribe", attacker), env);
    expect(conflict.status).toBe(409);
    expect((await errorBody(conflict)).error).toBe("REQUEST_ID_CONFLICT");
    expect(outbound.emails()).toHaveLength(0);
    expect((await confirmationRow(victim.requestId))?.email).toBe(victim.email);

    // The documented same-payload retry still works, and mails only the stored address.
    const retried = await fetchHandler(publicRequest("/v1/subscribe", victim), env);
    expect(retried.status).toBe(202);
    expect(outbound.emails()).toHaveLength(1);
    expect((outbound.emails()[0].body as { to: string[] }).to).toEqual([victim.email]);
  });

  it("sends unknown, malformed and expired links to the site's notice instead of showing JSON", async () => {
    const outbound = mockProviders("subscribe");
    const { payload, link, token } = await subscribeAndGetConfirmationUrl(outbound);
    for (const url of [
      "https://api.test/v1/subscribe/confirm",
      "https://api.test/v1/subscribe/confirm?token=abc",
      `https://api.test/v1/subscribe/confirm?token=${"0".repeat(64)}`,
      `https://api.test/v1/subscribe/confirm?token=${token.toUpperCase()}`
    ]) {
      const response = await fetchHandler(new Request(url), env);
      expect(response.status, url).toBe(303);
      expect(response.headers.get("location")).toBe("https://site.test/?subscription=invalid");
      expect(response.headers.get("content-type")).toBeNull();
    }

    await env.DB.prepare("UPDATE subscription_confirmations SET expires_at = ? WHERE request_id = ?")
      .bind(Date.now() - 1, payload.requestId).run();
    const expired = await fetchHandler(new Request(link), env);
    expect(expired.status).toBe(303);
    expect(expired.headers.get("location")).toBe("https://site.test/?subscription=invalid");
    expect(outbound.contacts()).toHaveLength(0);
  });

  it("redirects to the site's error notice when the link cannot be checked", async () => {
    const brokenDb = { prepare: () => { throw new Error("D1 unavailable"); } } as unknown as D1Database;
    const response = await fetchHandler(
      new Request(`https://api.test/v1/subscribe/confirm?token=${"0".repeat(64)}`),
      { ...env, DB: brokenDb }
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://site.test/?subscription=error");
    expect(response.headers.get("content-type")).toBeNull();
  });

  it("answers a misconfigured redirect URL with plain text, never JSON", async () => {
    for (const redirect of ["https://elsewhere.test/", "not a url", ""]) {
      const response = await fetchHandler(
        new Request(`https://api.test/v1/subscribe/confirm?token=${"0".repeat(64)}`),
        { ...env, SUBSCRIPTION_CONFIRMATION_REDIRECT_URL: redirect }
      );
      expect(response.status, redirect).toBe(500);
      expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
      expect(response.headers.get("location")).toBeNull();
      expect(await response.text()).toContain("temporarily unavailable");
    }
  });

  it("rejects malformed, unknown and expired tokens on the confirm POST", async () => {
    const outbound = mockProviders("subscribe");
    const { payload, token } = await subscribeAndGetConfirmationUrl(outbound);
    for (const bad of [undefined, "", "abc", 42, "0".repeat(63), token.toUpperCase(), ` ${token}`]) {
      const response = await fetchHandler(confirmRequest(bad), env);
      expect(response.status, String(bad)).toBe(400);
      const body = await errorBody(response);
      expect(body.error).toBe("INVALID_INPUT");
      expect(body.field).toBe("token");
    }

    const unknown = await fetchHandler(confirmRequest("0".repeat(64)), env);
    expect(unknown.status).toBe(400);
    expect((await errorBody(unknown)).error).toBe("INVALID_CONFIRMATION");

    await env.DB.prepare("UPDATE subscription_confirmations SET expires_at = ? WHERE request_id = ?")
      .bind(Date.now() - 1, payload.requestId).run();
    const expired = await fetchHandler(confirmRequest(token), env);
    expect(expired.status).toBe(400);
    expect(expired.headers.get("access-control-allow-origin")).toBe(origin);
    expect((await errorBody(expired)).error).toBe("INVALID_CONFIRMATION");
    expect(outbound.contacts()).toHaveLength(0);
  });

  it("accepts the confirm POST only as JSON from an allowed origin", async () => {
    const outbound = mockProviders("subscribe");
    const { payload, token } = await subscribeAndGetConfirmationUrl(outbound);

    const foreign = await fetchHandler(confirmRequest(token, "https://attacker.test"), env);
    expect(foreign.status).toBe(403);
    expect(foreign.headers.get("access-control-allow-origin")).toBeNull();
    expect((await errorBody(foreign)).error).toBe("ORIGIN_NOT_ALLOWED");
    const noOrigin = new Request("https://api.test/v1/subscribe/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token })
    });
    expect((await fetchHandler(noOrigin, env)).status).toBe(403);
    const formPost = new Request("https://api.test/v1/subscribe/confirm", {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/x-www-form-urlencoded" },
      body: `token=${token}`
    });
    expect((await fetchHandler(formPost, env)).status).toBe(415);

    expect(outbound.contacts()).toHaveLength(0);
    expect((await confirmationRow(payload.requestId))?.used_at).toBeNull();
  });

  it("rate limits confirmation attempts per IP", async () => {
    const outbound = mockProviders("subscribe");
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 31; attempt += 1) {
      const response = await fetchHandler(confirmRequest("0".repeat(64), origin, "198.51.100.7"), env);
      statuses.push(response.status);
    }
    expect(statuses).toEqual([...Array<number>(30).fill(400), 429]);
    expect(outbound.calls).toHaveLength(0);
  });

  it("sets Reply-To on the confirmation email only when RESEND_REPLY_TO_EMAIL is configured", async () => {
    const outbound = mockProviders("subscribe");
    // Default test config (blank) is covered by subscribeAndGetConfirmationUrl: no reply_to.
    await subscribeAndGetConfirmationUrl(outbound);

    const payload = subscribePayload();
    const configured = await fetchHandler(publicRequest("/v1/subscribe", payload), { ...env, RESEND_REPLY_TO_EMAIL: " replies@example.test " });
    expect(configured.status).toBe(202);
    const sent = outbound.emails()[1].body as { to: string[]; reply_to?: string };
    expect(sent.to).toEqual([payload.email]);
    expect(sent.reply_to).toBe("replies@example.test");

    const blank = await fetchHandler(publicRequest("/v1/subscribe", subscribePayload()), { ...env, RESEND_REPLY_TO_EMAIL: "   " });
    expect(blank.status).toBe(202);
    expect((outbound.emails()[2].body as { reply_to?: string }).reply_to).toBeUndefined();
    outbound.spy.mockRestore();

    // Contact notifications keep replying to the visitor.
    const contactOutbound = mockProviders("contact");
    const contact = contactPayload();
    const response = await fetchHandler(publicRequest("/v1/contact", contact), { ...env, RESEND_REPLY_TO_EMAIL: "replies@example.test" });
    expect(response.status).toBe(202);
    expect((contactOutbound.emails()[0].body as { reply_to?: string }).reply_to).toBe(contact.email);
  });

  it("validates the subscription email and honeypot before any provider call", async () => {
    const outbound = mockProviders("subscribe");
    for (const email of [undefined, "", "nope"]) {
      const response = await fetchHandler(publicRequest("/v1/subscribe", subscribePayload({ email })), env);
      expect(response.status).toBe(400);
      expect((await errorBody(response)).field).toBe("email");
    }
    const honeypot = await fetchHandler(publicRequest("/v1/subscribe", subscribePayload({ website: "filled" })), env);
    expect((await errorBody(honeypot)).error).toBe("SUSPICIOUS_SUBMISSION");
    expect(outbound.calls).toHaveLength(0);
  });

  it("ignores legacy fields such as name, topics, consent and locale", async () => {
    const outbound = mockProviders("subscribe");
    const payload = subscribePayload({ name: "Ignored", topics: ["events"], consent: "nope", locale: "he" });
    const { token } = await subscribeAndGetConfirmationUrl(outbound, payload);
    await fetchHandler(confirmRequest(token), env);
    expect(outbound.contacts()[0].body).toEqual(newsletterContact(payload.email));
  });
});

describe("Resend webhook", () => {
  async function sign(body: string, id: string, timestamp: string) {
    const secret = env.RESEND_WEBHOOK_SECRET.replace(/^whsec_/, "");
    const keyBytes = Uint8Array.from(atob(secret), (character) => character.charCodeAt(0));
    const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${timestamp}.${body}`));
    return `v1,${btoa(String.fromCharCode(...new Uint8Array(signature)))}`;
  }

  async function webhookRequest(body: string, signature?: string) {
    const id = "msg_test_1";
    const timestamp = `${Math.floor(Date.now() / 1000)}`;
    return new Request("https://api.test/webhooks/resend", {
      method: "POST",
      headers: {
        "svix-id": id,
        "svix-timestamp": timestamp,
        "svix-signature": signature ?? await sign(body, id, timestamp)
      },
      body
    });
  }

  it("stores a correctly signed event once and ignores replays", async () => {
    const body = JSON.stringify({ id: "evt_1", type: "email.bounced", data: {} });
    expect((await fetchHandler(await webhookRequest(body), env)).status).toBe(200);
    expect((await fetchHandler(await webhookRequest(body), env)).status).toBe(200);
    expect(await count("webhook_events")).toBe(1);
  });

  it("rejects invalid signatures", async () => {
    const body = JSON.stringify({ id: "evt_2", type: "email.bounced" });
    const response = await fetchHandler(await webhookRequest(body, "v1,aW52YWxpZA=="), env);
    expect(response.status).toBe(400);
    expect((await errorBody(response)).error).toBe("INVALID_WEBHOOK_SIGNATURE");
    expect(await count("webhook_events")).toBe(0);
  });

  it("rejects malformed signature material", async () => {
    expect(await verifyResendSignature("{}", "msg_test", `${Math.floor(Date.now() / 1000)}`, "v1,invalid", "dGVzdA==")).toBe(false);
    await expect(sha256Hex("same-value")).resolves.toBe(await sha256Hex("same-value"));
  });
});

describe("scheduled cleanup", () => {
  it("removes expired rate limits, confirmations, webhook rows and old request logs", async () => {
    const now = Date.now();
    const old = now - 31 * 86_400_000;
    await env.DB.batch([
      env.DB.prepare("INSERT INTO rate_limits (key, bucket, count, expires_at) VALUES ('k', 1, 1, 1)"),
      env.DB.prepare("INSERT INTO request_log (request_id, route, status, created_at, updated_at) VALUES ('old-contact', 'contact', 'succeeded', ?, ?)").bind(old, old),
      env.DB.prepare("INSERT INTO request_log (request_id, route, status, created_at, updated_at) VALUES ('old-subscribe', 'subscribe', 'succeeded', ?, ?)").bind(old, old),
      env.DB.prepare("INSERT INTO subscription_confirmations (id, request_id, token_hash, email, expires_at, created_at) VALUES ('c1', 'old-subscribe', 'hash', 'a@example.test', ?, ?)").bind(old, old),
      env.DB.prepare("INSERT INTO webhook_events (provider, event_id, event_type, payload_json, received_at) VALUES ('resend', 'e1', 't', '{}', ?)").bind(now - 91 * 86_400_000)
    ]);
    const pending: Promise<unknown>[] = [];
    worker.scheduled({} as ScheduledController, env, { waitUntil: (promise) => pending.push(promise) });
    await Promise.all(pending);
    for (const table of ["rate_limits", "request_log", "subscription_confirmations", "webhook_events"]) {
      expect(await count(table), table).toBe(0);
    }
  });
});

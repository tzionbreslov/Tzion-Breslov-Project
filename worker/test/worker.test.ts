import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatEventWhen } from "../../lib/events.mjs";
import { sha256Hex, verifyResendSignature } from "../src/crypto";
import { cancelRsvp, confirmRsvp, confirmedRsvp, reserveRsvp, rsvpConfirmationId, rsvpWait } from "../src/database";
import { loadEventFeed, resetEventFeedCache, type FeedEvent } from "../src/events";
import worker, { fetchHandler } from "../src/index";
import type { RsvpInput } from "../src/validation";

const origin = "https://site.test";

type OutboundCall = { url: string; method: string; body: unknown; headers: Headers; redirect?: string };

// The site's /events.json as the Worker reads it (vitest binding EVENTS_FEED_URL).
const FEED_URL = "https://site.test/events.json";
const HOUR = 3_600_000;
const EVENT_IDS = {
  open: "0123456789abcdef01234567",
  limited: "89abcdef0123456789abcdef",
  off: "fedcba9876543210fedcba98",
  started: "00112233445566778899aabb",
  unknown: "ffffffffffffffffffffffff"
} as const;

function feedEvent(overrides: Partial<FeedEvent> = {}): FeedEvent {
  const start = Date.now() + 24 * HOUR;
  return {
    id: EVENT_IDS.open,
    title: "Weekly class",
    startsAt: new Date(start).toISOString(),
    endsAt: new Date(start + 2 * HOUR).toISOString(),
    timeZone: "Asia/Jerusalem",
    allDay: false,
    rsvp: "open",
    limit: null,
    ...overrides
  };
}

/** An open event tomorrow, one limited to 3 people, one with "No RSVP", and one that started an hour ago. */
function defaultFeedEvents() {
  return [
    feedEvent(),
    feedEvent({ id: EVENT_IDS.limited, title: "Shabbaton", limit: 3 }),
    feedEvent({ id: EVENT_IDS.off, title: "Talk at another venue", rsvp: "off" }),
    feedEvent({
      id: EVENT_IDS.started,
      title: "Morning class",
      startsAt: new Date(Date.now() - HOUR).toISOString(),
      endsAt: new Date(Date.now() + HOUR).toISOString()
    })
  ];
}

/** How rsvps.event_starts_at / event_ends_at store a time, comparable with SQLite's datetime('now'). */
const sqliteTime = (iso: string) => new Date(iso).toISOString().slice(0, 19).replace("T", " ");

/** UTC midnight `days` days from today: how the feed gives an all-day event's dates (the end date is exclusive). */
function utcMidnight(days: number) {
  const today = new Date();
  return new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + days)).toISOString();
}

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

function rsvpPayload(overrides: Record<string, unknown> = {}) {
  return envelope({
    eventId: EVENT_IDS.open,
    name: "Ada Lovelace",
    email: uniqueEmail(),
    guests: 2,
    accessibility: "Step-free access, please.\nNo nuts.",
    consent: "granted",
    ...overrides
  });
}

type MockOptions = {
  contactsCreateStatus?: number;
  /** Resend's answer to an email, or one per recipient (a promise holds that email until the test settles it). */
  emailStatus?: number | ((to: string) => number | Promise<number>);
  /** Resend never answers an email: only the request's own signal ends it, as fetch does when it times out. */
  emailHangs?: boolean;
  /** Holds every /events.json answer until this settles. */
  feedGate?: Promise<void>;
  /** The events /events.json lists (default: defaultFeedEvents()). */
  feedEvents?: FeedEvent[];
  /** Answers /events.json instead (a failure, a redirect, a malformed body). */
  feedResponse?: () => Response;
  /** /events.json never answers: only the request's own signal ends it, as fetch does when it times out. */
  feedHangs?: boolean;
};

/**
 * Stubs Turnstile siteverify, the Resend API and the site's /events.json on
 * globalThis.fetch. `action` is what Turnstile reports the token was issued for.
 */
function mockProviders(action: string, options: MockOptions = {}) {
  const calls: OutboundCall[] = [];
  const feedEvents = options.feedEvents ?? defaultFeedEvents();
  /** A request that never answers: only its own signal ends it (without one, it would hang until the platform gives up). */
  const hang = (signal: AbortSignal | null | undefined) => new Promise<Response>((_, reject) => {
    if (!signal) return reject(new Error("no timeout signal"));
    signal.addEventListener("abort", () => reject(signal.reason), { once: true });
  });
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    const rawBody = init?.body;
    const body = typeof rawBody === "string" ? JSON.parse(rawBody) : rawBody;
    calls.push({ url, method, body, headers: new Headers(init?.headers), redirect: init?.redirect ?? (input instanceof Request ? input.redirect : undefined) });
    if (url === FEED_URL) {
      if (options.feedGate) await options.feedGate;
      if (options.feedHangs) return hang(init?.signal);
      return options.feedResponse ? options.feedResponse() : Response.json({ syncedAt: new Date().toISOString(), events: feedEvents });
    }
    if (url.includes("/turnstile/v0/siteverify")) {
      return Response.json({ success: true, hostname: "localhost", action });
    }
    if (url === "https://api.resend.com/emails") {
      if (options.emailHangs) return hang(init?.signal);
      const to = (body as { to?: string[] } | undefined)?.to?.[0] ?? "";
      const status = typeof options.emailStatus === "function" ? await options.emailStatus(to) : options.emailStatus ?? 200;
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
    feedEvents,
    emails: () => calls.filter((call) => call.url === "https://api.resend.com/emails"),
    contacts: () => calls.filter((call) => call.url.startsWith("https://api.resend.com/contacts")),
    turnstile: () => calls.filter((call) => call.url.includes("/turnstile/")),
    feed: () => calls.filter((call) => call.url === FEED_URL)
  };
}

/**
 * Records the timeouts (ms) the Worker asks AbortSignal.timeout for, and makes
 * each one 20 ms, so a test of a feed that never answers needn't wait 10 s.
 */
function shortenTimeouts() {
  const asked: number[] = [];
  const timeout = AbortSignal.timeout.bind(AbortSignal);
  vi.spyOn(AbortSignal, "timeout").mockImplementation((ms: number) => {
    asked.push(ms);
    return timeout(20);
  });
  return asked;
}

/**
 * Moves the clock instead of waiting: every wait of up to 4 s that the Worker asks setTimeout for passes at
 * once, and Date.now() jumps ahead by its length. So a request that waits 30 s for an RSVP row to turn stale
 * runs in milliseconds, its clock reading as it would. Returns the waits asked for (ms), in order. It skips
 * ahead through any setTimeout of 4 s or less while the test runs, not only the RSVP wait's: if the Worker
 * ever waits on something else that short on the same path, that is skipped too.
 */
function fastForwardWaits() {
  const waits: number[] = [];
  let ahead = 0;
  const realNow = Date.now.bind(Date);
  const realSetTimeout = globalThis.setTimeout.bind(globalThis);
  vi.spyOn(Date, "now").mockImplementation(() => realNow() + ahead);
  vi.spyOn(globalThis, "setTimeout").mockImplementation(((handler: () => void, ms?: number) => {
    if (typeof ms !== "number" || ms <= 0 || ms > 4_000) return realSetTimeout(handler, ms);
    waits.push(ms);
    ahead += ms;
    return realSetTimeout(handler, 0);
  }) as typeof setTimeout);
  return waits;
}

/**
 * The tests' D1, counting the queries Cloudflare counts against "Queries per Worker invocation" (50 on Workers
 * Free): each statement run on its own (first, run, all, raw) is one, and a batch is one, however many
 * statements it holds. `queries` lists them in order (a statement's SQL, or "batch"). `before` runs ahead of
 * each one (given its SQL, or "batch"), uncounted: what other attempts do to the database in the meantime.
 */
function countingDb(before?: (query: string) => Promise<void>) {
  const queries: string[] = [];
  const unwrapped = new WeakMap<object, D1PreparedStatement>();
  const runs = new Set<PropertyKey>(["first", "run", "all", "raw"]);
  const statement = (target: D1PreparedStatement, sql: string): D1PreparedStatement => {
    const proxy = new Proxy(target, {
      get(inner, property) {
        if (property === "bind") return (...values: unknown[]) => statement(inner.bind(...values), sql);
        const value: unknown = Reflect.get(inner, property, inner);
        if (typeof value !== "function") return value;
        if (!runs.has(property)) return value.bind(inner);
        return async (...args: unknown[]) => {
          await before?.(sql);
          queries.push(sql);
          return value.apply(inner, args);
        };
      }
    });
    unwrapped.set(proxy, target);
    return proxy;
  };
  const db = new Proxy(env.DB, {
    get(target, property) {
      if (property === "prepare") return (sql: string) => statement(target.prepare(sql), sql);
      if (property === "batch") {
        return async (statements: D1PreparedStatement[]) => {
          await before?.("batch");
          queries.push("batch");
          return target.batch(statements.map((each) => unwrapped.get(each) ?? each));
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
  return { db, queries };
}

async function errorBody(response: Response) {
  return response.json<{ ok: boolean; error: string; correlationId: string; field?: string; remaining?: number }>();
}

async function count(table: string) {
  const row = await env.DB.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first<{ count: number }>();
  return row?.count ?? -1;
}

/** Cloudflare's default cache, where the Worker shares the availability answer (typed as the Worker reads it). */
const sharedCache = () => (caches as unknown as { default: Cache }).default;

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM rsvps"),
    env.DB.prepare("DELETE FROM subscription_confirmations"),
    env.DB.prepare("DELETE FROM request_log"),
    env.DB.prepare("DELETE FROM rate_limits"),
    env.DB.prepare("DELETE FROM webhook_events")
  ]);
  // The feed is cached per isolate, and the availability answer in the Cache API: every test reads its own.
  resetEventFeedCache();
  await sharedCache().delete("https://api.test/v1/rsvp/availability");
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
    for (const path of ["/v1/contact", "/v1/subscribe", "/v1/subscribe/confirm", "/v1/rsvp"]) {
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
    const rsvpPreflight = await fetchHandler(new Request("https://api.test/v1/rsvp", {
      method: "OPTIONS",
      headers: { Origin: "https://attacker.test", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "content-type" }
    }), env);
    expect(rsvpPreflight.status).toBe(403);
    expect(rsvpPreflight.headers.get("access-control-allow-origin")).toBeNull();
    expect(outbound.calls).toHaveLength(0);
    expect(await count("request_log")).toBe(0);
    expect(await count("rsvps")).toBe(0);
  });

  it("answers a constrained CORS preflight for allowed origins", async () => {
    for (const path of ["/v1/contact", "/v1/subscribe", "/v1/subscribe/confirm", "/v1/rsvp"]) {
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

  it("keeps payment routes closed, and the availability GET the only other RSVP method", async () => {
    expect((await fetchHandler(publicRequest("/v1/checkout", {}), env)).status).toBe(404);
    expect((await fetchHandler(new Request("https://api.test/webhooks/stripe", { method: "POST", body: "{}" }), env)).status).toBe(404);
    expect((await fetchHandler(new Request("https://api.test/v1/rsvp", { headers: { Origin: origin } }), env)).status).toBe(404);
    expect((await fetchHandler(publicRequest("/v1/rsvp/availability", {}), env)).status).toBe(404);
  });

  it("logs the switch-day probe (an unknown path) as one line with method and path, never its query string", async () => {
    // README → Switch day, step 4 (log-probe check): the stored line this request leaves in Workers Logs must hold only these fields,
    // so the probe string can only appear there if Cloudflare itself stored the request URL.
    const logs = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await fetchHandler(new Request("https://api.test/nope?probe=tzprobe-7k2q9x"), env);
    expect(response.status).toBe(404);
    const body = await errorBody(response);
    expect(body.error).toBe("NOT_FOUND");
    const logged = logs.mock.calls.map((args) => String(args[0]));
    expect(logged).toHaveLength(1);
    expect(JSON.parse(logged[0])).toEqual({ correlationId: body.correlationId, method: "GET", path: "/nope", error: "NOT_FOUND" });
    expect(logged[0]).not.toContain("tzprobe-7k2q9x");
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

  it("opts a body without topics (the footer form) into the newsletter only, ignoring legacy fields", async () => {
    const outbound = mockProviders("subscribe");
    const payload = subscribePayload({ name: "Ignored", consent: "nope", locale: "he" });
    const { token } = await subscribeAndGetConfirmationUrl(outbound, payload);
    const row = await env.DB.prepare("SELECT topics_json FROM subscription_confirmations WHERE request_id = ?")
      .bind(payload.requestId).first<{ topics_json: string }>();
    expect(row?.topics_json).toBe('["newsletter"]');
    await fetchHandler(confirmRequest(token), env);
    expect(outbound.contacts()).toHaveLength(1);
    expect(outbound.contacts()[0].body).toEqual(newsletterContact(payload.email));
  });

  it("opts in to only the lists chosen: events alone carries only topic_events", async () => {
    const outbound = mockProviders("subscribe");
    const payload = subscribePayload({ topics: ["events"] });
    const { token } = await subscribeAndGetConfirmationUrl(outbound, payload);
    const row = await env.DB.prepare("SELECT topics_json FROM subscription_confirmations WHERE request_id = ?")
      .bind(payload.requestId).first<{ topics_json: string }>();
    expect(row?.topics_json).toBe('["events"]');
    expect(outbound.contacts()).toHaveLength(0);

    const confirmed = await fetchHandler(confirmRequest(token), env);
    expect(confirmed.status).toBe(200);
    expect(outbound.contacts()).toHaveLength(1);
    expect(outbound.contacts()[0].body).toEqual({
      email: payload.email,
      unsubscribed: false,
      topics: [{ id: "topic_events", subscription: "opt_in" }]
    });
  });

  it("opts in to both lists once each, also when the Resend contact already exists", async () => {
    const outbound = mockProviders("subscribe", { contactsCreateStatus: 409 });
    const payload = subscribePayload({ topics: ["events", "newsletter", "events"] });
    const { token } = await subscribeAndGetConfirmationUrl(outbound, payload);
    expect((await fetchHandler(confirmRequest(token), env)).status).toBe(200);
    const [create, patch] = outbound.contacts();
    const both = [{ id: "topic_newsletter", subscription: "opt_in" }, { id: "topic_events", subscription: "opt_in" }];
    expect(create.body).toEqual({ email: payload.email, unsubscribed: false, topics: both });
    expect(patch.method).toBe("PATCH");
    expect(patch.body).toEqual({ topics: both });
  });

  it("confirms a newsletter-only signup even before RESEND_EVENTS_TOPIC_ID is installed", async () => {
    const outbound = mockProviders("subscribe");
    const unconfigured = { ...env, RESEND_EVENTS_TOPIC_ID: "" };
    const payload = subscribePayload();
    const response = await fetchHandler(publicRequest("/v1/subscribe", payload), unconfigured);
    expect(response.status).toBe(202);
    const sent = outbound.emails()[0].body as { text: string };
    const token = sent.text.match(/token=([0-9a-f]{64})/)?.[1] as string;
    expect((await fetchHandler(confirmRequest(token), unconfigured)).status).toBe(200);
    expect(outbound.contacts()[0].body).toEqual(newsletterContact(payload.email));
  });

  it("rejects empty, unknown and non-list topics before any provider call", async () => {
    const outbound = mockProviders("subscribe");
    for (const topics of [[], ["spam"], ["events", "spam"], "events", [1], {}, ""]) {
      const response = await fetchHandler(publicRequest("/v1/subscribe", subscribePayload({ topics })), env);
      expect(response.status, JSON.stringify(topics)).toBe(400);
      const body = await errorBody(response);
      expect(body.error).toBe("INVALID_INPUT");
      expect(body.field).toBe("topics");
    }
    expect(outbound.calls).toHaveLength(0);
    expect(await count("subscription_confirmations")).toBe(0);
  });
});

type SentEmail = { from: string; to: string[]; subject: string; text: string; reply_to?: string };
type RsvpRow = {
  id: string;
  request_id: string;
  event_id: string;
  event_starts_at: string;
  event_ends_at: string;
  name: string;
  email: string;
  email_hash: string;
  guests: number;
  accessibility: string | null;
  created_at: number;
  confirmed_at: number | null;
};
type RsvpSuccess = { ok: true; requestId: string; confirmationId: string };
type RsvpAvailability = { ok: true; events: Record<string, { full: boolean; remaining: number | null }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function rsvpRow(requestId: string) {
  return env.DB.prepare("SELECT * FROM rsvps WHERE request_id = ?").bind(requestId).first<RsvpRow>();
}

async function guestsFor(eventId: string) {
  const row = await env.DB.prepare("SELECT COALESCE(SUM(guests), 0) AS guests FROM rsvps WHERE event_id = ?").bind(eventId).first<{ guests: number }>();
  return row?.guests ?? -1;
}

/** What reserveRsvp needs of one visitor's RSVP for one guest. */
function reserveInput(): RsvpInput {
  return { requestId: crypto.randomUUID(), name: "Ada", email: "ada@example.test", guests: 1, accessibility: "" } as RsvpInput;
}

function sentTo(outbound: ReturnType<typeof mockProviders>, address: string) {
  return outbound.emails().filter((call) => (call.body as SentEmail).to[0] === address);
}

/** A promise the test settles. */
function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The guest's "RSVP received" for `address`, held on its first send until the test answers it
 * (`answer(200)` or `answer(500)`); later sends answer 200 at once. `asked` settles when the
 * held send reaches Resend.
 */
function holdFirstGuestEmail(address: string) {
  const asked = deferred();
  const held = deferred<number>();
  let sends = 0;
  return {
    asked: asked.promise,
    answer: held.resolve,
    emailStatus: (to: string) => {
      if (to !== address) return 200;
      sends += 1;
      if (sends > 1) return 200;
      asked.resolve();
      return held.promise;
    }
  };
}

describe("POST /v1/rsvp", () => {
  it("records an RSVP to an open event and emails the guest and the organizer", async () => {
    const outbound = mockProviders("rsvp");
    const payload = rsvpPayload();
    const response = await fetchHandler(publicRequest("/v1/rsvp", payload), { ...env, RESEND_REPLY_TO_EMAIL: "replies@example.test" });
    expect(response.status).toBe(202);
    expect(response.headers.get("access-control-allow-origin")).toBe(origin);
    const body = await response.json<RsvpSuccess>();
    expect(body).toEqual({ ok: true, requestId: payload.requestId, confirmationId: expect.stringMatching(UUID) });

    // One row, never in request_log (its route CHECK only allows contact and subscribe).
    expect(await count("rsvps")).toBe(1);
    expect(await count("request_log")).toBe(0);
    const event = outbound.feedEvents[0];
    const row = await rsvpRow(payload.requestId);
    expect(row).toMatchObject({
      id: body.confirmationId,
      event_id: EVENT_IDS.open,
      event_starts_at: sqliteTime(event.startsAt),
      // The daily clean-up deletes the RSVP once this end has passed.
      event_ends_at: sqliteTime(event.endsAt),
      name: "Ada Lovelace",
      email: payload.email,
      guests: 2,
      accessibility: "Step-free access, please.\nNo nuts."
    });
    expect(row?.email_hash).toMatch(/^[0-9a-f]{64}$/);

    // The feed is read from exactly EVENTS_FEED_URL, never following a redirect.
    expect(outbound.feed()).toHaveLength(1);
    expect(outbound.feed()[0]).toMatchObject({ method: "GET", redirect: "manual" });
    expect(outbound.turnstile()).toHaveLength(1);
    expect((outbound.turnstile()[0].body as FormData).get("idempotency_key")).toBe(payload.requestId);

    const when = formatEventWhen(event);
    expect(when).toContain("(Israel time)");
    expect(outbound.emails()).toHaveLength(2);
    const [guest] = sentTo(outbound, payload.email);
    const guestEmail = guest.body as SentEmail;
    expect(guestEmail.from).toBe("Test Organization <no-reply@example.test>");
    expect(guestEmail.subject).toBe("RSVP received: Weekly class");
    expect(guestEmail.reply_to).toBe("replies@example.test");
    for (const fragment of ["Hello Ada Lovelace,", "Event: Weekly class", `When: ${when}`, "Guests: 2", `Confirmation ID: ${body.confirmationId}`]) {
      expect(guestEmail.text).toContain(fragment);
    }
    expect(guest.headers.get("idempotency-key")).toBe(`rsvp-guest/${payload.requestId}`);
    expect(guest.headers.get("authorization")).toBe("Bearer test-transactional-key");

    const [organizer] = sentTo(outbound, "team@example.test");
    const organizerEmail = organizer.body as SentEmail;
    expect(organizerEmail.subject).toBe("New RSVP: Weekly class");
    expect(organizerEmail.reply_to).toBe(payload.email);
    for (const fragment of [
      "Event: Weekly class",
      `When: ${when}`,
      "Name: Ada Lovelace",
      `Email: ${payload.email}`,
      "Guests: 2",
      "Step-free access, please.\nNo nuts.",
      `Confirmation ID: ${body.confirmationId}`
    ]) {
      expect(organizerEmail.text).toContain(fragment);
    }
    expect(organizer.headers.get("idempotency-key")).toBe(`rsvp-organizer/${payload.requestId}`);
  });

  it("returns the same confirmation for a repeated requestId: still one row, no new emails", async () => {
    const outbound = mockProviders("rsvp");
    const payload = rsvpPayload();
    const first = await (await fetchHandler(publicRequest("/v1/rsvp", payload), env)).json<RsvpSuccess>();
    const again = await fetchHandler(publicRequest("/v1/rsvp", payload), env);
    expect(again.status).toBe(202);
    await expect(again.json()).resolves.toEqual({ ok: true, requestId: payload.requestId, confirmationId: first.confirmationId });
    expect(await count("rsvps")).toBe(1);
    expect(outbound.emails()).toHaveLength(2);
  });

  it("a second request with the same requestId waits for the first one's outcome: booked, it answers the same confirmation", async () => {
    const payload = rsvpPayload({ eventId: EVENT_IDS.limited, guests: 3 });
    const guest = holdFirstGuestEmail(payload.email);
    const outbound = mockProviders("rsvp", { emailStatus: guest.emailStatus });
    const first = fetchHandler(publicRequest("/v1/rsvp", payload), env);
    // The first attempt holds the seats and is emailing the guest.
    await guest.asked;
    expect(await count("rsvps")).toBe(1);

    let secondAnswered = false;
    const second = fetchHandler(publicRequest("/v1/rsvp", payload), env).finally(() => {
      secondAnswered = true;
    });
    await vi.waitFor(() => expect(outbound.turnstile()).toHaveLength(2));
    await pause(300);
    // No answer while the guest's email is still on its way.
    expect(secondAnswered).toBe(false);

    guest.answer(200);
    const [a, b] = await Promise.all([first, second]);
    expect([a.status, b.status]).toEqual([202, 202]);
    const firstBody = await a.json<RsvpSuccess>();
    await expect(b.json()).resolves.toEqual(firstBody);
    expect(await count("rsvps")).toBe(1);
    expect((await rsvpRow(payload.requestId))?.confirmed_at).toEqual(expect.any(Number));
    // The guest and the organizer heard once.
    expect(outbound.emails().map((call) => (call.body as SentEmail).to[0])).toEqual([payload.email, "team@example.test"]);
  });

  it("a second request with the same requestId waits for the first one's outcome: given back, it books the RSVP itself", async () => {
    const payload = rsvpPayload({ eventId: EVENT_IDS.limited, guests: 3 });
    const guest = holdFirstGuestEmail(payload.email);
    const outbound = mockProviders("rsvp", { emailStatus: guest.emailStatus });
    const first = fetchHandler(publicRequest("/v1/rsvp", payload), env);
    await guest.asked;
    const second = fetchHandler(publicRequest("/v1/rsvp", payload), env);
    await vi.waitFor(() => expect(outbound.turnstile()).toHaveLength(2));
    await pause(100);

    // The first attempt's guest email fails: it gives its seats back and answers the retryable error.
    guest.answer(500);
    const a = await first;
    expect(a.status).toBe(502);
    expect((await errorBody(a)).error).toBe("UPSTREAM_FAILURE");
    // The second never answered for a row that was being given back: it booked and emailed the guest itself.
    const b = await second;
    expect(b.status).toBe(202);
    const { confirmationId } = await b.json<RsvpSuccess>();
    const row = await rsvpRow(payload.requestId);
    expect(row).toMatchObject({ id: confirmationId, guests: 3, confirmed_at: expect.any(Number) });
    expect(await count("rsvps")).toBe(1);
    expect(outbound.emails().map((call) => (call.body as SentEmail).to[0])).toEqual([payload.email, payload.email, "team@example.test"]);
    expect(outbound.emails().map((call) => call.headers.get("idempotency-key")))
      .toEqual([`rsvp-guest/${payload.requestId}`, `rsvp-guest/${payload.requestId}`, `rsvp-organizer/${payload.requestId}`]);
  });

  it("two requests with the same requestId that reach the reservation together: one books, the other waits for its outcome", async () => {
    const payload = rsvpPayload({ eventId: EVENT_IDS.limited, guests: 3 });
    const guest = holdFirstGuestEmail(payload.email);
    const feedGate = deferred();
    const outbound = mockProviders("rsvp", { emailStatus: guest.emailStatus, feedGate: feedGate.promise });
    // Both have found no RSVP for the requestId and are reading the feed.
    let answered = 0;
    const both = [fetchHandler(publicRequest("/v1/rsvp", payload), env), fetchHandler(publicRequest("/v1/rsvp", payload), env)]
      .map((response) => response.finally(() => {
        answered += 1;
      }));
    await vi.waitFor(() => expect(outbound.feed()).toHaveLength(2));
    expect(await count("rsvps")).toBe(0);
    feedGate.resolve();
    // One holds the seats and emails the guest; the other's INSERT finds them taken and waits.
    await guest.asked;
    await pause(300);
    expect(answered).toBe(0);
    guest.answer(200);
    const answers = await Promise.all(both);
    expect(answers.map((response) => response.status)).toEqual([202, 202]);
    const [one, two] = await Promise.all(answers.map((response) => response.json<RsvpSuccess>()));
    expect(two).toEqual(one);
    expect(await count("rsvps")).toBe(1);
    expect(await guestsFor(EVENT_IDS.limited)).toBe(3);
    expect(outbound.emails()).toHaveLength(2);
  });

  /**
   * Books an RSVP, then leaves its row as an attempt that stopped between taking the seats and confirming them
   * would: unconfirmed, taken `ageMs` ago (at `heldSince`).
   */
  async function cutOffRsvp(ageMs: number) {
    const payload = rsvpPayload({ eventId: EVENT_IDS.limited, guests: 3 });
    mockProviders("rsvp");
    const { confirmationId } = await (await fetchHandler(publicRequest("/v1/rsvp", payload), env)).json<RsvpSuccess>();
    const heldSince = Date.now() - ageMs;
    await env.DB.prepare("UPDATE rsvps SET confirmed_at = NULL, created_at = ? WHERE request_id = ?")
      .bind(heldSince, payload.requestId).run();
    vi.restoreAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    return { payload, confirmationId, heldSince };
  }

  it("re-books an RSVP whose first attempt was cut off (its row over 30 s old) at the site's retry, with the same emails' keys", async () => {
    const { payload, confirmationId } = await cutOffRsvp(31_000);
    // The site's retry after a network failure or a 5xx: the same requestId and Turnstile token, the same details.
    const outbound = mockProviders("rsvp");
    const retried = await fetchHandler(publicRequest("/v1/rsvp", payload), env);
    expect(retried.status).toBe(202);
    await expect(retried.json()).resolves.toEqual({ ok: true, requestId: payload.requestId, confirmationId });
    expect(await count("rsvps")).toBe(1);
    expect(await guestsFor(EVENT_IDS.limited)).toBe(3);
    expect((await rsvpRow(payload.requestId))?.confirmed_at).toEqual(expect.any(Number));
    // Resend's idempotency keys stop a second copy of an email the cut-off attempt had already sent.
    expect(outbound.emails().map((call) => call.headers.get("idempotency-key")).sort())
      .toEqual([`rsvp-guest/${payload.requestId}`, `rsvp-organizer/${payload.requestId}`]);
  });

  it("a retry that finds a cut-off attempt's row still under 30 s old waits for it to turn stale, then re-books it in the same call", async () => {
    const { payload, confirmationId, heldSince } = await cutOffRsvp(29_400);
    const outbound = mockProviders("rsvp");
    const retried = await fetchHandler(publicRequest("/v1/rsvp", payload), env);
    // Not REQUEST_IN_PROGRESS, which would cost the visitor another try (and one of the email's 6 per 10 minutes).
    expect(retried.status).toBe(202);
    await expect(retried.json()).resolves.toEqual({ ok: true, requestId: payload.requestId, confirmationId });
    expect(await count("rsvps")).toBe(1);
    expect(await guestsFor(EVENT_IDS.limited)).toBe(3);
    // Booked again once the row was stale (30 s after it was taken), not before: it waited, however long the setup took.
    const row = await rsvpRow(payload.requestId);
    expect(row?.confirmed_at).toEqual(expect.any(Number));
    expect(row!.created_at).toBeGreaterThan(heldSince + 30_000);
    expect(outbound.turnstile()).toHaveLength(1);
    expect(outbound.emails()).toHaveLength(2);
  });

  it("a retry that waits the full 30 s for a cut-off attempt's row makes at most 20 D1 queries (Workers Free allows 50)", async () => {
    // The row was taken just now and never confirmed: the retry waits the whole 30 s for it to turn stale.
    const { payload, confirmationId, heldSince } = await cutOffRsvp(0);
    // The feed is read again too (the longest path).
    resetEventFeedCache();
    const outbound = mockProviders("rsvp");
    const waits = fastForwardWaits();
    const { db, queries } = countingDb();
    const retried = await fetchHandler(publicRequest("/v1/rsvp", payload), { ...env, DB: db });
    expect(retried.status).toBe(202);
    await expect(retried.json()).resolves.toEqual({ ok: true, requestId: payload.requestId, confirmationId });
    // 2 rate limits, the waiting reads, 1 more read and the booking batch, then the confirmation: 17 today.
    expect(queries.length).toBeLessThanOrEqual(20);
    // Turnstile, the feed, the guest's email and the organizer's: the other subrequests.
    expect(outbound.calls).toHaveLength(4);
    // Booked again once stale, no sooner: 200 ms, doubling up to 4 s, the last wait cut to the moment it turns stale.
    const row = await rsvpRow(payload.requestId);
    expect(row).toMatchObject({ id: confirmationId, confirmed_at: expect.any(Number) });
    expect(row!.created_at).toBeGreaterThan(heldSince + 30_000);
    expect(waits.slice(0, -1)).toEqual([200, 400, 800, 1_600, 3_200, 4_000, 4_000, 4_000, 4_000, 4_000]);
    expect(waits.at(-1)).toBeLessThan(4_000);
    expect(await count("rsvps")).toBe(1);
  });

  it("one RSVP request waits 30 s at most in all and makes at most 22 D1 queries, however other attempts with its requestId race it", async () => {
    // The first attempt's row, taken just now: it gives the seats back 10 s later (its guest email timed out).
    const { payload, confirmationId, heldSince } = await cutOffRsvp(0);
    const row = (await rsvpRow(payload.requestId))!;
    resetEventFeedCache();
    mockProviders("rsvp");
    const waits = fastForwardWaits();
    // Then two more attempts, each taking the seats just before this request's booking batch: the first gives them
    // back 10 s later too, the second stops (it never confirms them or gives them back).
    const others: Array<number | null> = [10_000, null];
    let holder: { since: number; givesBackAfter: number | null } | null = { since: heldSince, givesBackAfter: 10_000 };
    const { db, queries } = countingDb(async (query) => {
      if (holder && holder.givesBackAfter !== null && Date.now() >= holder.since + holder.givesBackAfter) {
        await env.DB.prepare("DELETE FROM rsvps WHERE request_id = ?").bind(payload.requestId).run();
        holder = null;
      }
      if (query === "batch" && others.length) {
        holder = { since: Date.now(), givesBackAfter: others.shift() as number | null };
        await env.DB.prepare(
          `INSERT INTO rsvps
            (id, request_id, event_id, event_starts_at, event_ends_at, name, email, email_hash, guests, accessibility, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(row.id, row.request_id, row.event_id, row.event_starts_at, row.event_ends_at, row.name, row.email, row.email_hash,
          row.guests, row.accessibility, holder.since).run();
      }
    });
    const response = await fetchHandler(publicRequest("/v1/rsvp", payload), { ...env, DB: db });
    // 2 rate limits, the waits' reads (each round goes on from the time and backoff the last one left), 2 batches.
    expect(queries.length).toBeLessThanOrEqual(22);
    // One 30 s deadline for the whole request. The last attempt took its row 22 s into it, so that row only turns
    // stale after the deadline: this request answers REQUEST_IN_PROGRESS.
    expect(waits.reduce((sum, wait) => sum + wait, 0)).toBeLessThanOrEqual(30_000);
    expect(response.status).toBe(409);
    expect((await errorBody(response)).error).toBe("REQUEST_IN_PROGRESS");
    expect((await rsvpRow(payload.requestId))?.confirmed_at).toBeNull();
    // The site keeps the requestId and token on that answer: its retry books the stopped attempt's row once stale.
    const retried = await fetchHandler(publicRequest("/v1/rsvp", payload), { ...env, DB: db });
    expect(retried.status).toBe(202);
    await expect(retried.json()).resolves.toEqual({ ok: true, requestId: payload.requestId, confirmationId });
    expect((await rsvpRow(payload.requestId))?.confirmed_at).toEqual(expect.any(Number));
    expect(await count("rsvps")).toBe(1);
  });

  it("finishes the emails and the confirmation under waitUntil, so a visitor who disconnects can't leave the seats held unconfirmed", async () => {
    const payload = rsvpPayload({ eventId: EVENT_IDS.limited, guests: 3 });
    const guest = holdFirstGuestEmail(payload.email);
    const outbound = mockProviders("rsvp", { emailStatus: guest.emailStatus });
    const kept: Promise<unknown>[] = [];
    const context = { waitUntil: (promise: Promise<unknown>) => void kept.push(promise) };
    const response = worker.fetch(publicRequest("/v1/rsvp", payload), env, context);
    // The seats are taken and the guest is being emailed: from here the runtime is asked to finish the work.
    await guest.asked;
    expect(kept).toHaveLength(1);
    expect((await rsvpRow(payload.requestId))?.confirmed_at).toBeNull();
    guest.answer(200);
    // What the runtime keeps alive covers the confirmation and the organizer's email, not just the guest's.
    await expect(kept[0]).resolves.toBeUndefined();
    expect((await rsvpRow(payload.requestId))?.confirmed_at).toEqual(expect.any(Number));
    expect(outbound.emails().map((call) => (call.body as SentEmail).to[0])).toEqual([payload.email, "team@example.test"]);
    expect((await response).status).toBe(202);
  });

  it("under waitUntil, a failed guest email still gives the seats back, and the kept work never rejects", async () => {
    const payload = rsvpPayload({ eventId: EVENT_IDS.limited, guests: 3 });
    mockProviders("rsvp", { emailStatus: (to) => (to === payload.email ? 500 : 200) });
    const kept: Promise<unknown>[] = [];
    const response = await worker.fetch(publicRequest("/v1/rsvp", payload), env, { waitUntil: (promise) => void kept.push(promise) });
    expect(response.status).toBe(502);
    expect((await errorBody(response)).error).toBe("UPSTREAM_FAILURE");
    expect(kept).toHaveLength(1);
    await expect(kept[0]).resolves.toBeUndefined();
    expect(await count("rsvps")).toBe(0);
  });

  it("gives up on a Resend call that doesn't answer within 10 s: the guest's email fails (502) and the seats are given back", async () => {
    const asked = shortenTimeouts();
    const outbound = mockProviders("rsvp", { emailHangs: true });
    const payload = rsvpPayload({ eventId: EVENT_IDS.limited, guests: 3 });
    const response = await fetchHandler(publicRequest("/v1/rsvp", payload), env);
    // The feed's 10 s, then the guest email's.
    expect(asked).toEqual([10_000, 10_000]);
    expect(response.status).toBe(502);
    expect((await errorBody(response)).error).toBe("UPSTREAM_FAILURE");
    expect(outbound.emails()).toHaveLength(1);
    expect(await count("rsvps")).toBe(0);
    expect(await guestsFor(EVENT_IDS.limited)).toBe(0);
  });

  it("keeps the booking and still emails the organizer when confirming fails after the guest's email (logged, request id only)", async () => {
    const logs = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const payload = rsvpPayload({ eventId: EVENT_IDS.limited, guests: 3 });
    const outbound = mockProviders("rsvp");
    // A database whose confirmation UPDATE fails (everything else works).
    const db = new Proxy(env.DB, {
      get(target, property) {
        if (property === "prepare") {
          return (sql: string) => {
            if (sql.startsWith("UPDATE rsvps SET confirmed_at")) throw new Error("D1 unavailable");
            return target.prepare(sql);
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      }
    });
    const response = await fetchHandler(publicRequest("/v1/rsvp", payload), { ...env, DB: db });
    expect(response.status).toBe(202);
    const { confirmationId } = await response.json<RsvpSuccess>();
    expect(outbound.emails().map((call) => (call.body as SentEmail).to[0])).toEqual([payload.email, "team@example.test"]);
    expect((sentTo(outbound, "team@example.test")[0].body as SentEmail).text).toContain(`Confirmation ID: ${confirmationId}`);
    // The seats stay taken, unconfirmed.
    expect(await rsvpRow(payload.requestId)).toMatchObject({ id: confirmationId, guests: 3, confirmed_at: null });
    const logged = logs.mock.calls.map((args) => String(args[0]));
    const line = logged.find((entry) => entry.includes("RSVP_CONFIRM_FAILED"));
    expect(line && JSON.parse(line)).toEqual({ code: "RSVP_CONFIRM_FAILED", requestId: payload.requestId, error: "Error" });
    expect(logged.join("\n")).not.toMatch(/example\.test|Ada|Lovelace|Step-free/);
  });

  it("answers REQUEST_IN_PROGRESS when a shorter wait runs out while the first attempt is still emailing the guest", async () => {
    const input = reserveInput();
    const event = feedEvent();
    // Taken, not yet confirmed (its attempt is still on the guest's email).
    expect((await reserveRsvp(env, input, event, "hash")).created).toBe(true);
    const started = Date.now();
    await expect(confirmedRsvp(env, input.requestId, event.id, "hash", rsvpWait(300))).rejects.toMatchObject({ code: "REQUEST_IN_PROGRESS" });
    expect(Date.now() - started).toBeGreaterThanOrEqual(250);
    await expect(reserveRsvp(env, input, event, "hash", rsvpWait(300))).rejects.toMatchObject({ code: "REQUEST_IN_PROGRESS" });
    expect(await count("rsvps")).toBe(1);
  });

  it("gives back, or confirms, only the RSVP that the attempt itself holds; never gives back a confirmed one", async () => {
    const input = reserveInput();
    const event = feedEvent();
    const reservation = await reserveRsvp(env, input, event, "hash");
    if (!reservation.created) throw new Error("not created");
    // Another attempt's hold (a different time) is not this one's: neither given back nor confirmed.
    await cancelRsvp(env, reservation.id, reservation.heldSince - 1);
    expect(await count("rsvps")).toBe(1);
    await confirmRsvp(env, reservation.id, reservation.heldSince - 1);
    expect((await rsvpRow(input.requestId))?.confirmed_at).toBeNull();
    // A confirmed RSVP is never given back.
    await confirmRsvp(env, reservation.id, reservation.heldSince);
    expect((await rsvpRow(input.requestId))?.confirmed_at).toEqual(expect.any(Number));
    await cancelRsvp(env, reservation.id, reservation.heldSince);
    expect(await count("rsvps")).toBe(1);
    await env.DB.prepare("UPDATE rsvps SET confirmed_at = NULL").run();
    await cancelRsvp(env, reservation.id, reservation.heldSince);
    expect(await count("rsvps")).toBe(0);
  });

  it("refuses a reused requestId for another event or email", async () => {
    const outbound = mockProviders("rsvp");
    const payload = rsvpPayload();
    expect((await fetchHandler(publicRequest("/v1/rsvp", payload), env)).status).toBe(202);
    for (const changed of [{ ...payload, eventId: EVENT_IDS.limited }, { ...payload, email: uniqueEmail() }]) {
      const response = await fetchHandler(publicRequest("/v1/rsvp", changed), env);
      expect(response.status).toBe(409);
      expect((await errorBody(response)).error).toBe("REQUEST_ID_CONFLICT");
    }
    expect(await count("rsvps")).toBe(1);
    expect(outbound.emails()).toHaveLength(2);
  });

  it("caps attendance at the event's limit: 2 + 2 against 3 is full, 2 + 1 fits; a refusal says how many places were left", async () => {
    const outbound = mockProviders("rsvp");
    const statuses: number[] = [];
    const left: Array<number | undefined> = [];
    for (const guests of [2, 2, 1, 1]) {
      const response = await fetchHandler(publicRequest("/v1/rsvp", rsvpPayload({ eventId: EVENT_IDS.limited, guests })), env);
      statuses.push(response.status);
      if (response.status === 409) {
        const body = await errorBody(response);
        expect(body.error).toBe("EVENT_FULL");
        left.push(body.remaining);
      }
    }
    expect(statuses).toEqual([202, 409, 202, 409]);
    // 2 of 3 taken, 2 asked: 1 left. Then 3 of 3 taken: none.
    expect(left).toEqual([1, 0]);
    expect(await guestsFor(EVENT_IDS.limited)).toBe(3);
    expect(outbound.emails()).toHaveLength(4);
  });

  it("lets exactly one of two simultaneous 2-guest RSVPs into a 3-person event", async () => {
    const outbound = mockProviders("rsvp");
    const responses = await Promise.all([
      fetchHandler(publicRequest("/v1/rsvp", rsvpPayload({ eventId: EVENT_IDS.limited, guests: 2 }), "203.0.113.21"), env),
      fetchHandler(publicRequest("/v1/rsvp", rsvpPayload({ eventId: EVENT_IDS.limited, guests: 2 }), "203.0.113.22"), env)
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([202, 409]);
    const refused = responses.find((response) => response.status === 409)!;
    // The places left as the refused reservation saw them: 3 - 2.
    expect(await errorBody(refused)).toMatchObject({ error: "EVENT_FULL", remaining: 1 });
    expect(await count("rsvps")).toBe(1);
    expect(await guestsFor(EVENT_IDS.limited)).toBe(2);
    expect(outbound.emails()).toHaveLength(2);
  });

  it("reserves in one statement: six simultaneous 1-guest reservations fill a 3-person event exactly", async () => {
    const event = feedEvent({ id: EVENT_IDS.limited, limit: 3 });
    const input = (n: number) => ({
      requestId: crypto.randomUUID(),
      name: `Guest ${n}`,
      email: `guest-${n}@example.test`,
      guests: 1,
      accessibility: ""
    }) as RsvpInput;
    const results = await Promise.all(Array.from({ length: 6 }, (_, n) =>
      reserveRsvp(env, input(n), event, `hash-${n}`).then((value) => value.created, (error: { code?: string }) => error.code)));
    expect(results.filter((value) => value === true)).toHaveLength(3);
    expect(results.filter((value) => value === "EVENT_FULL")).toHaveLength(3);
    expect(await guestsFor(EVENT_IDS.limited)).toBe(3);
    await expect(reserveRsvp(env, input(7), event, "hash-7")).rejects.toMatchObject({ code: "EVENT_FULL", remaining: 0 });
  });

  it("stores an all-day event's end as its exclusive end date, at UTC midnight", async () => {
    // Tomorrow, all day: the feed's end is the day after's UTC midnight.
    const event = feedEvent({ allDay: true, timeZone: "UTC", startsAt: utcMidnight(1), endsAt: utcMidnight(2) });
    const input = reserveInput();
    expect((await reserveRsvp(env, input, event, "hash")).created).toBe(true);
    const row = await rsvpRow(input.requestId);
    expect(row?.event_starts_at).toBe(`${utcMidnight(1).slice(0, 10)} 00:00:00`);
    expect(row?.event_ends_at).toBe(`${utcMidnight(2).slice(0, 10)} 00:00:00`);
  });

  it("closes RSVPs once the event has started", async () => {
    const outbound = mockProviders("rsvp");
    const response = await fetchHandler(publicRequest("/v1/rsvp", rsvpPayload({ eventId: EVENT_IDS.started })), env);
    expect(response.status).toBe(409);
    expect((await errorBody(response)).error).toBe("EVENT_CLOSED");
    expect(await count("rsvps")).toBe(0);
    expect(outbound.emails()).toHaveLength(0);
  });

  it("answers a replay of a booked RSVP with its confirmation even after the event has started, or while the feed is down", async () => {
    const payload = rsvpPayload();
    const booking = mockProviders("rsvp");
    const first = await fetchHandler(publicRequest("/v1/rsvp", payload), env);
    expect(first.status).toBe(202);
    const { confirmationId } = await first.json<RsvpSuccess>();
    expect(booking.emails()).toHaveLength(2);
    booking.spy.mockRestore();

    // The same event, now started an hour ago (the calendar moved it, or the retry came late).
    resetEventFeedCache();
    const started = mockProviders("rsvp", {
      feedEvents: [feedEvent({ startsAt: new Date(Date.now() - HOUR).toISOString(), endsAt: new Date(Date.now() + HOUR).toISOString() })]
    });
    const replay = await fetchHandler(publicRequest("/v1/rsvp", payload), env);
    expect(replay.status).toBe(202);
    await expect(replay.json()).resolves.toEqual({ ok: true, requestId: payload.requestId, confirmationId });
    // A new RSVP to it is closed.
    const late = await fetchHandler(publicRequest("/v1/rsvp", rsvpPayload()), env);
    expect(late.status).toBe(409);
    expect((await errorBody(late)).error).toBe("EVENT_CLOSED");
    expect(started.emails()).toHaveLength(0);
    started.spy.mockRestore();

    // The feed can't be read: the replay needs only the stored RSVP.
    resetEventFeedCache();
    const down = mockProviders("rsvp", { feedResponse: () => new Response("", { status: 500 }) });
    const whileDown = await fetchHandler(publicRequest("/v1/rsvp", payload), env);
    expect(whileDown.status).toBe(202);
    await expect(whileDown.json()).resolves.toEqual({ ok: true, requestId: payload.requestId, confirmationId });
    expect(down.feed()).toHaveLength(0);
    expect(down.emails()).toHaveLength(0);
    expect(await count("rsvps")).toBe(1);
  });

  it("answers 404 EVENT_NOT_FOUND for a \"No RSVP\" event and for an id the feed doesn't list", async () => {
    const outbound = mockProviders("rsvp");
    for (const eventId of [EVENT_IDS.off, EVENT_IDS.unknown]) {
      const response = await fetchHandler(publicRequest("/v1/rsvp", rsvpPayload({ eventId })), env);
      expect(response.status, eventId).toBe(404);
      expect((await errorBody(response)).error).toBe("EVENT_NOT_FOUND");
    }
    expect(await count("rsvps")).toBe(0);
    expect(outbound.emails()).toHaveLength(0);
  });

  it("answers 503 EVENTS_UNAVAILABLE when the feed fails, redirects or is malformed", async () => {
    const valid = { syncedAt: null, events: defaultFeedEvents() };
    const answers: Array<[string, () => Response]> = [
      ["500", () => new Response("oops", { status: 500 })],
      ["302 (tzionbreslov.org still redirects to .com)", () => new Response(null, { status: 302, headers: { Location: "https://tzionbreslov.com/events.json" } })],
      ["not JSON", () => new Response("<!doctype html><p>Not found</p>", { headers: { "Content-Type": "application/json" } })],
      ["HTML content type", () => new Response(JSON.stringify(valid), { headers: { "Content-Type": "text/html" } })],
      ["no events list", () => Response.json({ syncedAt: null })],
      ["events not a list", () => Response.json({ syncedAt: null, events: { [EVENT_IDS.open]: feedEvent() } })],
      ["not an object", () => Response.json(null)],
      ["over 512 KB", () => new Response(JSON.stringify({ syncedAt: " ".repeat(600_000), events: [feedEvent()] }), { headers: { "Content-Type": "application/json" } })]
    ];
    for (const [label, feedResponse] of answers) {
      vi.restoreAllMocks();
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      resetEventFeedCache();
      const outbound = mockProviders("rsvp", { feedResponse });
      const response = await fetchHandler(publicRequest("/v1/rsvp", rsvpPayload()), env);
      expect(response.status, label).toBe(503);
      expect((await errorBody(response)).error, label).toBe("EVENTS_UNAVAILABLE");
      expect(outbound.feed()[0]?.redirect, label).toBe("manual");
      expect(outbound.emails(), label).toHaveLength(0);
    }
    expect(await count("rsvps")).toBe(0);
  });

  it("cancels the feed's body when it gives up before reading it (status, content type, declared size)", async () => {
    const answers: Array<[string, (body: ReadableStream) => Response]> = [
      ["500", (body) => new Response(body, { status: 500 })],
      ["HTML content type", (body) => new Response(body, { headers: { "Content-Type": "text/html" } })],
      ["declared over 512 KB", (body) => new Response(body, { headers: { "Content-Type": "application/json", "Content-Length": "600000" } })]
    ];
    for (const [label, respond] of answers) {
      vi.restoreAllMocks();
      resetEventFeedCache();
      let cancelled = false;
      // A body that never ends unless it is cancelled.
      const body = new ReadableStream({ pull: () => new Promise<void>(() => undefined), cancel: () => { cancelled = true; } });
      mockProviders("rsvp", { feedResponse: () => respond(body) });
      await expect(loadEventFeed(env), label).rejects.toMatchObject({ code: "EVENTS_UNAVAILABLE" });
      await vi.waitFor(() => expect(cancelled, label).toBe(true), { timeout: 500 });
    }
  });

  it("treats a feed body that breaks off while it is read as unavailable (read failed)", async () => {
    // Valid JSON starts arriving, then the connection drops (or the 10 s timeout fires mid-body).
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"syncedAt":null,"events":['));
        controller.error(new Error("connection reset"));
      }
    });
    const outbound = mockProviders("rsvp", { feedResponse: () => new Response(body, { headers: { "Content-Type": "application/json" } }) });
    await expect(loadEventFeed(env)).rejects.toMatchObject({ code: "EVENTS_UNAVAILABLE", message: "events feed: read failed" });
    expect(outbound.feed()).toHaveLength(1);
  });

  it("stops reading a feed with no Content-Length once it passes 512 KB, and cancels the rest", async () => {
    const CHUNK = 64 * 1024;
    let pulled = 0;
    let cancelled = false;
    // Up to about 1 MB of a JSON string, in 64 KB chunks, with no declared length.
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pulled >= 1024 * 1024) return controller.close();
        const chunk = new TextEncoder().encode((pulled === 0 ? '{"syncedAt":"' : "") + " ".repeat(CHUNK)).slice(0, CHUNK);
        pulled += chunk.byteLength;
        controller.enqueue(chunk);
      },
      cancel() {
        cancelled = true;
      }
    }, { highWaterMark: 0 });
    let response: Response | undefined;
    mockProviders("rsvp", {
      feedResponse: () => (response = new Response(body, { headers: { "Content-Type": "application/json" } }))
    });
    await expect(loadEventFeed(env)).rejects.toMatchObject({ code: "EVENTS_UNAVAILABLE", message: "events feed: too large" });
    // The no-length path: nothing declared the size up front.
    expect(response?.headers.get("content-length")).toBeNull();
    await vi.waitFor(() => expect(cancelled).toBe(true), { timeout: 500 });
    expect(pulled).toBeLessThanOrEqual(512 * 1024 + 2 * CHUNK);
  });

  it("gives up on a feed that doesn't answer within 10 s: 503 EVENTS_UNAVAILABLE", async () => {
    const asked = shortenTimeouts();
    const outbound = mockProviders("rsvp", { feedHangs: true });
    const response = await fetchHandler(publicRequest("/v1/rsvp", rsvpPayload()), env);
    expect(asked).toEqual([10_000]);
    expect(response.status).toBe(503);
    expect((await errorBody(response)).error).toBe("EVENTS_UNAVAILABLE");
    expect(outbound.feed()).toHaveLength(1);
    expect(outbound.emails()).toHaveLength(0);
    expect(await count("rsvps")).toBe(0);
  });

  it("reads the feed only over https (plain http just for localhost)", async () => {
    const outbound = mockProviders("rsvp");
    for (const url of ["http://tzionbreslov.org/events.json", "ftp://site.test/events.json", "not a url"]) {
      await expect(loadEventFeed({ ...env, EVENTS_FEED_URL: url })).rejects.toMatchObject({ code: "SERVICE_NOT_CONFIGURED" });
    }
    expect(outbound.calls).toHaveLength(0);
    // Allowed (the stub doesn't answer it, so it is "unavailable", but it was asked).
    await expect(loadEventFeed({ ...env, EVENTS_FEED_URL: "http://localhost:3100/events.json" })).rejects.toMatchObject({ code: "EVENTS_UNAVAILABLE" });
    expect(outbound.calls.map((call) => [call.url, call.redirect])).toEqual([["http://localhost:3100/events.json", "manual"]]);
  });

  it("skips an invalid calendar event, logging only why, and keeps RSVPs open for the others", async () => {
    const longTitle = feedEvent({ id: EVENT_IDS.limited, title: "Private: Ada's long title ".repeat(50) });
    const broken = [
      longTitle,
      feedEvent({ id: "x" }),
      feedEvent({ id: EVENT_IDS.off, startsAt: "soon" }),
      { ...feedEvent({ id: EVENT_IDS.started }), allDay: undefined } as unknown as FeedEvent,
      { ...feedEvent({ id: EVENT_IDS.unknown }), rsvp: "maybe" } as unknown as FeedEvent,
      feedEvent({ id: "aaaaaaaaaaaaaaaaaaaaaaaa", limit: 0 }),
      "not an event" as unknown as FeedEvent
    ];
    const logs = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const outbound = mockProviders("rsvp", { feedEvents: [...broken, feedEvent()] });
    expect((await fetchHandler(publicRequest("/v1/rsvp", rsvpPayload()), env)).status).toBe(202);
    const skippedOne = await fetchHandler(publicRequest("/v1/rsvp", rsvpPayload({ eventId: EVENT_IDS.limited })), env);
    expect(skippedOne.status).toBe(404);
    expect((await errorBody(skippedOne)).error).toBe("EVENT_NOT_FOUND");
    const availability = await (await fetchHandler(new Request("https://api.test/v1/rsvp/availability"), env)).json<{ events: Record<string, unknown> }>();
    expect(Object.keys(availability.events)).toEqual([EVENT_IDS.open]);

    const skipped = logs.mock.calls.map((args) => String(args[0])).filter((entry) => entry.includes("EVENTS_FEED_EVENT_SKIPPED"));
    expect(skipped.map((entry) => JSON.parse(entry).reason)).toEqual(["bad title", "bad id", "bad time", "bad allDay", "bad rsvp", "bad limit", "not an object"]);
    expect(skipped.join("\n")).not.toContain("Private");
    expect(outbound.feed()).toHaveLength(1);
  });

  it("caches the feed for 60 seconds per isolate, and never caches a failure", async () => {
    let status = 500;
    const outbound = mockProviders("rsvp", {
      feedResponse: () => status === 200 ? Response.json({ syncedAt: null, events: defaultFeedEvents() }) : new Response("", { status })
    });
    const now = Date.now();
    await expect(loadEventFeed(env, now)).rejects.toMatchObject({ code: "EVENTS_UNAVAILABLE" });
    status = 200;
    expect(await loadEventFeed(env, now)).toHaveLength(4);
    expect(await loadEventFeed(env, now + 59_000)).toHaveLength(4);
    expect(outbound.feed()).toHaveLength(2);
    expect(await loadEventFeed(env, now + 61_000)).toHaveLength(4);
    expect(outbound.feed()).toHaveLength(3);
    expect(outbound.feed().every((call) => call.url === FEED_URL && call.redirect === "manual")).toBe(true);
  });

  it("rejects bad guests, a missing consent, and bad name, email, notes or event id with a field hint", async () => {
    const outbound = mockProviders("rsvp");
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ guests: 0 }, "guests"],
      [{ guests: 13 }, "guests"],
      [{ guests: "2.5" }, "guests"],
      [{ guests: 2.5 }, "guests"],
      [{ guests: "2" }, "guests"],
      [{ guests: undefined }, "guests"],
      [{ consent: undefined }, "consent"],
      [{ consent: "yes" }, "consent"],
      [{ consent: true }, "consent"],
      [{ name: "A" }, "name"],
      [{ name: "x".repeat(101) }, "name"],
      [{ name: "Ada\nBcc: attacker@example.test" }, "name"],
      [{ email: "nope" }, "email"],
      [{ accessibility: "x".repeat(1001) }, "accessibility"],
      [{ eventId: "x" }, "eventId"],
      [{ eventId: EVENT_IDS.open.toUpperCase() }, "eventId"],
      [{ eventId: undefined }, "eventId"]
    ];
    for (const [overrides, field] of cases) {
      const response = await fetchHandler(publicRequest("/v1/rsvp", rsvpPayload(overrides)), env);
      expect(response.status, JSON.stringify(overrides).slice(0, 80)).toBe(400);
      const body = await errorBody(response);
      expect(body.error).toBe("INVALID_INPUT");
      expect(body.field).toBe(field);
    }
    expect(outbound.calls).toHaveLength(0);
    expect(await count("rsvps")).toBe(0);
    expect(await count("rate_limits")).toBe(0);
  });

  it("rejects a Turnstile token issued for another form before reading the feed", async () => {
    const outbound = mockProviders("subscribe");
    const response = await fetchHandler(publicRequest("/v1/rsvp", rsvpPayload()), env);
    expect(response.status).toBe(400);
    expect((await errorBody(response)).error).toBe("BOT_CHALLENGE_FAILED");
    expect(outbound.feed()).toHaveLength(0);
    expect(outbound.emails()).toHaveLength(0);
    expect(await count("rsvps")).toBe(0);
  });

  it("does not let a failed bot challenge use up an email's RSVP quota (IP, Turnstile, then email)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ success: false }));
    const response = await fetchHandler(publicRequest("/v1/rsvp", rsvpPayload()), env);
    expect(response.status).toBe(400);
    expect((await errorBody(response)).error).toBe("BOT_CHALLENGE_FAILED");
    const limits = async (kind: string) => (await env.DB.prepare("SELECT COUNT(*) AS count FROM rate_limits WHERE key LIKE ?")
      .bind(`rsvp:${kind}:%`).first<{ count: number }>())?.count;
    expect(await limits("ip")).toBe(1);
    expect(await limits("email")).toBe(0);
    expect(await count("rsvps")).toBe(0);
  });

  it("rate limits 30 RSVPs per IP and 6 per email in 10 minutes", async () => {
    mockProviders("rsvp");
    const email = uniqueEmail();
    const byEmail: number[] = [];
    for (let attempt = 0; attempt < 7; attempt += 1) {
      byEmail.push((await fetchHandler(publicRequest("/v1/rsvp", rsvpPayload({ email, guests: 1 }), `198.51.100.${attempt + 1}`), env)).status);
    }
    expect(byEmail).toEqual([...Array<number>(6).fill(202), 429]);

    const byIp: number[] = [];
    for (let attempt = 0; attempt < 31; attempt += 1) {
      byIp.push((await fetchHandler(publicRequest("/v1/rsvp", rsvpPayload({ guests: 1 }), "192.0.2.50"), env)).status);
    }
    expect(byIp).toEqual([...Array<number>(30).fill(202), 429]);
  });

  it("gives the seats back when the guest's email fails, so a retry with the same requestId books and mails it", async () => {
    const payload = rsvpPayload({ eventId: EVENT_IDS.limited, guests: 3 });
    const failing = mockProviders("rsvp", { emailStatus: (to) => (to === payload.email ? 500 : 200) });
    const failed = await fetchHandler(publicRequest("/v1/rsvp", payload), env);
    expect(failed.status).toBe(502);
    expect((await errorBody(failed)).error).toBe("UPSTREAM_FAILURE");
    // The organizer never hears of an RSVP the guest wasn't told about.
    expect(failing.emails().map((call) => (call.body as SentEmail).to[0])).toEqual([payload.email]);
    expect(await count("rsvps")).toBe(0);
    failing.spy.mockRestore();

    const outbound = mockProviders("rsvp");
    const retried = await fetchHandler(publicRequest("/v1/rsvp", payload), env);
    expect(retried.status).toBe(202);
    expect(await guestsFor(EVENT_IDS.limited)).toBe(3);
    expect(outbound.emails()).toHaveLength(2);
    expect(outbound.emails().map((call) => call.headers.get("idempotency-key")).sort())
      .toEqual([`rsvp-guest/${payload.requestId}`, `rsvp-organizer/${payload.requestId}`]);

    // The same idempotency key carries the identical guest email (Resend refuses a reused key
    // with another body), because the confirmation id comes from the requestId.
    const { confirmationId } = await retried.json<RsvpSuccess>();
    const firstGuest = failing.emails()[0];
    const retriedGuest = sentTo(outbound, payload.email)[0];
    expect(retriedGuest.body).toEqual(firstGuest.body);
    expect(retriedGuest.headers.get("idempotency-key")).toBe(firstGuest.headers.get("idempotency-key"));
    expect((firstGuest.body as SentEmail).text).toContain(`Confirmation ID: ${confirmationId}`);
  });

  it("derives the confirmation id from the requestId: same request, same id; never the requestId itself", async () => {
    mockProviders("rsvp");
    const ids = new Set<string>();
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const payload = rsvpPayload();
      const { confirmationId } = await (await fetchHandler(publicRequest("/v1/rsvp", payload), env)).json<RsvpSuccess>();
      expect(confirmationId).toMatch(UUID);
      expect(confirmationId).not.toBe(payload.requestId);
      expect(confirmationId.replaceAll("-", "")).not.toContain(payload.requestId.replaceAll("-", "").slice(0, 8));
      ids.add(confirmationId);
      const again = await (await fetchHandler(publicRequest("/v1/rsvp", payload), env)).json<RsvpSuccess>();
      expect(again.confirmationId).toBe(confirmationId);
    }
    expect(ids.size).toBe(3);
    expect(await count("rsvps")).toBe(3);
  });

  it("refuses to derive a confirmation id from a RATE_LIMIT_SALT under 32 characters (SERVICE_NOT_CONFIGURED)", async () => {
    const shortSalt = { ...env, RATE_LIMIT_SALT: "too-short-salt" };
    await expect(rsvpConfirmationId(shortSalt, crypto.randomUUID())).rejects.toMatchObject({ code: "SERVICE_NOT_CONFIGURED" });
    await expect(reserveRsvp(shortSalt, reserveInput(), feedEvent(), "hash")).rejects.toMatchObject({ code: "SERVICE_NOT_CONFIGURED" });
    expect(await count("rsvps")).toBe(0);
    // 32 characters is enough.
    await expect(rsvpConfirmationId({ ...env, RATE_LIMIT_SALT: "x".repeat(32) }, crypto.randomUUID())).resolves.toMatch(UUID);
  });

  it("logs a failed seat release after a failed guest email (code and request id only)", async () => {
    const logs = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const payload = rsvpPayload({ eventId: EVENT_IDS.limited, guests: 3 });
    mockProviders("rsvp", { emailStatus: (to) => (to === payload.email ? 500 : 200) });
    // A database whose DELETE of the new row fails (everything else works).
    const db = new Proxy(env.DB, {
      get(target, property) {
        if (property === "prepare") {
          return (sql: string) => {
            if (sql.startsWith("DELETE FROM rsvps WHERE id")) throw new Error("D1 unavailable");
            return target.prepare(sql);
          };
        }
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      }
    });
    const failed = await fetchHandler(publicRequest("/v1/rsvp", payload), { ...env, DB: db });
    expect(failed.status).toBe(502);
    expect((await errorBody(failed)).error).toBe("UPSTREAM_FAILURE");
    // The row stays (nothing could delete it), which only the log tells anyone about.
    expect(await count("rsvps")).toBe(1);
    const logged = logs.mock.calls.map((args) => String(args[0]));
    const line = logged.find((entry) => entry.includes("RSVP_CANCEL_FAILED"));
    expect(line && JSON.parse(line)).toEqual({ code: "RSVP_CANCEL_FAILED", requestId: payload.requestId, error: "Error" });
    expect(logged.join("\n")).not.toMatch(/example\.test|Ada|Lovelace|Step-free/);
  });

  it("keeps the booking the guest was told about when only the organizer's email fails", async () => {
    const logs = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const payload = rsvpPayload({ eventId: EVENT_IDS.limited, guests: 3 });
    const outbound = mockProviders("rsvp", { emailStatus: (to) => (to === "team@example.test" ? 500 : 200) });
    const first = await fetchHandler(publicRequest("/v1/rsvp", payload), env);
    expect(first.status).toBe(202);
    const { confirmationId } = await first.json<RsvpSuccess>();
    expect(await count("rsvps")).toBe(1);
    expect(await guestsFor(EVENT_IDS.limited)).toBe(3);
    expect(outbound.emails().map((call) => (call.body as SentEmail).to[0])).toEqual([payload.email, "team@example.test"]);
    expect((sentTo(outbound, payload.email)[0].body as SentEmail).text).toContain(`Confirmation ID: ${confirmationId}`);

    // Logged with a code and the request id, never the visitor's details.
    const logged = logs.mock.calls.map((args) => String(args[0]));
    const line = logged.find((entry) => entry.includes("RSVP_ORGANIZER_EMAIL_FAILED"));
    expect(line && JSON.parse(line)).toEqual({ code: "RSVP_ORGANIZER_EMAIL_FAILED", requestId: payload.requestId, error: "UPSTREAM_FAILURE" });
    expect(logged.join("\n")).not.toMatch(/example\.test|Ada|Lovelace|Step-free/);

    // A replay returns the same RSVP and sends nothing new; the seats stay taken.
    const replay = await fetchHandler(publicRequest("/v1/rsvp", payload), env);
    expect(replay.status).toBe(202);
    await expect(replay.json()).resolves.toEqual({ ok: true, requestId: payload.requestId, confirmationId });
    expect(outbound.emails()).toHaveLength(2);
    const another = await fetchHandler(publicRequest("/v1/rsvp", rsvpPayload({ eventId: EVENT_IDS.limited, guests: 1 })), env);
    expect(another.status).toBe(409);
    expect((await errorBody(another)).error).toBe("EVENT_FULL");
  });

  it("drops bidi controls from the accessibility note, keeping its line breaks", async () => {
    const outbound = mockProviders("rsvp");
    const payload = rsvpPayload({ accessibility: "Wheelchair\u202e access\nNo \u2066nuts\u2069" });
    expect((await fetchHandler(publicRequest("/v1/rsvp", payload), env)).status).toBe(202);
    expect((await rsvpRow(payload.requestId))?.accessibility).toBe("Wheelchair access\nNo nuts");
    const [organizer] = sentTo(outbound, "team@example.test");
    expect((organizer.body as SentEmail).text).toContain("Wheelchair access\nNo nuts");
    expect((organizer.body as SentEmail).text).not.toMatch(/[\u202a-\u202e\u2066-\u2069]/u);
  });

  it("keeps the calendar's title to one line in the email subjects", async () => {
    const outbound = mockProviders("rsvp", { feedEvents: [feedEvent({ title: "Class\r\nBcc: attacker@example.test\u202e\tnight" })] });
    const payload = rsvpPayload();
    expect((await fetchHandler(publicRequest("/v1/rsvp", payload), env)).status).toBe(202);
    const subjects = outbound.emails().map((call) => (call.body as SentEmail).subject).sort();
    expect(subjects).toEqual(["New RSVP: Class Bcc: attacker@example.test night", "RSVP received: Class Bcc: attacker@example.test night"]);
    for (const call of outbound.emails()) {
      const sent = call.body as SentEmail;
      expect(sent.to).toHaveLength(1);
      expect(sent.text).not.toMatch(/Class\r?\nBcc/);
    }
  });
});

describe("GET /v1/rsvp/availability", () => {
  const AVAILABILITY_URL = "https://api.test/v1/rsvp/availability";

  function availability(requestOrigin?: string, url = AVAILABILITY_URL) {
    return fetchHandler(new Request(url, { headers: requestOrigin ? { Origin: requestOrigin } : {} }), env);
  }

  /** Empties the shared cache (Cache API), as when its 30 s are over. */
  async function expireSharedCache() {
    await sharedCache().delete(AVAILABILITY_URL);
  }

  beforeEach(expireSharedCache);

  it("reports full and remaining for every open event, counts only, with CORS for allowed origins only", async () => {
    mockProviders("rsvp");
    expect((await fetchHandler(publicRequest("/v1/rsvp", rsvpPayload({ eventId: EVENT_IDS.limited, guests: 2 })), env)).status).toBe(202);

    const response = await availability(origin);
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe(origin);
    expect(response.headers.get("cache-control")).toBe("public, max-age=30");
    expect(response.headers.get("vary")).toBe("Origin");
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({
      ok: true,
      events: {
        [EVENT_IDS.open]: { full: false, remaining: null },
        [EVENT_IDS.limited]: { full: false, remaining: 1 },
        [EVENT_IDS.started]: { full: false, remaining: null }
      }
    });
    expect(text).not.toMatch(/@|Ada|Lovelace|example\.test/);

    expect((await fetchHandler(publicRequest("/v1/rsvp", rsvpPayload({ eventId: EVENT_IDS.limited, guests: 1 })), env)).status).toBe(202);
    await expireSharedCache();
    const full = await (await availability(origin)).json<{ events: Record<string, unknown> }>();
    expect(full.events[EVENT_IDS.limited]).toEqual({ full: true, remaining: 0 });

    for (const other of ["https://attacker.test", undefined]) {
      const response = await availability(other);
      expect(response.status).toBe(200);
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
      expect(response.headers.get("vary")).toBe("Origin");
    }
  });

  it("shares one answer for 30 s through the Cache API: every origin and query string, CORS added per request", async () => {
    const outbound = mockProviders("rsvp");
    expect((await fetchHandler(publicRequest("/v1/rsvp", rsvpPayload({ eventId: EVENT_IDS.limited, guests: 2 })), env)).status).toBe(202);
    const first = await availability(origin);
    expect((await first.json<RsvpAvailability>()).events[EVENT_IDS.limited]).toEqual({ full: false, remaining: 1 });

    // Stored once, without any caller's origin, for at most 30 s.
    const stored = await sharedCache().match(AVAILABILITY_URL);
    expect(stored?.status).toBe(200);
    expect(stored?.headers.get("cache-control")).toBe("public, max-age=30");
    expect(stored?.headers.get("access-control-allow-origin")).toBeNull();

    // A booking within those 30 s isn't in the shared answer yet (the reserve itself is what counts).
    expect((await fetchHandler(publicRequest("/v1/rsvp", rsvpPayload({ eventId: EVENT_IDS.limited, guests: 1 })), env)).status).toBe(202);
    const feedReads = outbound.feed().length;
    for (const [caller, url] of [
      [origin, AVAILABILITY_URL],
      ["https://www.site.test", AVAILABILITY_URL],
      [undefined, AVAILABILITY_URL],
      // A query string can't get past the shared answer.
      [origin, `${AVAILABILITY_URL}?fresh=${crypto.randomUUID()}`]
    ] as const) {
      const response = await fetchHandler(new Request(url, { headers: caller ? { Origin: caller } : {} }), { ...env, ALLOWED_ORIGINS: `${origin},https://www.site.test` });
      expect(response.status, `${caller} ${url}`).toBe(200);
      expect(response.headers.get("access-control-allow-origin"), `${caller}`).toBe(caller ?? null);
      expect(response.headers.get("vary")).toBe("Origin");
      expect(response.headers.get("cache-control")).toBe("public, max-age=30");
      expect((await response.json<RsvpAvailability>()).events[EVENT_IDS.limited]).toEqual({ full: false, remaining: 1 });
    }
    expect(outbound.feed()).toHaveLength(feedReads);

    // Once the 30 s are over, the next answer is read afresh.
    await expireSharedCache();
    expect((await (await availability(origin)).json<RsvpAvailability>()).events[EVENT_IDS.limited]).toEqual({ full: true, remaining: 0 });
  });

  it("answers 503 EVENTS_UNAVAILABLE, not cacheable, when the feed can't be read, and stores nothing", async () => {
    mockProviders("rsvp", { feedResponse: () => new Response("", { status: 302, headers: { Location: "https://tzionbreslov.com/" } }) });
    const response = await availability(origin);
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("access-control-allow-origin")).toBe(origin);
    expect((await errorBody(response)).error).toBe("EVENTS_UNAVAILABLE");
    expect(await sharedCache().match(AVAILABILITY_URL)).toBeUndefined();

    // The feed is back: the very next request answers, nothing of the failure kept.
    vi.restoreAllMocks();
    resetEventFeedCache();
    mockProviders("rsvp");
    expect((await availability(origin)).status).toBe(200);
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
  const DAY = 24 * HOUR;
  const at = (offset: number) => new Date(Date.now() + offset).toISOString();
  // Feed-valid ids (EVENT_ID_PATTERN), named after what each test does with the event.
  const CLEANUP = {
    endedYesterday: "c0000000000000000000000a",
    endsTomorrow: "c0000000000000000000000b",
    multiDay: "c0000000000000000000000c",
    allDayYesterday: "c0000000000000000000000d",
    allDayToday: "c0000000000000000000000e",
    movedLater: "c0000000000000000000000f",
    movedEarlierEnded: "c00000000000000000000010",
    movedEarlierUpcoming: "c00000000000000000000011",
    removedEnded: "c00000000000000000000012",
    removedUpcoming: "c00000000000000000000013",
    endedSixDaysAgo: "c00000000000000000000014",
    endedEightDaysAgo: "c00000000000000000000015"
  } as const;
  const nameOf = (id: string) => Object.entries(CLEANUP).find(([, value]) => value === id)?.[0] ?? id;

  /** Runs the daily cron (worker.scheduled) to the end. */
  async function runScheduledCleanup() {
    const pending: Promise<unknown>[] = [];
    worker.scheduled({} as ScheduledController, env, { waitUntil: (promise) => pending.push(promise) });
    await Promise.all(pending);
  }

  /** One RSVP per event, stored as the Worker stores it (reserveRsvp doesn't check whether the event has started). */
  async function reserveEach(events: FeedEvent[]) {
    for (const [n, event] of events.entries()) {
      expect((await reserveRsvp(env, reserveInput(), event, `hash-${n}`)).created, nameOf(event.id)).toBe(true);
    }
  }

  /** The events that still have RSVPs (by name), and the end each RSVP stores. */
  async function remaining() {
    const { results } = await env.DB.prepare("SELECT event_id, event_ends_at FROM rsvps ORDER BY event_id")
      .all<{ event_id: string; event_ends_at: string }>();
    return Object.fromEntries(results.map((row) => [nameOf(row.event_id), row.event_ends_at]));
  }

  it("removes expired rate limits, confirmations, webhook rows and old request logs", async () => {
    mockProviders("cleanup");
    const now = Date.now();
    const old = now - 31 * 86_400_000;
    await env.DB.batch([
      env.DB.prepare("INSERT INTO rate_limits (key, bucket, count, expires_at) VALUES ('k', 1, 1, 1)"),
      env.DB.prepare("INSERT INTO request_log (request_id, route, status, created_at, updated_at) VALUES ('old-contact', 'contact', 'succeeded', ?, ?)").bind(old, old),
      env.DB.prepare("INSERT INTO request_log (request_id, route, status, created_at, updated_at) VALUES ('old-subscribe', 'subscribe', 'succeeded', ?, ?)").bind(old, old),
      env.DB.prepare("INSERT INTO subscription_confirmations (id, request_id, token_hash, email, expires_at, created_at) VALUES ('c1', 'old-subscribe', 'hash', 'a@example.test', ?, ?)").bind(old, old),
      env.DB.prepare("INSERT INTO webhook_events (provider, event_id, event_type, payload_json, received_at) VALUES ('resend', 'e1', 't', '{}', ?)").bind(now - 91 * 86_400_000)
    ]);
    await runScheduledCleanup();
    for (const table of ["rate_limits", "request_log", "subscription_confirmations", "webhook_events"]) {
      expect(await count(table), table).toBe(0);
    }
  });

  it("deletes an RSVP at the first daily clean-up after its event ends, and keeps it until then", async () => {
    const events = {
      endedYesterday: feedEvent({ id: CLEANUP.endedYesterday, startsAt: at(-DAY - 2 * HOUR), endsAt: at(-DAY) }),
      endsTomorrow: feedEvent({ id: CLEANUP.endsTomorrow, startsAt: at(DAY - 2 * HOUR), endsAt: at(DAY) }),
      // Started yesterday, ends tomorrow: kept while it is still on.
      multiDay: feedEvent({ id: CLEANUP.multiDay, startsAt: at(-DAY), endsAt: at(DAY) }),
      // Yesterday, all day: its exclusive end, today's UTC midnight, has passed.
      allDayYesterday: feedEvent({ id: CLEANUP.allDayYesterday, allDay: true, timeZone: "UTC", startsAt: utcMidnight(-1), endsAt: utcMidnight(0) }),
      // Today, all day: kept until its exclusive end, tomorrow's UTC midnight (the cron runs at 03:17 UTC).
      allDayToday: feedEvent({ id: CLEANUP.allDayToday, allDay: true, timeZone: "UTC", startsAt: utcMidnight(0), endsAt: utcMidnight(1) })
    };
    await reserveEach(Object.values(events));
    // The feed lists the events that haven't ended, as the site publishes it.
    mockProviders("cleanup", { feedEvents: [events.endsTomorrow, events.multiDay, events.allDayToday] });
    await runScheduledCleanup();
    expect(Object.keys(await remaining()).sort()).toEqual(["allDayToday", "endsTomorrow", "multiDay"]);
  });

  it("follows the calendar when an event is moved: its RSVPs take the feed's current end (UPDATE … FROM in D1)", async () => {
    // As the events were when the RSVPs were made.
    await reserveEach([
      feedEvent({ id: CLEANUP.movedLater, startsAt: at(-3 * HOUR), endsAt: at(-HOUR) }),
      feedEvent({ id: CLEANUP.movedEarlierEnded, startsAt: at(5 * DAY), endsAt: at(5 * DAY + 2 * HOUR) }),
      feedEvent({ id: CLEANUP.movedEarlierUpcoming, startsAt: at(5 * DAY), endsAt: at(5 * DAY + 2 * HOUR) })
    ]);
    // The calendar now: postponed to tomorrow (it was to end an hour ago); brought forward to earlier
    // today (the feed, built before it ended, still lists it); brought forward to tomorrow.
    const calendar = {
      movedLater: feedEvent({ id: CLEANUP.movedLater, startsAt: at(DAY), endsAt: at(DAY + 2 * HOUR) }),
      movedEarlierEnded: feedEvent({ id: CLEANUP.movedEarlierEnded, startsAt: at(-3 * HOUR), endsAt: at(-HOUR) }),
      movedEarlierUpcoming: feedEvent({ id: CLEANUP.movedEarlierUpcoming, startsAt: at(DAY), endsAt: at(DAY + 2 * HOUR) })
    };
    mockProviders("cleanup", { feedEvents: Object.values(calendar) });
    await runScheduledCleanup();
    expect(await remaining()).toEqual({
      movedLater: sqliteTime(calendar.movedLater.endsAt),
      movedEarlierUpcoming: sqliteTime(calendar.movedEarlierUpcoming.endsAt)
    });
  });

  it("keeps the stored end of an event the feed no longer lists (removed from the calendar)", async () => {
    const removedUpcoming = feedEvent({ id: CLEANUP.removedUpcoming, startsAt: at(DAY), endsAt: at(DAY + 2 * HOUR) });
    await reserveEach([feedEvent({ id: CLEANUP.removedEnded, startsAt: at(-DAY - 2 * HOUR), endsAt: at(-DAY) }), removedUpcoming]);
    mockProviders("cleanup");
    await runScheduledCleanup();
    expect(await remaining()).toEqual({ removedUpcoming: sqliteTime(removedUpcoming.endsAt) });
  });

  it("while the feed can't be read, still deletes the RSVPs whose stored end is more than 7 days past: 8 days deleted, 6 days kept", async () => {
    await reserveEach([
      feedEvent({ id: CLEANUP.endedEightDaysAgo, startsAt: at(-8 * DAY - 2 * HOUR), endsAt: at(-8 * DAY) }),
      feedEvent({ id: CLEANUP.endedSixDaysAgo, startsAt: at(-6 * DAY - 2 * HOUR), endsAt: at(-6 * DAY) }),
      feedEvent({ id: CLEANUP.endedYesterday, startsAt: at(-DAY - 2 * HOUR), endsAt: at(-DAY) })
    ]);
    const logs = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const outbound = mockProviders("cleanup", { feedResponse: () => new Response("", { status: 503 }) });
    await runScheduledCleanup();
    expect(outbound.feed()).toHaveLength(1);
    expect(Object.keys(await remaining()).sort()).toEqual(["endedSixDaysAgo", "endedYesterday"]);
    expect(logs.mock.calls.map(([line]) => JSON.parse(String(line)))).toEqual([
      { code: "RSVP_CLEANUP_FEED_UNAVAILABLE", error: "EVENTS_UNAVAILABLE" }
    ]);
  });

  it("with the feed read, the 7 days play no part: the feed's end decides (a long-ended stored end moved later is kept)", async () => {
    // Stored 8 days ago, since moved to tomorrow in the calendar; and one the feed no longer lists, ended 6 days ago.
    await reserveEach([
      feedEvent({ id: CLEANUP.endedEightDaysAgo, startsAt: at(-8 * DAY - 2 * HOUR), endsAt: at(-8 * DAY) }),
      feedEvent({ id: CLEANUP.endedSixDaysAgo, startsAt: at(-6 * DAY - 2 * HOUR), endsAt: at(-6 * DAY) })
    ]);
    const movedLater = feedEvent({ id: CLEANUP.endedEightDaysAgo, startsAt: at(DAY), endsAt: at(DAY + 2 * HOUR) });
    mockProviders("cleanup", { feedEvents: [movedLater] });
    await runScheduledCleanup();
    expect(await remaining()).toEqual({ endedEightDaysAgo: sqliteTime(movedLater.endsAt) });
  });

  it("while the feed can't be read, keeps the RSVPs that ended within the last 7 days, logs only a code, and still runs the other clean-ups", async () => {
    await reserveEach([feedEvent({ id: CLEANUP.endedYesterday, startsAt: at(-DAY - 2 * HOUR), endsAt: at(-DAY) })]);
    await env.DB.prepare("INSERT INTO rate_limits (key, bucket, count, expires_at) VALUES ('k', 1, 1, 1)").run();
    const logs = vi.spyOn(console, "error").mockImplementation(() => undefined);
    // E.g. before switch day, while tzionbreslov.org still redirects to the old site.
    const outbound = mockProviders("cleanup", { feedResponse: () => new Response("", { status: 302, headers: { Location: "https://tzionbreslov.com/" } }) });
    await runScheduledCleanup();
    expect(outbound.feed()).toHaveLength(1);
    expect(Object.keys(await remaining())).toEqual(["endedYesterday"]);
    expect(await count("rate_limits")).toBe(0);
    expect(logs.mock.calls.map(([line]) => JSON.parse(String(line)))).toEqual([
      { code: "RSVP_CLEANUP_FEED_UNAVAILABLE", error: "EVENTS_UNAVAILABLE" }
    ]);
  });

  it("gives up on a feed that doesn't answer within 10 s: an RSVP that ended yesterday is kept, the other clean-ups still run", async () => {
    await reserveEach([feedEvent({ id: CLEANUP.endedYesterday, startsAt: at(-DAY - 2 * HOUR), endsAt: at(-DAY) })]);
    await env.DB.prepare("INSERT INTO rate_limits (key, bucket, count, expires_at) VALUES ('k', 1, 1, 1)").run();
    const logs = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const asked = shortenTimeouts();
    mockProviders("cleanup", { feedHangs: true });
    await runScheduledCleanup();
    expect(asked).toEqual([10_000]);
    expect(Object.keys(await remaining())).toEqual(["endedYesterday"]);
    expect(await count("rate_limits")).toBe(0);
    expect(logs.mock.calls.map(([line]) => JSON.parse(String(line)))).toEqual([
      { code: "RSVP_CLEANUP_FEED_UNAVAILABLE", error: "EVENTS_UNAVAILABLE" }
    ]);
  });

  it("with an empty feed (no calendar address set yet) the UPDATE changes nothing and the stored ends decide", async () => {
    const endsTomorrow = feedEvent({ id: CLEANUP.endsTomorrow, startsAt: at(DAY - 2 * HOUR), endsAt: at(DAY) });
    await reserveEach([feedEvent({ id: CLEANUP.endedYesterday, startsAt: at(-DAY - 2 * HOUR), endsAt: at(-DAY) }), endsTomorrow]);
    const outbound = mockProviders("cleanup", { feedEvents: [] });
    await runScheduledCleanup();
    expect(outbound.feed()).toHaveLength(1);
    expect(await remaining()).toEqual({ endsTomorrow: sqliteTime(endsTomorrow.endsAt) });
  });
});

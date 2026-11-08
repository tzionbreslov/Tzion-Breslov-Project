import type { SubscribeTopic } from "../../lib/api-contract";
import { sha256Hex } from "./crypto";
import type { FeedEvent } from "./events";
import { PublicError, eventFull, requireSalt, type Env } from "./types";
import type { RsvpInput } from "./validation";

type RequestRow = {
  status: "processing" | "succeeded" | "failed";
  response_json: string | null;
  updated_at: number;
};

export type ClaimResult =
  | { state: "claimed" }
  | { state: "completed"; response: Record<string, unknown> }
  | { state: "processing" };

export async function claimRequest(env: Env, requestId: string, route: string): Promise<ClaimResult> {
  const now = Date.now();
  const inserted = await env.DB.prepare(
    "INSERT OR IGNORE INTO request_log (request_id, route, status, created_at, updated_at) VALUES (?, ?, 'processing', ?, ?)"
  ).bind(requestId, route, now, now).run();
  if ((inserted.meta.changes ?? 0) > 0) return { state: "claimed" };

  const existing = await env.DB.prepare(
    "SELECT status, response_json, updated_at FROM request_log WHERE request_id = ? AND route = ?"
  ).bind(requestId, route).first<RequestRow>();
  if (!existing) throw new PublicError("REQUEST_ID_CONFLICT");
  if (existing.status === "succeeded") {
    let response: Record<string, unknown> = { ok: true, requestId };
    try {
      if (existing.response_json) response = JSON.parse(existing.response_json) as Record<string, unknown>;
    } catch {
      // The generic success response is safe if a stored response cannot be decoded.
    }
    return { state: "completed", response };
  }

  const stale = existing.updated_at < now - 5 * 60_000;
  if (existing.status === "failed" || stale) {
    const reclaimed = await env.DB.prepare(
      "UPDATE request_log SET status = 'processing', response_json = NULL, updated_at = ? WHERE request_id = ? AND route = ? AND updated_at = ?"
    ).bind(now, requestId, route, existing.updated_at).run();
    if ((reclaimed.meta.changes ?? 0) > 0) return { state: "claimed" };
  }
  return { state: "processing" };
}

export async function finishRequest(env: Env, requestId: string, succeeded: boolean, response?: Record<string, unknown>) {
  await env.DB.prepare(
    "UPDATE request_log SET status = ?, response_json = ?, updated_at = ? WHERE request_id = ?"
  ).bind(succeeded ? "succeeded" : "failed", response ? JSON.stringify(response) : null, Date.now(), requestId).run();
}

export async function enforceRateLimit(
  env: Env,
  discriminator: string,
  limit: number,
  windowSeconds: number
) {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const bucket = Math.floor(nowSeconds / windowSeconds);
  const row = await env.DB.prepare(
    `INSERT INTO rate_limits (key, bucket, count, expires_at)
     VALUES (?, ?, 1, ?)
     ON CONFLICT(key, bucket) DO UPDATE SET count = count + 1
     RETURNING count`
  ).bind(discriminator, bucket, (bucket + 2) * windowSeconds).first<{ count: number }>();
  if (!row || row.count > limit) throw new PublicError("RATE_LIMITED");
}

/**
 * Stores the pending confirmation for this requestId (first attempt wins) and
 * returns the email actually stored for it. A retry of the same requestId keeps
 * the first attempt's row, so the caller must compare and only ever mail the
 * stored address (never a different email sent with a reused requestId).
 */
export async function createSubscriptionConfirmation(
  env: Env,
  input: { requestId: string; email: string; topics: SubscribeTopic[] },
  tokenHash: string
): Promise<string | null> {
  const now = Date.now();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO subscription_confirmations
      (id, request_id, token_hash, email, topics_json, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    crypto.randomUUID(),
    input.requestId,
    tokenHash,
    input.email,
    JSON.stringify(input.topics),
    now + 24 * 60 * 60_000,
    now
  ).run();
  const row = await env.DB.prepare("SELECT email FROM subscription_confirmations WHERE request_id = ?")
    .bind(input.requestId)
    .first<{ email: string }>();
  return row?.email ?? null;
}

export type ConfirmationRow = {
  id: string;
  email: string;
  /** JSON list of SubscribeTopic (rows from before migration 0002: '["newsletter"]'). */
  topics_json: string;
  used_at: number | null;
};

export async function findSubscriptionConfirmation(env: Env, tokenHash: string) {
  return env.DB.prepare(
    `SELECT id, email, topics_json, used_at
     FROM subscription_confirmations
     WHERE token_hash = ? AND expires_at > ?`
  ).bind(tokenHash, Date.now()).first<ConfirmationRow>();
}

export async function markSubscriptionConfirmationUsed(env: Env, id: string) {
  const result = await env.DB.prepare(
    "UPDATE subscription_confirmations SET used_at = ? WHERE id = ? AND used_at IS NULL"
  ).bind(Date.now(), id).run();
  return (result.meta.changes ?? 0) === 1;
}

export async function storeWebhookEvent(env: Env, provider: "resend", eventId: string, eventType: string, payload: string) {
  const result = await env.DB.prepare(
    `INSERT OR IGNORE INTO webhook_events (provider, event_id, event_type, payload_json, received_at)
     VALUES (?, ?, ?, ?, ?)`
  ).bind(provider, eventId, eventType, payload, Date.now()).run();
  return (result.meta.changes ?? 0) === 1;
}

type RsvpRequestRow = { id: string; event_id: string; email_hash: string; created_at: number; confirmed_at: number | null };

const RSVP_FOR_REQUEST = "SELECT id, event_id, email_hash, created_at, confirmed_at FROM rsvps WHERE request_id = ?";

/**
 * How long an attempt can hold an RSVP unconfirmed. It takes the seats, emails
 * the guest (a Resend call gives up after 10 s: providers.ts,
 * RESEND_TIMEOUT_MS), then confirms the RSVP or gives the seats back (D1).
 * That work runs under waitUntil (index.ts, handleRsvp), so a visitor whose
 * connection drops doesn't stop it. An unconfirmed row older than this was
 * left by an attempt that stopped all the same (the Worker's run ended, or D1
 * failed to confirm it or give it back): the next attempt with its requestId
 * books it again (reserveRsvp). Such an attempt is a retry of the same
 * submission (the site keeps the requestId and the Turnstile token after a
 * network failure or a 5xx), and it waits for the row to turn stale rather
 * than answering REQUEST_IN_PROGRESS (confirmedRsvp), so the retry books it in
 * one call, well inside the token's 5 minutes and the email's rate limit.
 */
const PENDING_STALE_MS = 30_000;
/**
 * How a request waits while another attempt with its requestId is emailing the guest (confirmedRsvp). It reads
 * the row again after 200 ms, and each wait after that doubles, up to PENDING_POLL_MAX_MS: reads at 0, 0.2, 0.6,
 * 1.4, 3 and 6.2 s, then every 4 s. No wait runs past the moment the row turns stale, or past the request's own
 * deadline, so a retry books a stale row as soon as it can. A confirmed or given-back row is noticed within one
 * wait: an attempt that finishes its emails within 2 s of the first read is seen at 3 s at the latest. A full
 * 30 s wait reads the row 12 times (a read every 200 ms made about 150). Each read is a D1 query, and Workers
 * Free allows 50 per invocation (D1 limits, "Queries per Worker invocation"), so the wait works on any plan.
 */
const PENDING_POLL_MS = 200;
/** The longest wait between two reads of a pending row (PENDING_POLL_MS). */
const PENDING_POLL_MAX_MS = 4_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The row stored for a requestId must be the same visitor's RSVP to the same event. */
function sameRequest(row: RsvpRequestRow | null, eventId: string, emailHash: string) {
  if (row && (row.event_id !== eventId || row.email_hash !== emailHash)) throw new PublicError("REQUEST_ID_CONFLICT");
  return row;
}

/**
 * The confirmation id of this requestId's RSVP once its guest has been
 * emailed (a replay answers it and sends nothing new), or null when there is
 * none to answer: never made, given back by its attempt, or left unconfirmed
 * by an attempt that stopped (PENDING_STALE_MS; reserveRsvp books it again).
 * While another attempt is still emailing the guest, it waits for that
 * attempt's outcome, reading the row again after waits that grow from 200 ms
 * to 4 s (PENDING_POLL_MS), at most `waitMs`: by default as long as the row can
 * be pending, so it never gives up before the row turns stale. Only a shorter
 * wait (the tests), or another isolate's clock running ahead of this one,
 * answers REQUEST_IN_PROGRESS (retry with the same requestId). A row for
 * another event or email is REQUEST_ID_CONFLICT.
 */
export async function confirmedRsvp(env: Env, requestId: string, eventId: string, emailHash: string, waitMs = PENDING_STALE_MS) {
  const deadline = Date.now() + waitMs;
  for (let wait = PENDING_POLL_MS; ; wait = Math.min(wait * 2, PENDING_POLL_MAX_MS)) {
    const row = sameRequest(await env.DB.prepare(RSVP_FOR_REQUEST).bind(requestId).first<RsvpRequestRow>(), eventId, emailHash);
    if (!row) return null;
    if (row.confirmed_at !== null) return row.id;
    const now = Date.now();
    if (row.created_at < now - PENDING_STALE_MS) return null;
    if (now >= deadline) throw new PublicError("REQUEST_IN_PROGRESS");
    // Wake no later than the first millisecond the row counts as stale (the check above is strict), or the deadline.
    await sleep(Math.min(wait, row.created_at + PENDING_STALE_MS + 1 - now, deadline - now));
  }
}

/**
 * The RSVP's confirmation id (rsvps.id, shown to the guest), derived from its
 * requestId: a retry of the same request gets the same id, so its guest email
 * is identical and Resend's idempotency key (rsvp-guest/{requestId}) accepts
 * it. A RATE_LIMIT_SALT-keyed SHA-256, so it reveals nothing and can't be
 * guessed from the requestId, shaped like a UUID (version 8, "custom"): 122
 * random-looking bits, unique as long as requestIds are (request_id is UNIQUE).
 * Like every salted hash, it fails closed on a salt under 32 characters.
 */
export async function rsvpConfirmationId(env: Env, requestId: string) {
  const hex = await sha256Hex(`${requireSalt(env)}:rsvp-confirmation:${requestId}`);
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-8${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** SQLite's "YYYY-MM-DD HH:MM:SS" (UTC), so the cleanup can compare it with datetime('now'). */
const sqliteTime = (iso: string) => new Date(Date.parse(iso)).toISOString().slice(0, 19).replace("T", " ");

/**
 * A new RSVP (`created: true`) holds its seats unconfirmed since `heldSince`:
 * its attempt emails the guest, then confirmRsvp, or cancelRsvp if that email
 * fails. `created: false` is a confirmed RSVP answered again (nothing is sent).
 */
export type Reservation = { id: string; created: false } | { id: string; created: true; heldSince: number };

/**
 * Stores the RSVP if the event's limit still has room for its guests. The
 * check and the insert are ONE statement, so simultaneous RSVPs can't both
 * take the last seats; a refusal is EVENT_FULL with the places left as that
 * statement saw them. A repeated requestId answers its confirmed RSVP, after
 * waiting for an attempt still in progress (confirmedRsvp); if that attempt
 * gives its seats back, this one books them. The event's end is stored with
 * it (kept up to date from the feed by the daily cleanup, which deletes the
 * RSVP once that end has passed).
 */
export async function reserveRsvp(
  env: Env,
  input: Pick<RsvpInput, "requestId" | "name" | "email" | "guests" | "accessibility">,
  event: FeedEvent,
  emailHash: string,
  waitMs = PENDING_STALE_MS
): Promise<Reservation> {
  const id = await rsvpConfirmationId(env, input.requestId);
  // One round, unless another attempt with this requestId held the RSVP and then gave it back.
  for (let round = 0; round < 3; round += 1) {
    const confirmed = await confirmedRsvp(env, input.requestId, event.id, emailHash, waitMs);
    if (confirmed) return { id: confirmed, created: false };
    const now = Date.now();
    const [, inserted, holder, booked] = await env.DB.batch<Record<string, unknown>>([
      // A row its attempt left unconfirmed for longer than PENDING_STALE_MS gives its seats back first, in the same
      // transaction, and is booked again below (Resend's idempotency keys stop a second copy of an email it had sent).
      env.DB.prepare("DELETE FROM rsvps WHERE request_id = ? AND confirmed_at IS NULL AND created_at < ?")
        .bind(input.requestId, now - PENDING_STALE_MS),
      // ?12 (the limit) is NULL when the event has no limit.
      env.DB.prepare(
        `INSERT OR IGNORE INTO rsvps
          (id, request_id, event_id, event_starts_at, event_ends_at, name, email, email_hash, guests, accessibility, created_at)
         SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11
         WHERE ?12 IS NULL OR COALESCE((SELECT SUM(guests) FROM rsvps WHERE event_id = ?3), 0) + ?9 <= ?12`
      ).bind(
        id,
        input.requestId,
        event.id,
        sqliteTime(event.startsAt),
        sqliteTime(event.endsAt),
        input.name,
        input.email,
        emailHash,
        input.guests,
        input.accessibility || null,
        now,
        event.limit
      ),
      env.DB.prepare(RSVP_FOR_REQUEST).bind(input.requestId),
      // The event's guests as this reservation saw them (one transaction): the places left, if it is refused.
      env.DB.prepare("SELECT COALESCE(SUM(guests), 0) AS guests FROM rsvps WHERE event_id = ?").bind(event.id)
    ]);
    if ((inserted.meta.changes ?? 0) === 1) return { id, created: true, heldSince: now };
    // Not inserted: another attempt with this requestId holds it (the next round waits for its outcome), or the
    // event is full.
    const held = sameRequest((holder.results[0] as RsvpRequestRow | undefined) ?? null, event.id, emailHash);
    if (!held && event.limit !== null) throw eventFull(event.limit - Number(booked.results[0]?.guests ?? 0));
  }
  throw new PublicError("REQUEST_IN_PROGRESS");
}

/**
 * The guest has been emailed: the RSVP this attempt took at `heldSince` stands,
 * a replay answers it, and no attempt gives it back. Only that row, as
 * cancelRsvp: never one another attempt has since booked again.
 */
export async function confirmRsvp(env: Env, id: string, heldSince: number) {
  await env.DB.prepare("UPDATE rsvps SET confirmed_at = ? WHERE id = ? AND created_at = ? AND confirmed_at IS NULL")
    .bind(Date.now(), id, heldSince).run();
}

/**
 * Gives back the seats of the RSVP this attempt took at `heldSince`, when its
 * guest email could not be sent (the visitor retries). Only that unconfirmed
 * row: never one another attempt has since confirmed or booked again.
 */
export async function cancelRsvp(env: Env, id: string, heldSince: number) {
  await env.DB.prepare("DELETE FROM rsvps WHERE id = ? AND confirmed_at IS NULL AND created_at = ?").bind(id, heldSince).run();
}

/** Guests booked so far per event, for the given events (counts only). */
export async function rsvpGuestTotals(env: Env, eventIds: string[]): Promise<Map<string, number>> {
  const totals = new Map<string, number>();
  if (!eventIds.length) return totals;
  const { results } = await env.DB.prepare(
    `SELECT event_id, SUM(guests) AS guests
     FROM rsvps
     WHERE event_id IN (SELECT value FROM json_each(?))
     GROUP BY event_id`
  ).bind(JSON.stringify(eventIds)).all<{ event_id: string; guests: number }>();
  for (const row of results) totals.set(row.event_id, row.guests);
  return totals;
}

/**
 * Daily cron: expire rate-limit buckets, pending confirmations, webhook audit
 * rows, old request logs, and the RSVPs of events that are over (owner
 * decision 2026-11-07).
 *
 * `feed` is the site's /events.json as read now. First, every RSVP of an
 * event it lists takes that event's current end, so an event moved in the
 * calendar keeps its RSVPs until its new end (it keeps its id when moved). An
 * event the feed no longer lists (removed, or already over) keeps the end its
 * RSVPs stored. Then the RSVPs whose end has passed are deleted.
 *
 * With no feed (null: it couldn't be read), only the RSVPs whose stored end is
 * more than 7 days past are deleted (Ruling for follow-up Group 6): an event
 * moved in the calendar could have a later end the Worker can't see, so
 * losing its guest list, and reopening its seats, is worse than keeping RSVPs
 * a few days longer; but nothing is kept for good while the feed is down. The
 * feed is normally up, so RSVPs normally go within a day of the event. The
 * other clean-ups never depend on the feed.
 */
export async function cleanExpiredData(env: Env, feed: FeedEvent[] | null) {
  const now = Date.now();
  const rsvps = feed ? [
    // UPDATE … FROM (SQLite 3.33+): proven by the Worker tests and on a local D1; README → Switch day,
    // steps 1 and 2, checks the live D1. Rows whose end already matches aren't rewritten.
    env.DB.prepare(
      `UPDATE rsvps SET event_ends_at = feed.ends_at
       FROM (SELECT json_extract(value, '$.id') AS id, json_extract(value, '$.end') AS ends_at FROM json_each(?)) AS feed
       WHERE rsvps.event_id = feed.id AND rsvps.event_ends_at <> feed.ends_at`
    ).bind(JSON.stringify(feed.map((event) => ({ id: event.id, end: sqliteTime(event.endsAt) })))),
    env.DB.prepare("DELETE FROM rsvps WHERE event_ends_at < datetime('now')")
  ] : [
    env.DB.prepare("DELETE FROM rsvps WHERE event_ends_at < datetime('now', '-7 days')")
  ];
  await env.DB.batch([
    env.DB.prepare("DELETE FROM rate_limits WHERE expires_at < ?").bind(Math.floor(now / 1000)),
    env.DB.prepare("DELETE FROM subscription_confirmations WHERE expires_at < ?").bind(now),
    env.DB.prepare("DELETE FROM webhook_events WHERE received_at < ?").bind(now - 90 * 86_400_000),
    env.DB.prepare(
      `DELETE FROM request_log
       WHERE created_at < ?
         AND NOT EXISTS (SELECT 1 FROM subscription_confirmations WHERE subscription_confirmations.request_id = request_log.request_id)`
    ).bind(now - 30 * 86_400_000),
    ...rsvps
  ]);
}

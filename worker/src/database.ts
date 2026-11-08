import type { SubscribeTopic } from "../../lib/api-contract";
import { sha256Hex } from "./crypto";
import type { FeedEvent } from "./events";
import { PublicError, requireSalt, type Env } from "./types";
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

type RsvpRequestRow = { id: string; event_id: string; email_hash: string };

/** The RSVP already stored for this requestId, which must be the same visitor's RSVP to the same event. */
export async function rsvpForRequest(env: Env, requestId: string, eventId: string, emailHash: string) {
  const row = await env.DB.prepare("SELECT id, event_id, email_hash FROM rsvps WHERE request_id = ?")
    .bind(requestId).first<RsvpRequestRow>();
  if (row && (row.event_id !== eventId || row.email_hash !== emailHash)) throw new PublicError("REQUEST_ID_CONFLICT");
  return row ? { id: row.id, created: false } : null;
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
 * Stores the RSVP if the event's limit still has room for its guests. The
 * check and the insert are ONE statement, so simultaneous RSVPs can't both
 * take the last seats. A repeated requestId returns its stored RSVP
 * (`created: false`, nothing new is sent). The event's end is stored with it
 * (kept up to date from the feed by the daily cleanup, which deletes the RSVP
 * once that end has passed).
 */
export async function reserveRsvp(
  env: Env,
  input: Pick<RsvpInput, "requestId" | "name" | "email" | "guests" | "accessibility">,
  event: FeedEvent,
  emailHash: string
): Promise<{ id: string; created: boolean }> {
  const existing = await rsvpForRequest(env, input.requestId, event.id, emailHash);
  if (existing) return existing;

  const id = await rsvpConfirmationId(env, input.requestId);
  // ?12 (the limit) is NULL when the event has no limit.
  const result = await env.DB.prepare(
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
    Date.now(),
    event.limit
  ).run();
  if ((result.meta.changes ?? 0) === 1) return { id, created: true };

  // Not inserted: the same requestId won a race just now, or the event is full.
  const concurrent = await rsvpForRequest(env, input.requestId, event.id, emailHash);
  if (concurrent) return concurrent;
  throw new PublicError("EVENT_FULL");
}

/** Gives a just-created RSVP's seats back (its emails could not be sent; the visitor retries). */
export async function cancelRsvp(env: Env, id: string) {
  await env.DB.prepare("DELETE FROM rsvps WHERE id = ?").bind(id).run();
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
 * RSVPs stored. Then the RSVPs whose end has passed are deleted. With no feed
 * (null: it couldn't be read), no RSVP is deleted that day: losing a moved
 * event's guest list, and reopening its seats, is worse than keeping RSVPs a
 * day longer. The other clean-ups never depend on the feed.
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
  ] : [];
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

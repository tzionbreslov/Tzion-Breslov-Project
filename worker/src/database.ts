import { PublicError, type Env } from "./types";

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
  input: { requestId: string; email: string },
  tokenHash: string
): Promise<string | null> {
  const now = Date.now();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO subscription_confirmations
      (id, request_id, token_hash, email, expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(
    crypto.randomUUID(),
    input.requestId,
    tokenHash,
    input.email,
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
  used_at: number | null;
};

export async function findSubscriptionConfirmation(env: Env, tokenHash: string) {
  return env.DB.prepare(
    `SELECT id, email, used_at
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

/** Daily cron: expire rate-limit buckets, pending confirmations, webhook audit rows, and old request logs. */
export async function cleanExpiredData(env: Env) {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM rate_limits WHERE expires_at < ?").bind(Math.floor(now / 1000)),
    env.DB.prepare("DELETE FROM subscription_confirmations WHERE expires_at < ?").bind(now),
    env.DB.prepare("DELETE FROM webhook_events WHERE received_at < ?").bind(now - 90 * 86_400_000),
    env.DB.prepare(
      `DELETE FROM request_log
       WHERE created_at < ?
         AND NOT EXISTS (SELECT 1 FROM subscription_confirmations WHERE subscription_confirmations.request_id = request_log.request_id)`
    ).bind(now - 30 * 86_400_000)
  ]);
}

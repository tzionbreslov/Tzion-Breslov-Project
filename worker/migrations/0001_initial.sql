PRAGMA foreign_keys = ON;

-- Idempotency ledger: one row per client requestId (contact or subscribe).
CREATE TABLE request_log (
  request_id TEXT PRIMARY KEY,
  route TEXT NOT NULL CHECK (route IN ('contact', 'subscribe')),
  status TEXT NOT NULL CHECK (status IN ('processing', 'succeeded', 'failed')),
  response_json TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX request_log_created_at_idx ON request_log(created_at);

-- Fixed-window counters keyed by route + salted hash of IP or email.
CREATE TABLE rate_limits (
  key TEXT NOT NULL,
  bucket INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (key, bucket)
);

CREATE INDEX rate_limits_expires_at_idx ON rate_limits(expires_at);

-- Pending newsletter double opt-in links (24 h). Only the SHA-256 of the token is stored.
CREATE TABLE subscription_confirmations (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE REFERENCES request_log(request_id),
  token_hash TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX subscription_confirmations_expires_at_idx ON subscription_confirmations(expires_at);

-- Verified Resend webhook deliveries (deduplicated by provider event id, kept 90 days).
CREATE TABLE webhook_events (
  provider TEXT NOT NULL,
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  PRIMARY KEY (provider, event_id)
);

CREATE INDEX webhook_events_received_at_idx ON webhook_events(received_at);

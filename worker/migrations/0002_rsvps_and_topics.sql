-- RSVPs for the Events page, and the lists a subscriber chose. Additive only:
-- request_log's route CHECK ('contact', 'subscribe') is live in production and
-- stays untouched, so an RSVP never goes there; rsvps.request_id UNIQUE is its
-- idempotency key.

-- One row per RSVP. event_id / event_starts_at come from the site's /events.json
-- (the Google Calendar); event_starts_at is UTC in SQLite's "YYYY-MM-DD HH:MM:SS",
-- so the daily cleanup compares it with datetime('now', …) and deletes a row
-- RSVP_RETENTION_DAYS after its event started. email_hash is the salted hash the
-- rate limiter uses (a reused requestId must come from the same email).
CREATE TABLE rsvps (
  id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, event_id TEXT NOT NULL, event_starts_at TEXT NOT NULL,
  name TEXT NOT NULL, email TEXT NOT NULL, email_hash TEXT NOT NULL,
  guests INTEGER NOT NULL CHECK (guests BETWEEN 1 AND 12), accessibility TEXT, created_at INTEGER NOT NULL);
CREATE INDEX rsvps_event_id_idx ON rsvps(event_id);
CREATE INDEX rsvps_event_starts_at_idx ON rsvps(event_starts_at);

-- The lists (lib/api-contract.ts SUBSCRIBE_TOPICS) a pending signup opts in to on
-- confirmation. Rows from before this migration were newsletter signups.
ALTER TABLE subscription_confirmations ADD COLUMN topics_json TEXT NOT NULL DEFAULT '["newsletter"]';

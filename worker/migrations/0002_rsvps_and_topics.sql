-- RSVPs for the Events page, and the lists a subscriber chose. Additive only:
-- request_log's route CHECK ('contact', 'subscribe') is live in production and
-- stays untouched, so an RSVP never goes there; rsvps.request_id UNIQUE is its
-- idempotency key.

-- One row per RSVP. event_id / event_starts_at / event_ends_at come from the
-- site's /events.json (the Google Calendar), stored when the RSVP is made, in
-- UTC as SQLite's "YYYY-MM-DD HH:MM:SS" (an all-day event ends at the UTC
-- midnight of its exclusive end date). The daily cleanup compares event_ends_at
-- with datetime('now') and deletes a row once its event is over (owner decision
-- 2026-11-07). email_hash is the salted hash the rate limiter uses (a reused
-- requestId must come from the same email).
CREATE TABLE rsvps (
  id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, event_id TEXT NOT NULL, event_starts_at TEXT NOT NULL,
  event_ends_at TEXT NOT NULL,
  name TEXT NOT NULL, email TEXT NOT NULL, email_hash TEXT NOT NULL,
  guests INTEGER NOT NULL CHECK (guests BETWEEN 1 AND 12), accessibility TEXT, created_at INTEGER NOT NULL);
CREATE INDEX rsvps_event_id_idx ON rsvps(event_id);
CREATE INDEX rsvps_event_ends_at_idx ON rsvps(event_ends_at);

-- The lists (lib/api-contract.ts SUBSCRIBE_TOPICS) a pending signup opts in to on
-- confirmation. Rows from before this migration were newsletter signups.
ALTER TABLE subscription_confirmations ADD COLUMN topics_json TEXT NOT NULL DEFAULT '["newsletter"]';

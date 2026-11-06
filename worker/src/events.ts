import { EVENT_ID_PATTERN } from "../../lib/api-contract";
import { PublicError, requireBinding, type Env } from "./types";

/**
 * Which events take RSVPs, read from the site's own /events.json (written at
 * every build by scripts/write-site-files.mjs from the Google Calendar): no
 * database row or developer step per event. A record is what
 * lib/events.mjs#publishedEvents publishes, and formatEventWhen formats it.
 */
export type FeedEvent = {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  timeZone: string;
  allDay: boolean;
  rsvp: "open" | "off";
  limit: number | null;
};

const CACHE_MS = 60_000;
/** /events.json lists at most 60 events (scripts/lib/google-calendar.mjs): a few kB. */
const MAX_FEED_BYTES = 512 * 1024;

let cached: { url: string; until: number; events: FeedEvent[] } | null = null;

/** Forgets the cached feed (tests read their own feed each). */
export function resetEventFeedCache() {
  cached = null;
}

const unavailable = (reason: string) => new PublicError("EVENTS_UNAVAILABLE", `events feed: ${reason}`);

const isTime = (value: unknown): value is string => typeof value === "string" && value.length <= 40 && Number.isFinite(Date.parse(value));

function feedEvent(value: unknown): FeedEvent {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw unavailable("an event is not an object");
  const record = value as Record<string, unknown>;
  const { id, title, startsAt, endsAt, timeZone, allDay, rsvp, limit } = record;
  if (typeof id !== "string" || !EVENT_ID_PATTERN.test(id)) throw unavailable("bad id");
  if (typeof title !== "string" || !title.trim() || title.length > 1000) throw unavailable("bad title");
  if (!isTime(startsAt) || !isTime(endsAt)) throw unavailable("bad time");
  if (typeof timeZone !== "string" || timeZone.length > 100) throw unavailable("bad time zone");
  if (typeof allDay !== "boolean") throw unavailable("bad allDay");
  if (rsvp !== "open" && rsvp !== "off") throw unavailable("bad rsvp");
  if (limit !== null && !(typeof limit === "number" && Number.isSafeInteger(limit) && limit >= 1)) throw unavailable("bad limit");
  return { id, title, startsAt, endsAt, timeZone, allDay, rsvp, limit };
}

async function fetchFeed(url: string): Promise<FeedEvent[]> {
  let response: Response;
  try {
    // Exactly EVENTS_FEED_URL: a redirect (e.g. while tzionbreslov.org still
    // forwards to the old site) is a failure, never followed.
    response = await fetch(url, { method: "GET", redirect: "manual", headers: { Accept: "application/json" } });
  } catch {
    throw unavailable("fetch failed");
  }
  if (response.status !== 200) throw unavailable(`HTTP ${response.status}`);
  const type = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (type !== "application/json") throw unavailable("not JSON");
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > MAX_FEED_BYTES) throw unavailable("too large");
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > MAX_FEED_BYTES) throw unavailable("too large");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw unavailable("malformed JSON");
  }
  const events = (body as { events?: unknown } | null)?.events;
  if (!Array.isArray(events)) throw unavailable("no events list");
  return events.map(feedEvent);
}

/**
 * The events of EVENTS_FEED_URL, cached per isolate for 60 s (a failure is
 * never cached). Throws EVENTS_UNAVAILABLE unless the answer is a 200 with a
 * JSON body of the expected shape.
 */
/** https only; plain http just for a local `npm run worker:dev` (localhost). */
function feedUrl(env: Env) {
  const url = requireBinding(env, "EVENTS_FEED_URL");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new PublicError("SERVICE_NOT_CONFIGURED", "EVENTS_FEED_URL is not a URL");
  }
  const local = parsed.protocol === "http:" && (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1");
  if (parsed.protocol !== "https:" && !local) throw new PublicError("SERVICE_NOT_CONFIGURED", "EVENTS_FEED_URL must be https");
  return url;
}

export async function loadEventFeed(env: Env, now = Date.now()): Promise<FeedEvent[]> {
  const url = feedUrl(env);
  if (cached && cached.url === url && now < cached.until) return cached.events;
  const events = await fetchFeed(url);
  cached = { url, until: now + CACHE_MS, events };
  return events;
}

/** The event to RSVP to, or null when the feed doesn't list it or it takes no RSVPs ("No RSVP"). */
export function findRsvpEvent(feed: FeedEvent[], eventId: string): FeedEvent | null {
  return feed.find((event) => event.id === eventId && event.rsvp === "open") ?? null;
}

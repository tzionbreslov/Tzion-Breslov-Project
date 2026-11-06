// The Events page's data: one public Google Calendar (iCal feed) turned into the
// list of upcoming events in content/events.json (scripts/sync-events.mjs).
// Adapted from Ruach Breslov's scripts/lib/google-calendar.mjs: the same
// recurrence, exception, EXDATE, cancellation, all-day and horizon handling,
// plus Tzion's rules:
//   - ids survive a moved event: a one-off event's id comes from its UID, a
//     repeating event's date from its UID and that date's RECURRENCE-ID;
//   - times are shown in the event's own zone (its TZID), else the calendar's
//     (X-WR-TIMEZONE), else Israel's, and never depend on the build machine's;
//   - descriptions lose their HTML (Google stores them as HTML) but keep their
//     line breaks, and carry two markers, each on a line of its own:
//     "No RSVP" (no RSVP button) and "RSVP limit: 40" (a cap on attendance).
import { createHash } from "node:crypto";
import ICAL from "ical.js";
import copy from "../../content/copy/en.json" with { type: "json" };

const FALLBACK_TIME_ZONE = "Asia/Jerusalem";
const DEFAULT_HORIZON_DAYS = 370;
const DEFAULT_MAX_EVENTS = 60;
const MAX_EXPANSION_STEPS = 50_000;
const SUMMARY_LENGTH = 320;
const DAY = 86_400_000;

/* ------------------------------------------------------------------ Text */

// HTML's common named entities (Google's editor writes few: &amp; &lt; &gt; &quot;
// &nbsp; and typographic ones), plus every numeric one.
const NAMED_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0",
  ndash: "–", mdash: "—", hellip: "…", lsquo: "‘", rsquo: "’", sbquo: "‚", ldquo: "“", rdquo: "”", bdquo: "„",
  laquo: "«", raquo: "»", bull: "•", middot: "·", deg: "°", copy: "©", reg: "®", trade: "™",
  euro: "€", pound: "£", cent: "¢", times: "×", divide: "÷", shy: "", zwnj: "\u200c", zwj: "\u200d",
  lrm: "\u200e", rlm: "\u200f"
};

/** Decodes HTML entities once ("&amp;amp;" is "&amp;"); unknown ones stay as written. */
function decodeEntities(text) {
  return text.replace(/&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z][a-zA-Z0-9]{1,31}));/g, (entity, decimal, hex, name) => {
    if (name) return Object.hasOwn(NAMED_ENTITIES, name) ? NAMED_ENTITIES[name] : entity;
    const code = decimal ? Number(decimal) : Number.parseInt(hex, 16);
    const valid = code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff);
    return valid ? String.fromCodePoint(code) : entity;
  });
}

/** Plain text from a calendar field: line breaks kept (<br> and block ends become newlines), tags dropped, entities decoded. */
function htmlToText(value) {
  if (typeof value !== "string") return "";
  return decodeEntities(value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:p|div|li|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]*>/g, ""));
}

/** The text on one line, its whitespace collapsed (titles, locations). */
const oneLine = (value) => htmlToText(value).replace(/\s+/g, " ").trim();

/** Its lines, each with its whitespace collapsed. */
const textLines = (value) => htmlToText(value).split(/\r\n|\r|\n/).map((line) => line.replace(/\s+/g, " ").trim());

/** At most `max` characters, cut at a space or line break (unless that would lose over 30%), ending in "…". */
function shorten(text, max = SUMMARY_LENGTH) {
  if (text.length <= max) return text;
  const head = text.slice(0, max + 1);
  const space = Math.max(head.lastIndexOf(" "), head.lastIndexOf("\n"));
  let end = space > max * 0.7 ? space : max;
  // Never split an emoji (a surrogate pair) in a hard cut.
  if (/[\ud800-\udbff]/.test(text[end - 1] ?? "")) end -= 1;
  return `${text.slice(0, end).trimEnd()}…`;
}

const NO_RSVP = /^\s*no\s+rsvp\s*[.!]?\s*$/i;
const RSVP_LIMIT = /^\s*rsvp\s+limit\s*:\s*(\d+)\s*[.!]?\s*$/i;
/** Any line that starts like a limit, so a limit that isn't a number is reported, not shown. */
const RSVP_LIMIT_LINE = /^\s*rsvp\s+limit\s*:/i;
/** Any other line starting with "RSVP limit" ("RSVP limit 40", "RSVP limits: 40", "RSVP limit40"): shown as written, but reported. */
const RSVP_LIMIT_WORDS = /^\s*rsvp\s+limit/i;
const LIMIT_EXAMPLE = 'Write it on a line of its own like "RSVP limit: 40".';

/**
 * The description's markers, read from the whole text, and the text without
 * them, shortened. A limit must be a whole number of at least 1; anything else
 * on a "RSVP limit:" line means no limit, and a warning for the owner. Any
 * other line that starts with "RSVP limit" (no colon, "limits", "limit40")
 * stays in the text, also with a warning.
 */
function readDescription(value, title) {
  let rsvp = "open";
  let limit = null;
  const warnings = [];
  const kept = [];
  for (const line of textLines(value)) {
    if (NO_RSVP.test(line)) {
      rsvp = "off";
    } else if (RSVP_LIMIT_LINE.test(line)) {
      const count = Number(line.match(RSVP_LIMIT)?.[1] ?? Number.NaN);
      if (Number.isSafeInteger(count) && count >= 1) limit ??= count;
      else warnings.push(`"${title}": "${line}" is not an RSVP limit of 1 or more, so the event has no limit. ${LIMIT_EXAMPLE}`);
    } else {
      if (RSVP_LIMIT_WORDS.test(line)) {
        warnings.push(`"${title}": "${line}" is not written as the RSVP limit marker, so it is shown on the page as written and sets no limit. ${LIMIT_EXAMPLE}`);
      }
      kept.push(line);
    }
  }
  const summary = kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return { summary: shorten(summary), rsvp, limit, warnings };
}

/* ------------------------------------------------------------------ Time */

const UTC_NAMES = new Set(["utc", "etc/utc", "gmt", "etc/gmt", "z", "zulu", "etc/zulu", "universal", "etc/universal", "uct", "etc/uct"]);

/** `candidate` as a zone that wall-clock times can be read in (UTC included), or null (empty or unknown). */
function knownZone(candidate) {
  const name = typeof candidate === "string" ? candidate.trim() : "";
  if (!name) return null;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: name }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

/** `candidate` as an IANA zone to show times in, or null (empty, unknown, or UTC). */
function displayZone(candidate) {
  const zone = knownZone(candidate);
  return zone && !UTC_NAMES.has(zone.toLowerCase()) && !UTC_NAMES.has(candidate.trim().toLowerCase()) ? zone : null;
}

const wallClocks = new Map();
/** How far `timeZone`'s clock is ahead of UTC at `instant` (ms). */
function zoneOffset(instant, timeZone) {
  let clock = wallClocks.get(timeZone);
  if (!clock) {
    clock = new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric"
    });
    wallClocks.set(timeZone, clock);
  }
  const part = Object.fromEntries(clock.formatToParts(new Date(instant)).map(({ type, value }) => [type, Number(value)]));
  return Date.UTC(part.year, part.month - 1, part.day, part.hour, part.minute, part.second) - Math.floor(instant / 1000) * 1000;
}

/** The instant a wall-clock time has in `timeZone` (DST included). */
function wallClockInstant(time, timeZone) {
  const wall = Date.UTC(time.year, time.month - 1, time.day, time.hour, time.minute, time.second);
  const first = wall - zoneOffset(wall, timeZone);
  return wall - zoneOffset(first, timeZone);
}

/**
 * The instant of an iCalendar time, in ms, independent of the build machine's
 * zone: a date is that day's UTC midnight (as in Ruach's catalog); a UTC time or
 * one whose zone the feed defines (VTIMEZONE) is converted by ical.js; a
 * floating time (no zone, or a TZID the feed doesn't define) is read in `wallZone`.
 */
function instantOf(time, wallZone) {
  if (time.isDate) return Date.UTC(time.year, time.month - 1, time.day);
  const zone = time.zone;
  if (zone === ICAL.Timezone.utcTimezone || zone?.tzid === "UTC") {
    return Date.UTC(time.year, time.month - 1, time.day, time.hour, time.minute, time.second);
  }
  if (zone && zone !== ICAL.Timezone.localTimezone && zone.tzid !== "floating") return time.toJSDate().getTime();
  return wallClockInstant(time, wallZone);
}

const iso = (ms) => new Date(ms).toISOString();

/* ------------------------------------------------------------------ Events */

const componentValue = (component, name) => component.getFirstPropertyValue(name);
const isCancelled = (event) => oneLine(componentValue(event.component, "status")).toUpperCase() === "CANCELLED";
const tzidOf = (event, name) => event.component.getFirstProperty(name)?.getParameter("tzid") ?? null;
const uidOf = (component) => String(componentValue(component, "uid") ?? "").trim();

function stableEventId(uid, occurrence) {
  return createHash("sha256").update(`${uid}\n${occurrence}`).digest("hex").slice(0, 24);
}

function recordFromOccurrence(master, uid, details, calendarZone) {
  const item = details.item;
  const start = details.startDate;
  const tzid = tzidOf(item, "dtstart") ?? tzidOf(master, "dtstart");
  // Shown in the time's own zone (TZID) when it is a real place, else the calendar's; a time
  // the feed gives no definition for is read in its TZID (even UTC), else the calendar's zone.
  const zone = displayZone(tzid) ?? calendarZone;
  const wallZone = knownZone(tzid) ?? calendarZone;
  const startsAt = instantOf(start, wallZone);
  let endsAt = instantOf(details.endDate ?? start, wallZone);
  if (start.isDate && endsAt <= startsAt) endsAt = startsAt + DAY;
  if (endsAt < startsAt) endsAt = startsAt;

  const title = oneLine(item.summary) || oneLine(master.summary) || copy.events.untitled;
  const { summary, rsvp, limit, warnings } = readDescription(item.description || master.description, title);
  return {
    record: {
      // A one-off event keeps its id when it is moved; each date of a repeating one has its own.
      id: master.isRecurring() ? stableEventId(uid, details.recurrenceId.toString()) : stableEventId(uid, "single"),
      title,
      summary,
      location: oneLine(item.location || master.location),
      startsAt: iso(startsAt),
      endsAt: iso(endsAt),
      // All-day dates are calendar dates (UTC midnights), shown as such.
      timeZone: start.isDate ? "UTC" : zone,
      allDay: Boolean(start.isDate),
      rsvp,
      limit
    },
    warnings
  };
}

/**
 * The upcoming events in an iCalendar feed: every occurrence that hasn't ended
 * by `now` and starts within `horizonDays`, soonest first, at most `maxEvents`.
 * Warnings are for the calendar's owner (e.g. an RSVP limit that isn't a number).
 * Anything that isn't a valid calendar throws.
 * @param {string} calendarText
 * @param {{ now?: Date; horizonDays?: number; maxEvents?: number }} [options]
 */
export function buildCalendarCatalog(
  calendarText,
  { now = new Date(), horizonDays = DEFAULT_HORIZON_DAYS, maxEvents = DEFAULT_MAX_EVENTS } = {}
) {
  if (typeof calendarText !== "string" || !calendarText.includes("BEGIN:VCALENDAR")) {
    throw new Error("The Google Calendar response is not an iCalendar feed.");
  }

  const windowStart = new Date(now).getTime();
  if (Number.isNaN(windowStart)) throw new Error("Calendar sync received an invalid current date.");
  const windowEnd = windowStart + horizonDays * DAY;
  const calendar = new ICAL.Component(ICAL.parse(calendarText));
  if (calendar.name !== "vcalendar") throw new Error("The iCalendar feed has no VCALENDAR root.");

  const calendarZone = displayZone(oneLine(componentValue(calendar, "x-wr-timezone"))) ?? FALLBACK_TIME_ZONE;
  const components = calendar.getAllSubcomponents("vevent");
  const exceptions = components.filter((component) => component.hasProperty("recurrence-id"));
  const records = [];
  const warnings = new Set();
  const keep = ({ record, warnings: found }) => {
    if (Date.parse(record.endsAt) > windowStart && Date.parse(record.startsAt) <= windowEnd) {
      records.push(record);
      for (const warning of found) warnings.add(warning);
    }
  };

  for (const component of components) {
    if (component.hasProperty("recurrence-id")) continue;
    // The UID exactly as Google wrote it (it is the event's identity, not text to show).
    const uid = uidOf(component);
    if (!uid) throw new Error("A Google Calendar event is missing its UID.");

    const relatedExceptions = exceptions.filter((exception) => uidOf(exception) === uid);
    const event = new ICAL.Event(component, { strictExceptions: true, exceptions: relatedExceptions });
    if (isCancelled(event)) continue;

    if (!event.isRecurring()) {
      const details = { item: event, recurrenceId: event.startDate, startDate: event.startDate, endDate: event.endDate };
      keep(recordFromOccurrence(event, uid, details, calendarZone));
      continue;
    }

    const wallZone = knownZone(tzidOf(event, "dtstart")) ?? calendarZone;
    const iterator = event.iterator();
    let steps = 0;
    for (let occurrence = iterator.next(); occurrence; occurrence = iterator.next()) {
      steps += 1;
      if (steps > MAX_EXPANSION_STEPS) throw new Error(`Recurring event ${uid} exceeds the safe expansion limit.`);
      if (instantOf(occurrence, wallZone) > windowEnd) break;

      const details = event.getOccurrenceDetails(occurrence);
      if (isCancelled(details.item)) continue;
      keep(recordFromOccurrence(event, uid, details, calendarZone));
    }
  }

  const unique = new Map(records.map((record) => [record.id, record]));
  const events = [...unique.values()]
    .sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt) || left.title.localeCompare(right.title))
    .slice(0, maxEvents);
  return { events, warnings: [...warnings] };
}

/** The feed's address, if it is Google's public iCal address (never a private or secret one). */
export function publicGoogleCalendarUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("GOOGLE_CALENDAR_ICAL_URL must be Google's HTTPS public iCal address ending in /public/basic.ics.");
  }
  const acceptedHost = url.hostname === "calendar.google.com" || url.hostname === "www.google.com";
  const publicFeed = /^\/calendar\/ical\/.+\/public\/basic\.ics$/u.test(url.pathname);
  if (url.protocol !== "https:" || !acceptedHost || !publicFeed) {
    throw new Error("GOOGLE_CALENDAR_ICAL_URL must be Google's HTTPS public iCal address ending in /public/basic.ics.");
  }
  return url;
}

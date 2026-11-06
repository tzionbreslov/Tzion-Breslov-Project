// The Events page's list (lib/pages/events.ts): one card per upcoming event
// from content/events.json (scripts/sync-events.mjs), or a note that nothing is
// scheduled. Plain JavaScript with no Node APIs, so the forms Worker can share
// it. Every calendar field is text from Google Calendar: it is escaped here.
import copy from "../content/copy/en.json" with { type: "json" };

const ISRAEL = "Asia/Jerusalem";
const LOCALE = "en-US";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const formats = new Map();
function format(kind, timeZone, ms) {
  const key = `${kind}|${timeZone}`;
  let formatter = formats.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(LOCALE, kind === "date"
      ? { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone }
      : { hour: "numeric", minute: "2-digit", timeZone });
    formats.set(key, formatter);
  }
  // Some ICU versions put a (narrow) no-break space before AM/PM.
  return formatter.format(ms).replace(/[\u202f\u00a0]/g, " ");
}

function knownZone(timeZone) {
  if (typeof timeZone !== "string" || !timeZone) return ISRAEL;
  try {
    new Intl.DateTimeFormat(LOCALE, { timeZone });
    return timeZone;
  } catch {
    return ISRAEL;
  }
}

/**
 * When an event takes place, in its own time zone:
 * "Sunday, November 8, 2026 · 7:30 PM – 9:00 PM (Israel time)". An all-day
 * event reads "Sunday, November 8, 2026" (or its first and last day), an event
 * that ends on a later day names both days.
 * @param {import("./events.d.mts").EventRecord} event
 */
export function formatEventWhen(event) {
  const start = Date.parse(event.startsAt);
  const end = Math.max(Date.parse(event.endsAt) || start, start);
  if (event.allDay) {
    // Calendar dates, stored as UTC midnights; the end date is exclusive.
    const first = format("date", "UTC", start);
    const last = end > start ? format("date", "UTC", end - 1) : first;
    return first === last ? first : `${first} – ${last}`;
  }
  const zone = knownZone(event.timeZone);
  const label = zone === ISRAEL ? copy.events.israelTime : zone;
  const day = format("date", zone, start);
  const from = format("time", zone, start);
  if (end === start) return `${day} · ${from} (${label})`;
  // An event that ends at midnight still belongs to its evening.
  const to = format("date", zone, end - 1) === day
    ? format("time", zone, end)
    : `${format("date", zone, end)} · ${format("time", zone, end)}`;
  return `${day} · ${from} – ${to} (${label})`;
}

/** The events that haven't ended by `now` (a list carried over from an earlier sync can be stale). */
export function upcomingEvents(events, now = new Date()) {
  return events.filter((event) => Date.parse(event.endsAt) > now.getTime());
}

/**
 * The upcoming events as /events.json publishes them for the forms Worker
 * (scripts/write-site-files.mjs): what it needs to take RSVPs and to say when
 * an event is (formatEventWhen reads them exactly as the page's records).
 * @param {import("./events.d.mts").EventRecord[]} events
 */
export function publishedEvents(events, now = new Date()) {
  return upcomingEvents(events, now).map(({ id, title, startsAt, endsAt, timeZone, allDay, rsvp, limit }) =>
    ({ id, title, startsAt, endsAt, timeZone, allDay, rsvp, limit }));
}

// Decorative icons (the text says it all).
const icon = (body) => `<svg class="tz-event__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;
const CALENDAR = icon('<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>');
const PLACE = icon('<path d="M12 21s-6.5-5.6-6.5-11A6.5 6.5 0 0 1 18.5 10c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.5"/>');

/** The escaped line, which a narrow card may wrap, but never inside "7:30 PM" or "(Israel time)". */
const whenHtml = (event) => esc(formatEventWhen(event))
  .replace(/(\d) ([AP]M)\b/g, "$1&nbsp;$2")
  .replace(/\([^()]*\)$/, (zone) => zone.replace(/ /g, "&nbsp;"));

function card(event) {
  const limit = Number.isSafeInteger(event.limit) && event.limit >= 1 ? event.limit : "";
  const where = event.location ? `<p class="tz-event__where">${PLACE}${esc(event.location)}</p>` : "";
  const summary = event.summary ? `<p class="tz-event__summary">${esc(event.summary).replace(/\n/g, "<br>")}</p>` : "";
  return `<article class="tz-event" data-event-id="${esc(event.id)}" data-starts-at="${esc(event.startsAt)}"` +
    ` data-rsvp="${event.rsvp === "off" ? "off" : "open"}" data-limit="${limit}">` +
    `<h2 class="tz-event__title">${esc(event.title)}</h2>` +
    `<p class="tz-event__when">${CALENDAR}${whenHtml(event)}</p>` +
    `${where}${summary}</article>`;
}

/**
 * The cards, soonest first as given, or the empty state.
 * @param {import("./events.d.mts").EventRecord[]} events
 * @param {import("./events.d.mts").EventsCopy} text copy.events from content/copy/en.json
 */
export function renderEventsList(events, text) {
  if (!events.length) {
    // "{contact}" in the sentence is the link to the Contact page.
    const [before, after = ""] = text.emptyText.split("{contact}");
    const link = `<a href="/contact/">${esc(text.contactLink)}</a>`;
    return `<div class="tz-events"><div class="tz-events__empty">` +
      `<h2 class="tz-events__empty-title">${esc(text.emptyTitle)}</h2>` +
      `<p class="tz-events__empty-text">${esc(before)}${link}${esc(after)}</p>` +
      `</div></div>`;
  }
  return `<div class="tz-events"><div class="tz-events__list">${events.map(card).join("")}</div></div>`;
}

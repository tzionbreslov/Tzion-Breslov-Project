// The Events page's list (lib/pages/events.ts): one card per upcoming event
// from content/events.json (scripts/sync-events.mjs), or a note that nothing is
// scheduled, then the "Get event announcements" signup. Plain JavaScript with
// no Node APIs, so the forms Worker can share it (formatEventWhen in the RSVP
// emails). Every calendar field is text from Google Calendar: it is escaped here.
import copy from "../content/copy/en.json" with { type: "json" };
import { CONTACT_EMAIL } from "../config/contact.mjs";
import { PRIVACY_PATH } from "../config/site-structure.mjs";
import { esc as escapeHtml } from "./html.mjs";

const ISRAEL = "Asia/Jerusalem";
const LOCALE = "en-US";

/** lib/html.mjs's esc, on any value as text (as this list always has: a calendar field may be any JSON value). */
const esc = (s) => escapeHtml(String(s));

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
 * that ends on a later day names both days. `israelTime` is the label for
 * Israel's zone (a translation's own words); it defaults to copy.events.israelTime.
 * @param {import("./events.d.mts").EventRecord} event
 * @param {{ israelTime?: string }} [options]
 */
export function formatEventWhen(event, { israelTime = copy.events.israelTime } = {}) {
  const start = Date.parse(event.startsAt);
  const end = Math.max(Date.parse(event.endsAt) || start, start);
  if (event.allDay) {
    // Calendar dates, stored as UTC midnights; the end date is exclusive.
    const first = format("date", "UTC", start);
    const last = end > start ? format("date", "UTC", end - 1) : first;
    return first === last ? first : `${first} – ${last}`;
  }
  const zone = knownZone(event.timeZone);
  const label = zone === ISRAEL ? israelTime : zone;
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

// Ruling R13: no control may look usable but be dead. Until its island is
// ready (lib/client/rsvp.ts, announcements.ts) an RSVP button does nothing and
// the signup would post to the static host, so app/events.css keeps both in
// place but hidden. Without JavaScript these styles take them out, and a line
// (<noscript>, so JavaScript users never see it) offers email (config/contact.mjs) instead.
const NO_SCRIPT_RSVP = "<noscript><style>" +
  ".tz-events .tz-event__rsvp{display:none!important}" +
  ".tz-events .tz-event__actions{visibility:visible!important}" +
  "</style></noscript>";
const NO_SCRIPT_SIGNUP = "<noscript><style>.tz-events .tz-announce__form{display:none!important}</style></noscript>";

/** A no-JavaScript line: "{email}" in the sentence is a link to write to us. */
function byEmail(className, sentence) {
  const [before, after = ""] = sentence.split("{email}");
  return `<noscript><p class="${className}">${esc(before)}<a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>${esc(after)}</p></noscript>`;
}

/** The escaped line, which a narrow card may wrap, but never inside "7:30 PM" or "(Israel time)". */
const whenHtml = (event, israelTime) => esc(formatEventWhen(event, { israelTime }))
  .replace(/(\d) ([AP]M)\b/g, "$1&nbsp;$2")
  .replace(/\([^()]*\)$/, (zone) => zone.replace(/ /g, "&nbsp;"));

/**
 * A card. An event that takes RSVPs gets the RSVP button (lib/client/rsvp.ts
 * opens the form, hides the button once the event has started, and swaps it for
 * "This event is full" when the forms API says so); "No RSVP" gets none.
 */
function card(event, text, rsvp) {
  const limit = Number.isSafeInteger(event.limit) && event.limit >= 1 ? event.limit : "";
  const open = event.rsvp !== "off";
  const titleId = `tz-event-${esc(event.id)}-title`;
  const where = event.location ? `<p class="tz-event__where">${PLACE}${esc(event.location)}</p>` : "";
  const summary = event.summary ? `<p class="tz-event__summary">${esc(event.summary).replace(/\n/g, "<br>")}</p>` : "";
  const button = open
    ? `<div class="tz-event__actions"><button type="button" class="tz-event__rsvp" aria-describedby="${titleId}">${esc(rsvp.button)}</button>` +
      `${byEmail("tz-event__noscript", rsvp.noScript)}</div>`
    : "";
  return `<article class="tz-event" data-event-id="${esc(event.id)}" data-starts-at="${esc(event.startsAt)}"` +
    ` data-rsvp="${open ? "open" : "off"}" data-limit="${limit}">` +
    `<h2 class="tz-event__title" id="${titleId}">${esc(event.title)}</h2>` +
    `<p class="tz-event__when">${CALENDAR}${whenHtml(event, text.israelTime)}</p>` +
    `${where}${summary}${button}</article>`;
}

/**
 * The cards, soonest first as given, or the empty state.
 * @param {import("./events.d.mts").EventRecord[]} events
 * @param {import("./events.d.mts").EventsCopy} text copy.events from content/copy/en.json
 * @param {import("./events.d.mts").RsvpButtonCopy} rsvp copy.rsvp (the button's label)
 */
export function renderEventsList(events, text, rsvp) {
  if (!events.length) {
    // "{contact}" in the sentence is the link to the Contact page.
    const [before, after = ""] = text.emptyText.split("{contact}");
    const link = `<a href="/contact/">${esc(text.contactLink)}</a>`;
    return `<div class="tz-events"><div class="tz-events__empty">` +
      `<h2 class="tz-events__empty-title">${esc(text.emptyTitle)}</h2>` +
      `<p class="tz-events__empty-text">${esc(before)}${link}${esc(after)}</p>` +
      `</div></div>`;
  }
  return `<div class="tz-events">${NO_SCRIPT_RSVP}<div class="tz-events__list">${events.map((event) => card(event, text, rsvp)).join("")}</div></div>`;
}

/**
 * The consent sentence of the "Get event announcements" signup, built here
 * only. "{privacy}" in it is a link to the privacy notice (rendered on the
 * page, the link gets the site's base path); the sentence reads as before.
 */
function announcementsConsent(text) {
  const [before, after = ""] = text.consent.split("{privacy}");
  return `${esc(before)}<a href="${PRIVACY_PATH}">${esc(text.privacyNotice)}</a>${esc(after)}`;
}

/**
 * The "Get event announcements" signup, after the list (or the empty state).
 * lib/client/announcements.ts sends it to POST /v1/subscribe with the lists
 * ticked as `topics`; the Worker's double opt-in does the rest. Deliberately no
 * `data-tz-form`: that marks the footer's Gravity form (lib/client/forms.ts).
 * @param {import("./events.d.mts").AnnouncementsCopy} text copy.announcements
 */
export function renderAnnouncements(text) {
  const list = (value, label, checked) =>
    `<label class="tz-check"><input type="checkbox" name="topics" value="${value}"${checked ? " checked" : ""}><span>${esc(label)}</span></label>`;
  return `<div class="tz-events"><section class="tz-announce" data-tz-announcements aria-labelledby="tz-announce-title">${NO_SCRIPT_SIGNUP}` +
    `<h2 class="tz-announce__title" id="tz-announce-title">${esc(text.heading)}</h2>` +
    `<form class="tz-announce__form" method="post" novalidate>` +
    `<div class="tz-field tz-announce__email"><label class="tz-field__label" for="tz-announce-email">${esc(text.email)}</label>` +
    `<input class="tz-field__input" id="tz-announce-email" type="email" name="email" autocomplete="email" maxlength="254" required></div>` +
    `<fieldset class="tz-announce__lists" id="tz-announce-lists"><legend class="tz-field__label">${esc(text.lists)}</legend>` +
    `${list("events", text.events, true)}${list("newsletter", text.newsletter, false)}</fieldset>` +
    `<label class="tz-check tz-consent"><input type="checkbox" name="consent" value="granted" required><span>${announcementsConsent(text)}</span></label>` +
    `<button class="tz-button" type="submit">${esc(text.submit)}</button>` +
    `</form>${byEmail("tz-announce__noscript", text.noScript)}</section></div>`;
}

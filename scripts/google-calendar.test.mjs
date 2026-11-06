import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { buildCalendarCatalog, publicGoogleCalendarUrl } from "./lib/google-calendar.mjs";

// Adapted from Ruach Breslov's scripts/google-calendar.test.mjs, plus Tzion's
// rules: ids that survive a moved event, the calendar's time zone for UTC
// times, DST, HTML descriptions and the "No RSVP" / "RSVP limit" markers.
const fixture = (name) => fs.readFileSync(new URL(`./fixtures/calendar-${name}.ics`, import.meta.url), "utf8");
const basic = fixture("basic");
const zoned = fixture("zoned");
const jerusalem = fixture("jerusalem");

/** A calendar with the given VEVENT blocks (and an X-WR-TIMEZONE header unless `zone` is null). */
const calendar = (events, zone = "Asia/Jerusalem") => [
  "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Tzion Breslov//test//EN",
  ...(zone === null ? [] : [`X-WR-TIMEZONE:${zone}`]),
  ...events,
  "END:VCALENDAR"
].join("\r\n");

/** One VEVENT (no SUMMARY when `summary` is null); `description` is written as iCalendar text (newlines, commas and semicolons escaped). */
const vevent = ({ uid = "event@tzionbreslov.test", start = "DTSTART:20261110T170000Z", end = "DTEND:20261110T183000Z", summary = "Evening class", description, extra = [] } = {}) => [
  "BEGIN:VEVENT", `UID:${uid}`, start, end,
  ...(summary === null ? [] : [`SUMMARY:${summary}`]),
  ...(description === undefined ? [] : [`DESCRIPTION:${description.replace(/[\\;,]/g, "\\$&").replace(/\n/g, "\\n")}`]),
  ...extra,
  "END:VEVENT"
].join("\r\n");

const NOW = new Date("2026-11-01T00:00:00Z");
const one = (event, opts = {}) => {
  const { events, warnings } = buildCalendarCatalog(calendar([vevent(event)]), { now: NOW, ...opts });
  assert.equal(events.length, 1);
  return { event: events[0], warnings };
};

test("builds a future event catalog with recurrence changes and cancellations", () => {
  const { events, warnings } = buildCalendarCatalog(basic, { now: new Date("2026-09-09T02:00:00Z"), horizonDays: 30 });

  assert.deepEqual(events.map((event) => event.title), [
    "Torah & Connection",
    "Community weekend",
    "Weekly class — later this week",
    "Weekly class"
  ]);
  assert.equal(events[0].summary, "Weekly learning, dinner\nand an honest conversation.");
  assert.equal(events[0].location, "71-27 147th St, Flushing, NY 11367");
  // A UTC time is shown in the calendar's own time zone.
  assert.equal(events[0].timeZone, "America/New_York");
  assert.equal(events[0].allDay, false);
  assert.equal(events[1].allDay, true);
  assert.equal(events[1].startsAt, "2026-09-12T00:00:00.000Z");
  assert.equal(events[1].endsAt, "2026-09-14T00:00:00.000Z");
  assert.equal(events[1].timeZone, "UTC");
  assert.equal(events[2].startsAt, "2026-09-23T00:00:00.000Z");
  assert.equal(new Set(events.map((event) => event.id)).size, events.length);
  for (const event of events) {
    assert.match(event.id, /^[0-9a-f]{24}$/);
    assert.equal(event.rsvp, "open");
    assert.equal(event.limit, null);
  }
  assert.deepEqual(warnings, []);
});

test("excludes events that have already ended", () => {
  const { events } = buildCalendarCatalog(basic, { now: new Date("2026-10-01T00:00:00Z"), horizonDays: 30 });
  assert.deepEqual(events, []);
});

test("keeps an event's own Google Calendar time zone (TZID)", () => {
  const { events: [event] } = buildCalendarCatalog(zoned, { now: new Date("2026-09-01T00:00:00Z"), horizonDays: 30 });
  assert.equal(event.startsAt, "2026-09-10T23:00:00.000Z");
  assert.equal(event.endsAt, "2026-09-11T00:30:00.000Z");
  assert.equal(event.timeZone, "America/New_York");
});

test("accepts only Google's public iCal address", () => {
  assert.equal(
    publicGoogleCalendarUrl("https://calendar.google.com/calendar/ical/example%40group.calendar.google.com/public/basic.ics").hostname,
    "calendar.google.com"
  );
  assert.throws(() => publicGoogleCalendarUrl("https://example.com/calendar.ics"), /public iCal address/);
  assert.throws(
    () => publicGoogleCalendarUrl("https://calendar.google.com/calendar/ical/example/private/basic.ics"),
    /public iCal address/
  );
  assert.throws(() => publicGoogleCalendarUrl("http://calendar.google.com/calendar/ical/example/public/basic.ics"), /public iCal address/);
  assert.throws(() => publicGoogleCalendarUrl(""), /public iCal address/);
});

test("a one-off event moved from 18:00 to 19:00 keeps its id", () => {
  const before = one({ start: "DTSTART;TZID=Asia/Jerusalem:20261110T180000", end: "DTEND;TZID=Asia/Jerusalem:20261110T190000" }).event;
  const after = one({ start: "DTSTART;TZID=Asia/Jerusalem:20261110T190000", end: "DTEND;TZID=Asia/Jerusalem:20261110T200000" }).event;
  assert.notEqual(before.startsAt, after.startsAt);
  assert.equal(after.id, before.id);
});

test("each date of a weekly class has its own id, which survives that date being moved", () => {
  const now = new Date("2027-03-01T00:00:00Z");
  const { events } = buildCalendarCatalog(jerusalem, { now });
  assert.equal(events.length, 4);
  assert.equal(new Set(events.map((event) => event.id)).size, 4);

  // The 28 March class moved to 20:00 (an exception with its own RECURRENCE-ID).
  const moved = jerusalem.replace("END:VCALENDAR", [
    "BEGIN:VEVENT", "UID:weekly-class@tzionbreslov.test",
    "RECURRENCE-ID;TZID=Asia/Jerusalem:20270328T193000",
    "DTSTART;TZID=Asia/Jerusalem:20270328T200000", "DTEND;TZID=Asia/Jerusalem:20270328T213000",
    "SUMMARY:Weekly class (later)", "END:VEVENT", "END:VCALENDAR"
  ].join("\r\n"));
  const after = buildCalendarCatalog(moved, { now }).events;
  assert.deepEqual(after.map((event) => event.id), events.map((event) => event.id));
  assert.equal(after[2].title, "Weekly class (later)");
  assert.equal(after[2].startsAt, "2027-03-28T17:00:00.000Z");
});

test("a UTC time is shown in the calendar's time zone, else Israel's", () => {
  const event = { start: "DTSTART:20261108T173000Z", end: "DTEND:20261108T190000Z" };
  const zoneOf = (zone) => buildCalendarCatalog(calendar([vevent(event)], zone), { now: NOW }).events[0].timeZone;
  assert.equal(zoneOf("Asia/Jerusalem"), "Asia/Jerusalem");
  assert.equal(zoneOf("Europe/London"), "Europe/London");
  assert.equal(zoneOf(null), "Asia/Jerusalem");
  assert.equal(zoneOf("Not/AZone"), "Asia/Jerusalem");
  assert.equal(zoneOf("UTC"), "Asia/Jerusalem");
});

test("a weekly 19:30 Israel class keeps 19:30 across the start of daylight saving time (26 March 2027)", () => {
  const now = new Date("2027-03-20T00:00:00Z");
  // As Google sends it (with the zone's VTIMEZONE), and with the TZID alone.
  const withoutDefinition = jerusalem.replace(/BEGIN:VTIMEZONE[\s\S]*?END:VTIMEZONE\r?\n/, "");
  assert.ok(!withoutDefinition.includes("VTIMEZONE"));
  for (const ics of [jerusalem, withoutDefinition]) {
    const { events } = buildCalendarCatalog(ics, { now });
    assert.deepEqual(events.slice(0, 2).map((event) => [event.startsAt, event.endsAt]), [
      ["2027-03-21T17:30:00.000Z", "2027-03-21T19:00:00.000Z"],
      ["2027-03-28T16:30:00.000Z", "2027-03-28T18:00:00.000Z"]
    ]);
    assert.ok(events.every((event) => event.timeZone === "Asia/Jerusalem"));
  }
});

test("a time with no zone at all is read in the calendar's time zone, not the build machine's", () => {
  const { event } = one({ start: "DTSTART:20261110T193000", end: "DTEND:20261110T210000" });
  assert.equal(event.startsAt, "2026-11-10T17:30:00.000Z");
  assert.equal(event.endsAt, "2026-11-10T19:00:00.000Z");
  assert.equal(event.timeZone, "Asia/Jerusalem");
});

test("a UTC zone the feed doesn't define is read as UTC, and shown in the calendar's zone", () => {
  const { event } = one({ start: "DTSTART;TZID=Etc/UTC:20261110T173000", end: "DTEND;TZID=Etc/UTC:20261110T190000" });
  assert.equal(event.startsAt, "2026-11-10T17:30:00.000Z");
  assert.equal(event.endsAt, "2026-11-10T19:00:00.000Z");
  assert.equal(event.timeZone, "Asia/Jerusalem");
});

test("titles and descriptions lose their HTML and decode its entities", () => {
  const { event } = one({
    summary: "Torah &amp; Tea",
    description: "<p>Learning &amp; <b>tea</b> &ndash; all welcome&#33;</p><p>Bring&nbsp;a friend<br>Doors at 7&#x3a;15</p>",
    extra: ["LOCATION:Beit Knesset &quot;Tzion&quot;"]
  });
  assert.equal(event.title, "Torah & Tea");
  assert.equal(event.summary, "Learning & tea – all welcome!\nBring a friend\nDoors at 7:15");
  assert.equal(event.location, 'Beit Knesset "Tzion"');
  // Decoded once only: an escaped tag stays text (the page escapes it again).
  assert.equal(one({ summary: "&lt;b&gt;Bold&lt;/b&gt; &amp;amp;" }).event.title, "<b>Bold</b> &amp;");
});

test("an untitled event gets the default title", () => {
  assert.equal(one({ summary: null }).event.title, "Tzion Breslov event");
  assert.equal(one({ summary: "  <br> " }).event.title, "Tzion Breslov event");
});

test('"No RSVP" on its own line turns RSVPs off and leaves the description', () => {
  const { event, warnings } = one({ description: "Join us\nNo RSVP." });
  assert.equal(event.rsvp, "off");
  assert.equal(event.summary, "Join us");
  assert.deepEqual(warnings, []);
  assert.equal(one({ description: "<p>Talk at another shul</p><p>no rsvp</p>" }).event.rsvp, "off");
  // Only as a line of its own.
  const inSentence = one({ description: "There is no RSVP needed for this one." }).event;
  assert.equal(inSentence.rsvp, "open");
  assert.equal(inSentence.summary, "There is no RSVP needed for this one.");
});

test('"RSVP limit: 40" sets the limit and leaves the description', () => {
  for (const description of ["rsvp limit: 40", "RSVP Limit:40", "RSVP limit: 40!"]) {
    const { event, warnings } = one({ description });
    assert.equal(event.limit, 40, description);
    assert.equal(event.rsvp, "open");
    assert.equal(event.summary, "", description);
    assert.deepEqual(warnings, []);
  }
  const { event } = one({ description: "Bring a friend\nRSVP limit: 40\nParking nearby" });
  assert.equal(event.limit, 40);
  assert.equal(event.summary, "Bring a friend\nParking nearby");
});

test('"RSVP limit: 0" or a limit that is not a number means no limit, with a warning', () => {
  for (const description of ["RSVP limit: 0", "RSVP limit: forty", "RSVP limit: 40 people"]) {
    const { event, warnings } = one({ summary: "Melave Malka", description: `Come early\n${description}` });
    assert.equal(event.limit, null, description);
    assert.equal(event.summary, "Come early", description);
    assert.equal(warnings.length, 1, description);
    assert.match(warnings[0], /Melave Malka/);
    assert.match(warnings[0], /RSVP limit/);
  }
});

test("a weekly class with a bad limit warns once, not once per date", () => {
  const { warnings } = buildCalendarCatalog(calendar([vevent({ description: "RSVP limit: none", extra: ["RRULE:FREQ=WEEKLY;COUNT=5"] })]), { now: NOW });
  assert.equal(warnings.length, 1);
});

test("markers are read from the whole description, then it is shortened to 320 characters on a word boundary", () => {
  const long = Array.from({ length: 90 }, (_, i) => `word${i}`).join(" ");
  assert.ok(long.length > 400);
  const { event } = one({ description: `${long}\nRSVP limit: 12\nNo RSVP` });
  assert.equal(event.limit, 12);
  assert.equal(event.rsvp, "off");
  assert.ok(event.summary.length <= 321, String(event.summary.length));
  assert.ok(event.summary.endsWith("…"));
  assert.ok(long.startsWith(event.summary.slice(0, -1)));
  assert.match(event.summary, /word\d+…$/);
  assert.ok(!event.summary.includes("RSVP"));
});

test("keeps the next 60 events within 370 days by default", () => {
  const daily = vevent({ start: "DTSTART:20261102T170000Z", end: "DTEND:20261102T180000Z", extra: ["RRULE:FREQ=DAILY"] });
  assert.equal(buildCalendarCatalog(calendar([daily]), { now: NOW }).events.length, 60);
  assert.equal(buildCalendarCatalog(calendar([daily]), { now: NOW, maxEvents: 5 }).events.length, 5);
  const at = (days) => vevent({
    uid: `in-${days}@tzionbreslov.test`,
    start: `DTSTART:${new Date(NOW.getTime() + days * 86_400_000).toISOString().replace(/[-:]|\.\d+/g, "")}`,
    end: `DTEND:${new Date(NOW.getTime() + days * 86_400_000 + 3_600_000).toISOString().replace(/[-:]|\.\d+/g, "")}`
  });
  const { events } = buildCalendarCatalog(calendar([at(369), at(371)]), { now: NOW });
  assert.equal(events.length, 1);
  assert.equal(events[0].startsAt.slice(0, 10), "2027-11-05");
});

test("an all-day event without an end lasts its one day", () => {
  const { event } = one({ start: "DTSTART;VALUE=DATE:20261112", end: "X-NO-END:1" });
  assert.equal(event.allDay, true);
  assert.equal(event.startsAt, "2026-11-12T00:00:00.000Z");
  assert.equal(event.endsAt, "2026-11-13T00:00:00.000Z");
});

test("rejects a response that is not a calendar", () => {
  assert.throws(() => buildCalendarCatalog("<!doctype html><title>Sign in</title>"), /not an iCalendar feed/);
  assert.throws(() => buildCalendarCatalog(calendar([vevent({ uid: "" })])), /missing its UID/);
});

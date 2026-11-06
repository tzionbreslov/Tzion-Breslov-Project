import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { load } from "cheerio";
import copy from "../content/copy/en.json" with { type: "json" };
import { formatEventWhen, publishedEvents, renderAnnouncements, renderEventsList, upcomingEvents } from "../lib/events.mjs";

/** An event record as scripts/lib/google-calendar.mjs writes it. */
const record = (fields = {}) => ({
  id: "0123456789abcdef01234567",
  title: "Evening class",
  summary: "",
  location: "",
  startsAt: "2026-11-08T17:30:00.000Z",
  endsAt: "2026-11-08T19:00:00.000Z",
  timeZone: "Asia/Jerusalem",
  allDay: false,
  rsvp: "open",
  limit: null,
  ...fields
});

test("a timed event reads its date, start and end in Israel time", () => {
  assert.equal(formatEventWhen(record()), "Sunday, November 8, 2026 · 7:30 PM – 9:00 PM (Israel time)");
  // Another calendar zone is named as it is.
  assert.equal(formatEventWhen(record({ timeZone: "America/New_York" })), "Sunday, November 8, 2026 · 12:30 PM – 2:00 PM (America/New_York)");
  // A record without a usable zone is read in Israel time, never in the build machine's.
  assert.equal(formatEventWhen(record({ timeZone: "" })), "Sunday, November 8, 2026 · 7:30 PM – 9:00 PM (Israel time)");
  assert.equal(formatEventWhen(record({ timeZone: "Not/AZone" })), "Sunday, November 8, 2026 · 7:30 PM – 9:00 PM (Israel time)");
  // No length: just the start.
  assert.equal(formatEventWhen(record({ endsAt: "2026-11-08T17:30:00.000Z" })), "Sunday, November 8, 2026 · 7:30 PM (Israel time)");
  // Ending at midnight is still that evening.
  assert.equal(formatEventWhen(record({ startsAt: "2026-11-08T18:00:00.000Z", endsAt: "2026-11-08T22:00:00.000Z" })),
    "Sunday, November 8, 2026 · 8:00 PM – 12:00 AM (Israel time)");
});

test("a timed event over two days shows both dates", () => {
  assert.equal(formatEventWhen(record({ startsAt: "2026-11-08T18:00:00.000Z", endsAt: "2026-11-08T23:00:00.000Z" })),
    "Sunday, November 8, 2026 · 8:00 PM – Monday, November 9, 2026 · 1:00 AM (Israel time)");
});

test("an all-day event reads its date only, a longer one its first and last day", () => {
  const day = { allDay: true, timeZone: "UTC", startsAt: "2026-11-08T00:00:00.000Z", endsAt: "2026-11-09T00:00:00.000Z" };
  assert.equal(formatEventWhen(record(day)), "Sunday, November 8, 2026");
  // The end date is exclusive: 12 to 14 September is the 12th and the 13th.
  assert.equal(formatEventWhen(record({ ...day, startsAt: "2026-09-12T00:00:00.000Z", endsAt: "2026-09-14T00:00:00.000Z" })),
    "Saturday, September 12, 2026 – Sunday, September 13, 2026");
  // All-day dates are calendar dates: a zone west of UTC must not move them to the day before.
  assert.equal(formatEventWhen(record({ ...day, timeZone: "America/Los_Angeles" })), "Sunday, November 8, 2026");
});

test("with no events the list says so and points to the signup below and to the Contact page", () => {
  const $ = load(renderEventsList([], copy.events, copy.rsvp));
  const empty = $(".tz-events__empty");
  assert.equal(empty.length, 1);
  assert.match(empty.text(), /No events are currently scheduled/);
  assert.equal(empty.find("p").text(), "Sign up below to hear about the next gathering, or contact us.");
  assert.equal(empty.find("a").attr("href"), "/contact/");
  assert.equal(empty.find("a").text(), "contact us");
  assert.equal($("article").length, 0);
  assert.equal($("button").length, 0);
});

test("an event that takes RSVPs has an RSVP button; a \"No RSVP\" event has none", () => {
  const $ = load(renderEventsList([record(), record({ id: "fedcba9876543210fedcba98", rsvp: "off" })], copy.events, copy.rsvp));
  const [open, off] = [$("article").eq(0), $("article").eq(1)];
  const button = open.find("button.tz-event__rsvp");
  assert.equal(button.length, 1);
  assert.equal(button.attr("type"), "button");
  assert.equal(button.text(), "RSVP");
  assert.equal(off.find("button").length, 0);
});

test("the \"Get event announcements\" signup: email, the two lists (events ticked), consent and Sign up", () => {
  const $ = load(renderAnnouncements(copy.announcements));
  const section = $("section.tz-announce");
  assert.equal(section.length, 1);
  assert.equal(section.attr("data-tz-announcements"), "");
  const title = section.find("h2");
  assert.equal(title.text(), "Get event announcements");
  assert.equal(section.attr("aria-labelledby"), title.attr("id"));
  const form = section.find("form");
  assert.equal(form.length, 1);
  assert.equal(form.attr("data-tz-form"), undefined, "never a footer-style Gravity form (lib/client/forms.ts)");
  assert.equal(form.attr("novalidate"), "");
  const email = form.find("input[type=email]");
  assert.equal(email.attr("name"), "email");
  assert.equal(email.attr("autocomplete"), "email");
  assert.equal($(`label[for="${email.attr("id")}"]`).text(), "Email");
  assert.equal(form.find("fieldset legend").text(), "Email lists");
  const lists = form.find("input[name=topics]");
  assert.deepEqual(lists.toArray().map((input) => [$(input).attr("value"), $(input).attr("checked") !== undefined, $(input).parent().text()]), [
    ["events", true, "Event announcements"],
    ["newsletter", false, "Newsletter"]
  ]);
  const consent = form.find("input[name=consent]");
  assert.equal(consent.attr("type"), "checkbox");
  assert.equal(consent.attr("checked"), undefined);
  assert.equal(consent.parent().text(), "I agree to the privacy notice and consent to this submission.");
  assert.equal(form.find("button[type=submit]").text(), "Sign up");
});

test("each event is a card with its id, start, RSVP setting and limit", () => {
  const html = renderEventsList([
    record({ summary: "Bring a friend\nParking nearby", location: "Bet Shemesh", limit: 40 }),
    record({ id: "fedcba9876543210fedcba98", startsAt: "2026-11-15T17:30:00.000Z", endsAt: "2026-11-15T19:00:00.000Z", rsvp: "off" })
  ], copy.events, copy.rsvp);
  const $ = load(html);
  const cards = $("article.tz-event");
  assert.equal(cards.length, 2);
  assert.equal($(".tz-events__empty").length, 0);
  const first = cards.eq(0);
  assert.equal(first.attr("data-event-id"), "0123456789abcdef01234567");
  assert.equal(first.attr("data-starts-at"), "2026-11-08T17:30:00.000Z");
  assert.equal(first.attr("data-rsvp"), "open");
  assert.equal(first.attr("data-limit"), "40");
  assert.equal(first.find("h2").text(), "Evening class");
  assert.equal(first.find("p.tz-event__when").text().replace(/\s/g, " "), "Sunday, November 8, 2026 · 7:30 PM – 9:00 PM (Israel time)");
  // A narrow card wraps the line, but never inside a time or the zone.
  assert.match(html, /7:30&nbsp;PM – 9:00&nbsp;PM \(Israel&nbsp;time\)<\/p>/);
  assert.equal(first.find("p.tz-event__summary").html(), "Bring a friend<br>Parking nearby");
  assert.equal(cards.eq(1).attr("data-rsvp"), "off");
  assert.equal(cards.eq(1).attr("data-limit"), "");
});

test("a card escapes the calendar's text", () => {
  const html = renderEventsList([record({
    title: '<script>alert("x")</script>',
    summary: "<img src=x onerror=alert(1)>\n& more",
    location: '"><b>Hall</b>',
    id: 'x" onclick="alert(1)'
  })], copy.events, copy.rsvp);
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes("<img"));
  assert.ok(!html.includes("<b>"));
  assert.ok(!html.includes('" onclick'));
  const $ = load(html);
  assert.equal($("article h2").text(), '<script>alert("x")</script>');
  assert.equal($("p.tz-event__summary").html(), "&lt;img src=x onerror=alert(1)&gt;<br>&amp; more");
  assert.equal($("p.tz-event__where").text(), '"><b>Hall</b>');
});

test("a card has a location row only when a location is set, and a description only when there is one", () => {
  const $ = load(renderEventsList([record(), record({ id: "b", location: "Bet Shemesh", summary: "Hi" })], copy.events, copy.rsvp));
  assert.equal($("article").eq(0).find(".tz-event__where").length, 0);
  assert.equal($("article").eq(0).find(".tz-event__summary").length, 0);
  assert.equal($("article").eq(1).find(".tz-event__where").text(), "Bet Shemesh");
  assert.equal($("article").eq(1).find(".tz-event__summary").text(), "Hi");
});

test("events that have ended are left out (a cached list can be a day old)", () => {
  const events = [
    record({ id: "ended", endsAt: "2026-11-08T19:00:00.000Z" }),
    record({ id: "running", endsAt: "2026-11-08T21:00:00.000Z" }),
    record({ id: "later", startsAt: "2026-11-09T17:30:00.000Z", endsAt: "2026-11-09T19:00:00.000Z" })
  ];
  assert.deepEqual(upcomingEvents(events, new Date("2026-11-08T19:00:00.000Z")).map((event) => event.id), ["running", "later"]);
});

// /events.json (scripts/write-site-files.mjs) is what the forms Worker reads, and formats
// with formatEventWhen for its emails: a record there must read exactly as on the page.
test("/events.json's records format exactly as the page's cards, all-day events included", () => {
  const allDay = record({ id: "day", allDay: true, timeZone: "UTC", startsAt: "2026-11-09T00:00:00.000Z", endsAt: "2026-11-10T00:00:00.000Z", summary: "Hi", location: "Hall" });
  const timed = record({ id: "timed", startsAt: "2026-11-15T17:30:00.000Z", endsAt: "2026-11-15T19:00:00.000Z", limit: 40 });
  const published = publishedEvents([allDay, timed], new Date("2026-11-01T00:00:00.000Z"));
  assert.deepEqual(published.map((event) => Object.keys(event).sort()), Array(2).fill(["allDay", "endsAt", "id", "limit", "rsvp", "startsAt", "timeZone", "title"]));
  assert.equal(formatEventWhen(published[0]), "Monday, November 9, 2026");
  assert.equal(formatEventWhen(published[0]), formatEventWhen(allDay));
  assert.equal(formatEventWhen(published[1]), formatEventWhen(timed));
  assert.equal(published[1].limit, 40);
  // Like the page, it leaves out what has ended.
  assert.deepEqual(publishedEvents([allDay, timed], new Date("2026-11-10T00:00:00.000Z")).map((event) => event.id), ["timed"]);
});

// Global constraint: build-time data is never committed. The deploy restores the
// last synced list from the Actions cache; only the empty default is in git.
test("the committed content/events.json is the empty default", () => {
  const committed = JSON.parse(fs.readFileSync(new URL("../content/events.json", import.meta.url), "utf8"));
  assert.deepEqual(committed, { syncedAt: null, events: [] },
    "content/events.json holds synced events: restore it with `git checkout content/events.json`");
});

#!/usr/bin/env node
// Writes scripts/fixtures/events.e2e.json (git-ignored) for the RSVP browser
// tests (e2e/rsvp.spec.ts): four events with times relative to now, in the
// shape scripts/sync-events.mjs gives content/events.json. Build with it:
//
//   node scripts/fixtures/write-events-fixture.mjs
//   EVENTS_FIXTURE=scripts/fixtures/events.e2e.json \
//   NEXT_PUBLIC_API_BASE_URL=https://api.tzionbreslov.org \
//   NEXT_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA npm run build
//   npm run check:static-export
//   TZ_E2E_EVENTS=1 npx playwright test e2e/rsvp.spec.ts
//
// EVENTS_FIXTURE is read only at build time (scripts/write-site-files.mjs and
// lib/pages/events.ts); content/events.json is never touched. Run it from the
// project root. e2e/rsvp.spec.ts imports FIXTURE_IDS (so no import.meta here:
// Playwright loads this file as CommonJS).
import fs from "node:fs";
import path from "node:path";

export const FIXTURE_IDS = {
  started: "5ea7ed0000000000000000aa",
  open: "0be0000000000000000000aa",
  noRsvp: "0ff0000000000000000000aa",
  limited: "11a1100000000000000000aa"
};

const HOUR = 3_600_000;
const now = Date.now();
// Tomorrow on the hour, so the cards read like real events.
const tomorrow = Math.ceil((now + 24 * HOUR) / HOUR) * HOUR;
const iso = (ms) => new Date(ms).toISOString();

const event = (fields) => ({
  summary: "",
  location: "Bet Shemesh",
  timeZone: "Asia/Jerusalem",
  allDay: false,
  rsvp: "open",
  limit: null,
  ...fields
});

// What an events manager may paste into a description: addresses of removed pages on
// both domains (also over http, with www, without the trailing slash), a YouTube embed
// address and HTML with single-quoted attributes. The calendar's words are text on the
// page (lib/events.mjs escapes them, never links them), so they must not fail
// scripts/check-static-export.mjs, which CI runs on this build.
const PASTED_LINKS = "Details: https://tzionbreslov.com/resources/ and https://tzionbreslov.org/video/video-1/ " +
  "(the talk: https://www.youtube.com/embed/abc123). Also http://www.tzionbreslov.com/about and " +
  "<a href='/resources'>the old page</a> <img src='https://www.tzionbreslov.org/about/'>";

const events = [
  // Started an hour ago and still running: listed, but RSVPs have closed.
  event({ id: FIXTURE_IDS.started, title: "Morning learning", startsAt: iso(now - HOUR), endsAt: iso(now + 2 * HOUR) }),
  event({ id: FIXTURE_IDS.open, title: "Weekly class", summary: "Open to everyone.", startsAt: iso(tomorrow), endsAt: iso(tomorrow + 90 * 60_000) }),
  event({ id: FIXTURE_IDS.noRsvp, title: "Talk at another venue", summary: PASTED_LINKS, location: "Jerusalem, see https://tzionbreslov.com/about/", rsvp: "off", startsAt: iso(tomorrow + 2 * HOUR), endsAt: iso(tomorrow + 3 * HOUR) }),
  // A "<" or ">" that isn't part of a tag is text from the calendar (scripts/lib/google-calendar.mjs keeps it).
  event({ id: FIXTURE_IDS.limited, title: "Shabbaton", summary: "Places are limited.\nFor kids <10, adults >18.", limit: 40, startsAt: iso(tomorrow + 24 * HOUR), endsAt: iso(tomorrow + 26 * HOUR) })
];

if (/write-events-fixture\.mjs$/.test(process.argv[1] ?? "")) {
  const file = path.resolve("scripts", "fixtures", "events.e2e.json");
  fs.writeFileSync(file, `${JSON.stringify({ syncedAt: iso(now), events }, null, 2)}\n`);
  console.log(`events fixture: ${events.length} events → ${path.relative(process.cwd(), file)}`);
}

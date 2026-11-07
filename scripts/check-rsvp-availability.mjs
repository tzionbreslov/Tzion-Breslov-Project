#!/usr/bin/env node
// Switch-day smoke check for RSVPs (README → Switch day, step 11): the forms
// Worker must be able to read the site's /events.json and list, in
// GET /v1/rsvp/availability, every upcoming event that takes RSVPs. A 200 alone
// isn't enough: if the Worker skipped every event (worker/src/events.ts), it
// would still answer 200 with no events, and every RSVP would fail.
//
//   node scripts/check-rsvp-availability.mjs
//   node scripts/check-rsvp-availability.mjs https://tzionbreslov.org https://api.tzionbreslov.org
//
// Read-only: two GETs. Exit 0 = every upcoming open event is listed; 1 = a
// failure; 2 = nothing to compare (no upcoming event takes RSVPs).

/**
 * The ids of the feed's upcoming events that take RSVPs, and those of them the
 * availability answer doesn't list.
 * @param {{ events: Array<{ id: string; startsAt: string; rsvp: string }> }} feed the site's /events.json
 * @param {{ events?: Record<string, unknown> }} availability GET /v1/rsvp/availability
 */
export function missingFromAvailability(feed, availability, now = Date.now()) {
  const open = feed.events.filter((event) => event.rsvp === "open" && Date.parse(event.startsAt) > now).map((event) => event.id);
  const listed = new Set(Object.keys(availability.events ?? {}));
  return { open, missing: open.filter((id) => !listed.has(id)) };
}

async function getJson(url) {
  // Like the Worker, never follow a redirect: /events.json must be a plain 200.
  const response = await fetch(url, { redirect: "manual", headers: { Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
  if (response.status !== 200) throw new Error(`${url} answered ${response.status}${response.headers.get("location") ? ` → ${response.headers.get("location")}` : ""}`);
  return response.json();
}

async function main() {
  const site = (process.argv[2] ?? "https://tzionbreslov.org").replace(/\/+$/, "");
  const api = (process.argv[3] ?? "https://api.tzionbreslov.org").replace(/\/+$/, "");
  const feed = await getJson(`${site}/events.json`);
  const availability = await getJson(`${api}/v1/rsvp/availability`);
  const { open, missing } = missingFromAvailability(feed, availability);
  if (!open.length) {
    console.log(`${site}/events.json lists no upcoming event that takes RSVPs: nothing to compare. Add one to the calendar, redeploy the site and check again.`);
    process.exitCode = 2;
    return;
  }
  if (missing.length) {
    console.error(`RSVPs FAIL: ${missing.length} of ${open.length} upcoming open events are missing from ${api}/v1/rsvp/availability: ${missing.join(", ")}`);
    process.exitCode = 1;
    return;
  }
  console.log(`RSVPs OK: all ${open.length} upcoming open events are listed by ${api}/v1/rsvp/availability.`);
}

if (/check-rsvp-availability\.mjs$/.test(process.argv[1] ?? "")) {
  main().catch((error) => {
    console.error(`RSVPs FAIL: ${error.message}`);
    // exitCode, not exit(): exiting while fetch sockets close crashes Node on Windows.
    process.exitCode = 1;
  });
}

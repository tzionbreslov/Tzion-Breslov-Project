import assert from "node:assert/strict";
import test from "node:test";
import { checkRsvpAvailability, missingFromAvailability } from "./check-rsvp-availability.mjs";

const now = Date.parse("2026-11-08T12:00:00.000Z");
const feed = {
  events: [
    { id: "a".repeat(24), startsAt: "2026-11-09T17:30:00.000Z", rsvp: "open" },
    { id: "b".repeat(24), startsAt: "2026-11-10T17:30:00.000Z", rsvp: "open" },
    { id: "c".repeat(24), startsAt: "2026-11-10T17:30:00.000Z", rsvp: "off" },
    { id: "d".repeat(24), startsAt: "2026-11-08T09:00:00.000Z", rsvp: "open" }
  ]
};

test("every upcoming open event listed: nothing missing", () => {
  const availability = { ok: true, events: { ["a".repeat(24)]: { full: false, remaining: null }, ["b".repeat(24)]: { full: true, remaining: 0 } } };
  assert.deepEqual(missingFromAvailability(feed, availability, now), { open: ["a".repeat(24), "b".repeat(24)], missing: [] });
});

test("a 200 with no events (every event skipped) is a failure, not a pass", () => {
  assert.deepEqual(missingFromAvailability(feed, { ok: true, events: {} }, now).missing, ["a".repeat(24), "b".repeat(24)]);
});

test("\"No RSVP\" and started events are not expected", () => {
  const { open } = missingFromAvailability(feed, { ok: true, events: {} }, now);
  assert.ok(!open.includes("c".repeat(24)));
  assert.ok(!open.includes("d".repeat(24)));
});

// checkRsvpAvailability: the whole check, with the two GETs and the wait stubbed (nothing leaves the machine).
const SITE = "https://site.test";
const API = "https://api.test";
const listedBoth = { ok: true, events: { ["a".repeat(24)]: { full: false, remaining: null }, ["b".repeat(24)]: { full: false, remaining: 3 } } };
const listedA = { ok: true, events: { ["a".repeat(24)]: { full: false, remaining: null } } };

/** Answers each try's two GETs from `availabilities` in turn (the last one repeats), and records the waits. */
function stubbed(availabilities, feedAnswer = feed) {
  const asked = [];
  const waits = [];
  let tries = 0;
  return {
    asked,
    waits,
    options: {
      site: SITE,
      api: API,
      now: () => now,
      getJson: async (url) => {
        asked.push(url);
        if (url === `${SITE}/events.json`) return feedAnswer;
        return availabilities[Math.min(tries++, availabilities.length - 1)];
      },
      sleep: async (ms) => {
        waits.push(ms);
      },
      log: () => undefined
    }
  };
}

test("all upcoming open events listed at once: OK, no waiting", async () => {
  const run = stubbed([listedBoth]);
  const result = await checkRsvpAvailability(run.options);
  assert.equal(result.code, 0);
  assert.match(result.message, /^RSVPs OK: all 2 upcoming open events are listed/);
  assert.deepEqual(run.waits, []);
});

test("an answer without ok: true fails at once, without retrying", async () => {
  for (const answer of [{ ok: false, error: "EVENTS_UNAVAILABLE" }, { events: listedBoth.events }, null]) {
    const run = stubbed([answer]);
    const result = await checkRsvpAvailability(run.options);
    assert.equal(result.code, 1, JSON.stringify(answer));
    assert.match(result.message, /RSVPs FAIL: .*"ok": true/);
    assert.deepEqual(run.waits, []);
    assert.equal(run.asked.length, 2);
  }
});

test("right after a redeploy (the Worker still holds the old events): waits, checks again, then passes", async () => {
  const run = stubbed([listedA, listedA, listedBoth]);
  const result = await checkRsvpAvailability(run.options);
  assert.equal(result.code, 0);
  assert.deepEqual(run.waits, [30_000, 30_000]);
  assert.equal(run.asked.length, 6);
});

test("still missing after 2 minutes (5 tries, 30 s apart): fails, naming the missing events", async () => {
  const run = stubbed([listedA]);
  const result = await checkRsvpAvailability(run.options);
  assert.equal(result.code, 1);
  assert.deepEqual(run.waits, [30_000, 30_000, 30_000, 30_000]);
  assert.match(result.message, new RegExp(`^RSVPs FAIL: 1 of 2 upcoming open events are missing from ${API}/v1/rsvp/availability: ${"b".repeat(24)}`));
});

test("no upcoming open event: nothing to compare (exit 2), no waiting", async () => {
  const run = stubbed([listedBoth], { events: [{ id: "c".repeat(24), startsAt: "2026-11-10T17:30:00.000Z", rsvp: "off" }] });
  const result = await checkRsvpAvailability(run.options);
  assert.equal(result.code, 2);
  assert.deepEqual(run.waits, []);
});

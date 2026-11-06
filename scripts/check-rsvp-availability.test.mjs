import assert from "node:assert/strict";
import test from "node:test";
import { missingFromAvailability } from "./check-rsvp-availability.mjs";

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

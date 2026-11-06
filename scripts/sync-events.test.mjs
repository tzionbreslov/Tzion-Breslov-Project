import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

// scripts/sync-events.mjs as the deploy runs it (GITHUB_ACTIONS set). Only the
// paths that never reach the network: no address, and an address it refuses.
const script = fileURLToPath(new URL("./sync-events.mjs", import.meta.url));
const run = (address) => spawnSync(process.execPath, [script], {
  encoding: "utf8",
  env: { ...process.env, GITHUB_ACTIONS: "true", GOOGLE_CALENDAR_ICAL_URL: address }
});

test("without an address the sync only leaves a notice, and exits 0", () => {
  const result = run("");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^::notice title=Google Calendar::GOOGLE_CALENDAR_ICAL_URL is not set/m);
});

test("an address that isn't Google's public iCal address fails with one ::error line, not a stack trace", () => {
  const result = run("https://calendar.google.com/calendar/ical/someone%40gmail.com/private-0123456789abcdef/basic.ics");
  assert.equal(result.status, 1);
  assert.match(result.stdout, /^::error title=Google Calendar::GOOGLE_CALENDAR_ICAL_URL must be Google's HTTPS public iCal address/m);
  assert.doesNotMatch(result.stdout + result.stderr, /^\s+at /m);
  // The refused (secret) address itself never reaches the log.
  assert.ok(!(result.stdout + result.stderr).includes("private-0123456789abcdef"));
});

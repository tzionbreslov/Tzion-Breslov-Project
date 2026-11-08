#!/usr/bin/env node
// Switch-day smoke check for RSVPs (README → Switch day, step 11): the forms
// Worker must be able to read the site's /events.json and list, in
// GET /v1/rsvp/availability, every upcoming event that takes RSVPs. A 200 alone
// isn't enough: if the Worker skipped every event (worker/src/events.ts), it
// would still answer 200 with no events, and every RSVP would fail. The answer
// must also say "ok": true.
//
// Right after a redeploy of the site, the Worker can still hold the previous
// /events.json for up to 60 s (cached per isolate) and share an availability
// answer for up to 30 s more (Cache API). So while upcoming events are missing,
// it checks again every 30 s, 5 tries in all (2 minutes), before it fails.
//
//   node scripts/check-rsvp-availability.mjs
//   node scripts/check-rsvp-availability.mjs https://tzionbreslov.org https://api.tzionbreslov.org
//
// Read-only: two GETs per try. Exit 0 = every upcoming open event is listed;
// 1 = a failure; 2 = nothing to compare (no upcoming event takes RSVPs).

/** Tries, and the wait between them: together they outlast the Worker's 60 s feed cache and 30 s shared answer. */
const ATTEMPTS = 5;
const RETRY_DELAY_MS = 30_000;

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

/**
 * The whole check. A non-200 (getJson throws) or an answer without "ok": true
 * fails at once; only missing events are checked again, after a wait.
 * @param {{
 *   site: string; api: string;
 *   getJson: (url: string) => Promise<any>;
 *   sleep: (ms: number) => Promise<void>;
 *   log?: (line: string) => void;
 *   now?: () => number;
 *   attempts?: number; delayMs?: number;
 * }} options
 * @returns {Promise<{ code: 0 | 1 | 2; message: string }>}
 */
export async function checkRsvpAvailability({ site, api, getJson, sleep, log = () => undefined, now = Date.now, attempts = ATTEMPTS, delayMs = RETRY_DELAY_MS }) {
  const endpoint = `${api}/v1/rsvp/availability`;
  for (let attempt = 1; ; attempt += 1) {
    const feed = await getJson(`${site}/events.json`);
    const availability = await getJson(endpoint);
    if (availability?.ok !== true) {
      return { code: 1, message: `RSVPs FAIL: ${endpoint} answered 200 without "ok": true.` };
    }
    const { open, missing } = missingFromAvailability(feed, availability, now());
    if (!open.length) {
      return { code: 2, message: `${site}/events.json lists no upcoming event that takes RSVPs: nothing to compare. Add one to the calendar, redeploy the site and check again.` };
    }
    if (!missing.length) return { code: 0, message: `RSVPs OK: all ${open.length} upcoming open events are listed by ${endpoint}.` };
    if (attempt >= attempts) {
      return {
        code: 1,
        message: `RSVPs FAIL: ${missing.length} of ${open.length} upcoming open events are missing from ${endpoint}: ${missing.join(", ")} (still after ${attempts} tries, ${Math.round(((attempts - 1) * delayMs) / 1000)} s).`
      };
    }
    log(`${missing.length} of ${open.length} upcoming open events not listed yet: the Worker can hold the previous events for up to 90 s after a redeploy. Checking again in ${Math.round(delayMs / 1000)} s (try ${attempt + 1} of ${attempts}).`);
    await sleep(delayMs);
  }
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
  const { code, message } = await checkRsvpAvailability({
    site,
    api,
    getJson,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    log: (line) => console.log(line)
  });
  if (code === 1) console.error(message);
  else console.log(message);
  process.exitCode = code;
}

if (/check-rsvp-availability\.mjs$/.test(process.argv[1] ?? "")) {
  main().catch((error) => {
    console.error(`RSVPs FAIL: ${error.message}`);
    // exitCode, not exit(): exiting while fetch sockets close crashes Node on Windows.
    process.exitCode = 1;
  });
}

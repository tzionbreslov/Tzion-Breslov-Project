#!/usr/bin/env node
// Refreshes content/events.json (the Events page) from the public Google Calendar
// at GOOGLE_CALENDAR_ICAL_URL (docs/EVENT_CALENDAR.md). The deploy runs it before
// every build and carries the result between builds in the Actions cache; it is
// never committed (git keeps only the empty default).
//
//   npm run sync:events              # outage-tolerant: keeps current data, exit 0
//   npm run sync:events -- --strict  # treat an unreachable calendar as a failure
//
// No address set: a notice, and the page shows what content/events.json holds.
// Google unreachable (3 tries): a warning, and the same. An address that isn't
// Google's public iCal address, or an answer that isn't a calendar, always fails
// (exit 1, with one ::error line in the deploy log).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCalendarCatalog, publicGoogleCalendarUrl } from "./lib/google-calendar.mjs";

const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "content", "events.json");
const strict = process.argv.includes("--strict");
const inActions = Boolean(process.env.GITHUB_ACTIONS);
const MAX_LENGTH = 5_000_000;
const ATTEMPTS = 3;
const TITLE = "Google Calendar";

// Workflow commands go to stdout and end at a line break: escape the message (calendar text included).
const commandData = (message) => message.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
const command = (kind, message, title) => console.log(`::${kind}${title ? ` title=${title}` : ""}::${commandData(message)}`);
const notice = (message) => (inActions ? command("notice", message, TITLE) : console.log(`notice: ${message}`));
const warn = (message, title) => (inActions ? command("warning", message, title) : console.warn(`warning: ${message}`));
const fail = (message) => (inActions ? command("error", message, TITLE) : console.error(`error: ${message}`));

async function fetchCalendar(url) {
  let last = "";
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { accept: "text/calendar, text/plain;q=0.9", "user-agent": "Tzion-Breslov-event-sync/1.0" },
        redirect: "error",
        signal: AbortSignal.timeout(30_000)
      });
      if (response.ok) return await response.text();
      last = `HTTP ${response.status}`;
    } catch (error) {
      last = error instanceof Error ? [error.message, error.cause instanceof Error && error.cause.message].filter(Boolean).join(": ") : String(error);
    }
    // 5 s, then 10 s.
    if (attempt < ATTEMPTS) await new Promise((resolve) => setTimeout(resolve, attempt * 5_000));
  }
  return { unavailable: last };
}

async function main() {
  const current = JSON.parse(fs.readFileSync(file, "utf8"));
  const kept = `kept the ${current.events.length} event(s) already in content/events.json`;

  const address = process.env.GOOGLE_CALENDAR_ICAL_URL?.trim() ?? "";
  if (!address) {
    notice(`GOOGLE_CALENDAR_ICAL_URL is not set (docs/EVENT_CALENDAR.md); ${kept}`);
    return;
  }
  const url = publicGoogleCalendarUrl(address);

  const body = await fetchCalendar(url);
  if (typeof body !== "string") {
    const message = `calendar unavailable (${body.unavailable}); ${kept}`;
    if (strict) throw new Error(message);
    warn(message, TITLE);
    return;
  }
  if (body.length > MAX_LENGTH) throw new Error("Google Calendar returned an unexpectedly large feed.");

  const { events, warnings } = buildCalendarCatalog(body);
  for (const warning of warnings) warn(warning);

  if (JSON.stringify(events) === JSON.stringify(current.events)) {
    console.log(`events.json: ${events.length} upcoming event(s), no changes`);
  } else {
    fs.writeFileSync(file, `${JSON.stringify({ syncedAt: new Date().toISOString(), events }, null, 2)}\n`);
    console.log(`events.json: ${events.length} upcoming event(s), updated`);
  }
}

try {
  await main();
} catch (error) {
  // One readable line for the deploy log (the address itself is never printed).
  fail(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

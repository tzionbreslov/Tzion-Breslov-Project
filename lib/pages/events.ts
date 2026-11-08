import fs from "node:fs";
import { resolve } from "node:path";
import copy from "@/content/copy/en.json";
import { readShared, type PageContent } from "@/lib/content";
import { renderAnnouncements, renderEventsList, upcomingEvents, type EventRecord } from "@/lib/events.mjs";
import { composePage } from "@/lib/pages/compose";
import { LARGE_SPACER, renderHero, wrapEntry } from "@/lib/pages/parts";

/**
 * The Events page: the Resources header with its own image and heading, then
 * the upcoming events from the Google Calendar (lib/events.mjs renders the
 * cards, with an RSVP button on those that take RSVPs) and the "Get event
 * announcements" signup. The list is content/events.json, refreshed before
 * every deploy by scripts/sync-events.mjs (docs/EVENT_CALENDAR.md) and never
 * committed: git keeps the empty default, which shows "No events are currently
 * scheduled". Events that ended since the last sync are left out at build time.
 *
 * EVENTS_FIXTURE (a path from the project root, build time only) replaces
 * content/events.json for the RSVP browser tests (scripts/fixtures/write-events-fixture.mjs).
 */

const HERO_IMAGE = "/wp-content/uploads/2023/06/eagle-in-the-sky.png";

function readEvents(): EventRecord[] {
  const fixture = process.env.EVENTS_FIXTURE?.trim();
  const json = fixture ? fs.readFileSync(resolve(process.cwd(), fixture), "utf8") : readShared("events.json");
  return (JSON.parse(json) as { events: EventRecord[] }).events;
}

export function eventsPage(path: string): PageContent {
  const text = copy.events;
  return composePage({
    path,
    title: text.title,
    description: text.description,
    slug: "events",
    main: wrapEntry(text.title, renderHero({ image: HERO_IMAGE, heading: text.heading }) +
      renderEventsList(upcomingEvents(readEvents()), text, copy.rsvp) + renderAnnouncements(copy.announcements) + LARGE_SPACER),
    islands: ["signup", "events"],
    image: HERO_IMAGE
  });
}

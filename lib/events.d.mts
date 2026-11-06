/** One upcoming event, as scripts/lib/google-calendar.mjs writes it to content/events.json. */
export type EventRecord = {
  id: string;
  title: string;
  summary: string;
  location: string;
  startsAt: string;
  endsAt: string;
  timeZone: string;
  allDay: boolean;
  rsvp: "open" | "off";
  limit: number | null;
};

/** The part of copy.events (content/copy/en.json) the list needs. */
export type EventsCopy = { emptyTitle: string; emptyText: string; contactLink: string };

export function formatEventWhen(event: EventRecord): string;
export function upcomingEvents<T extends Pick<EventRecord, "endsAt">>(events: T[], now?: Date): T[];
export function renderEventsList(events: EventRecord[], text: EventsCopy): string;

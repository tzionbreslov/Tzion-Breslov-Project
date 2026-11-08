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

/** One event as /events.json publishes it for the forms Worker. */
export type PublishedEvent = Pick<EventRecord, "id" | "title" | "startsAt" | "endsAt" | "timeZone" | "allDay" | "rsvp" | "limit">;

/** The part of copy.events (content/copy/en.json) the list needs; without `israelTime`, the cards use en.json's. */
export type EventsCopy = { emptyTitle: string; emptyText: string; contactLink: string; israelTime?: string };

/** formatEventWhen's options: the label for Israel's zone (copy.events.israelTime by default). */
export type EventWhenOptions = { israelTime?: string };

/** The part of copy.rsvp the cards need: the RSVP button, and the line offering email without JavaScript. */
export type RsvpButtonCopy = { button: string; noScript: string };

/** copy.announcements: the "Get event announcements" signup. */
export type AnnouncementsCopy = {
  heading: string;
  email: string;
  lists: string;
  events: string;
  newsletter: string;
  consent: string;
  privacyNotice: string;
  submit: string;
  noScript: string;
};

export function formatEventWhen(event: Pick<EventRecord, "startsAt" | "endsAt" | "timeZone" | "allDay">, options?: EventWhenOptions): string;
export function upcomingEvents<T extends Pick<EventRecord, "endsAt">>(events: T[], now?: Date): T[];
export function publishedEvents(events: EventRecord[], now?: Date): PublishedEvent[];
export function renderEventsList(events: EventRecord[], text: EventsCopy, rsvp: RsvpButtonCopy, now?: Date): string;
export function renderAnnouncements(text: AnnouncementsCopy): string;

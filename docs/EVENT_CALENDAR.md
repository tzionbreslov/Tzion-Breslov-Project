# Event calendar

The website's Events page (`/events/`) lists the upcoming events of one dedicated Google Calendar. After the one-time
setup below, whoever manages events only uses that calendar: create, edit, repeat, cancel or delete an event there. No
one needs to touch the website, GitHub or Cloudflare for an event.

The site reads the calendar when it is rebuilt: **every day around 07:00 and 21:00 Israel time** (GitHub can start
these a little late). To publish a change right
away, open the repository's **Actions** tab → **Deploy GitHub Pages** → **Run workflow**.

## One-time owner setup

These settings can only be changed from Google Calendar in a desktop browser.

1. Next to **Other calendars**, choose **+** → **Create new calendar**.
2. Name it **Tzion Breslov Events**. Don't use a person's own (primary) calendar.
3. In its **Settings and sharing** → **Access permissions for events**, tick **Make available to public** and choose
   **See all event details**. Everything on this calendar is published on the website.
4. Under **Share with specific people or groups**, add each person who manages events with **Make changes to events**.
   Never give the public edit access.
5. Under **Integrate calendar**, copy the **Public address in iCal format**. It is an `https://calendar.google.com/…`
   address ending in **`/public/basic.ics`**. Never use the **Secret address in iCal format**: it is a password to the
   calendar, and the site refuses it.
6. In GitHub, open the repository's **Settings** → **Secrets and variables** → **Actions** → **Variables** tab →
   **New repository variable**: name **`GOOGLE_CALENDAR_ICAL_URL`**, value the public address from step 5. (A
   *variable*, not a secret: the address is public.)
7. Run **Deploy GitHub Pages** once from the **Actions** tab and look at `/events/`.

Until the variable is set, every deploy notes "GOOGLE_CALENDAR_ICAL_URL is not set" and the page says "No events are
currently scheduled".

## Everyday editing

- **Event title** becomes the card's title (an untitled event reads "Tzion Breslov event").
- **Date, time and repeat settings** decide when it shows. Times are shown in the event's own time zone; Israel time
  reads "(Israel time)". All-day events show their date(s) only.
- **Location** becomes the card's location line (leave it empty for none).
- **Description** becomes the text on the card. Line breaks are kept, formatting (bold, links) is not, and a long
  description is shortened to about 320 characters with "…".
- **RSVPs.** Every event takes RSVPs, with no limit, unless its description says otherwise: its card has an **RSVP**
  button (the form works once the new site is live; until then it asks visitors to email). Type either marker on a
  **line of its own** in the description;
  markers are never shown on the page:
  - `No RSVP` — no RSVP button for this event (for example a talk at another venue).
  - `RSVP limit: 40` — at most 40 people in total; the page shows when the event is full. The limit must be a whole
    number of 1 or more; anything else (`RSVP limit: 0`, `RSVP limit: forty`) means no limit, and the deploy shows a
    warning naming the event. Any other line that starts with "RSVP limit" (`RSVP limit 40`, `RSVP limits: 40`) is
    not a marker: it stays on the card as written, sets no limit, and the deploy warns too.
- **Repeating classes:** every date takes its own RSVPs. Changing one date ("This event") keeps that date's RSVPs, and
  so does moving a one-off event. Changing the time of the whole series, or "This and following events", starts those
  dates afresh.
- **When RSVPs are deleted:** once the event is over. Every day the forms service reads the site's list of events and
  gives each event's RSVPs the event's current end, then deletes the RSVPs whose end has passed. So a moved event
  keeps its RSVPs until its new end, after the next rebuild has published the move. If that list can't be read, no RSVP
  is deleted that day. The RSVP emails in our inbox are not affected.
- **Cancelling or deleting** an event removes it at the next rebuild; its RSVPs are deleted once the end it had has
  passed. Events that have ended are removed automatically. The page lists at most the next 60 events within the
  coming 370 days.

If Google Calendar can't be reached, the deploy warns and the page keeps the events it showed before. If the address
isn't Google's public iCal address, or Google answers with something that isn't a calendar, the deploy stops and the
site stays as it was until that is fixed.

GitHub pauses scheduled workflows in public repositories after 60 days without a commit. If the page stops updating
by itself, re-enable **Deploy GitHub Pages** in the Actions tab (or run it once by hand).

## How it works (for developers)

- `scripts/sync-events.mjs` (`npm run sync:events`) reads the feed and writes `content/events.json`, only when the
  list changed. `scripts/lib/google-calendar.mjs` expands repeats (exceptions, EXDATEs, cancellations), keeps what
  hasn't ended within the horizon, and reads the markers. Each event's `id` is stable: a one-off event's comes from
  its UID, each date of a repeating event's from its UID and that date's RECURRENCE-ID.
- `content/events.json` is never committed: git holds only the empty default (`{ "syncedAt": null, "events": [] }`,
  checked by `scripts/events.test.mjs`). The deploy restores the last list from the Actions cache
  (`events-<run id>-<attempt>`), syncs, and saves it again before the build. Outage-tolerant by default;
  `npm run sync:events -- --strict` fails on an unreachable calendar instead.
- `lib/pages/events.ts` renders the page with `lib/events.mjs` (cards, dates, the empty state), leaving out events that
  ended since the last sync. `scripts/write-site-files.mjs` publishes the same events as `/events.json`
  (`id, title, startsAt, endsAt, timeZone, allDay, rsvp, limit`, via `publishedEvents`) for the forms Worker's RSVPs.
- To try a real calendar locally: `GOOGLE_CALENDAR_ICAL_URL=<public address> npm run sync:events && npm run build`,
  then `git checkout content/events.json`.

# Tzion Breslov — site structure and new features (design)

Date: 2026-11-06 · Status: **approved by the owner 2026-11-06**, plus the two owner rules below · Repo: `tzionbreslov/Tzion-Breslov-Project`

## Intent

The site is today an exact static copy of the WordPress site tzionbreslov.com (see `README.md`). The owner wants
to bring over the pages and features of the sister site **Ruach Breslov** (local repo
`../Ruach Breslov Main Site`, live at ruachbreslov.org) **while keeping Tzion's own theme and integrity**: everything
new must look like it was always part of Tzion (Genesis child theme look — Newsreader headings, Montserrat body,
dark-blue `#1E61A1`, turquoise `#70B9BC`, light-blue `#F2F9FF`, its rounded image style, its buttons), not like a
Ruach page pasted in. Existing Tzion content stays as it is unless listed here.

## Order of work (owner's instruction)

1. Everything in this document except translations — built, verified and merged (live on the GitHub Pages preview).
   **tzionbreslov.org goes live only when the owner says so** (after a conversation with the Rabbi). Changes to live
   services that the new features need — the Worker's RSVP route, its database migration, the "Event announcements"
   list in Resend — are built and tested in phase 1 but deployed **only with the owner's go-ahead**, normally on
   switch day (the forms are off on the preview anyway).
2. **Translations last**: the whole site into English, Hebrew, Spanish and Persian (Hebrew and Persian right-to-left),
   in batches, **starting with the articles**. That phase gets its own design once phase 1 is done; it is listed here
   only so phase 1 doesn't make it harder (see Constraints).

## Owner rules (2026-11-06, apply to everything)

1. **Don't change any of the wording currently on the website.** Every word that is on the site today stays exactly
   as it is: headings, paragraphs, buttons, menu labels, footer, article titles and their spellings. Relinking a button
   keeps its label. Where a new page needs the same thing an existing page already says, it reuses that wording (Classes
   and Articles open with the Resources page's own header, "More purpose, passion and positivity" / "Resources for
   those seeking spiritual growth.", and the bite-size clips keep their existing titles). Only genuinely new things get
   new text (new menu items, controls on the new pages, the Privacy page, the Events and Gallery pages). The only text
   that leaves the site is on the pages the owner asked to remove. A build check compares every remaining page's text
   with checkpoint-001, so a wording change can't slip through unnoticed.
2. **A real checkpoint with every change**, so anything can be rolled back. Each change ships as its own pull request;
   every merge into `main` is recorded as an unmovable checkpoint (`checkpoint-NNN` tag + GitHub Release listing the
   changes) that the site can be rolled back to, right away on the preview or for good (`ROLLBACK.md`).
   `checkpoint-001` is the site before this work. Changes to live services (Worker, database, DNS, redirect rules)
   record how to undo them before they're made (Worker version, D1 Time Travel bookmark, exported records).

## Goals (phase 1)

### 1. Navigation

- Menu, left to right: **Home · About · Resources ▾ · Events · Gallery · Contact**, plus the existing **Taste a Class**
  and **Donate** buttons. *(Placement of Events and Gallery as top-level items is my call — see "Calls I made".)*
- **Home** is a new menu link to today's homepage (`/`, "A New Path Never Before Traveled"), which is otherwise
  unchanged. There was no Home link before.
- **About** stays exactly as it is (`/about-us/`, including "How it all began").
- **Contact** keeps its name.
- **Resources** becomes a dropdown with **Classes** and **Articles**. It must work by mouse, keyboard and touch, and in
  the mobile menu (where today's menu is a slide-out list).
- The footer "Quick Links" list follows the same structure *(my call)*.

### 2. Classes page (new, replaces the Classes and Bite-size videos tabs)

A copy of **Ruach Breslov's videos page with all its features** (`components/video-library.tsx` and its page), in
Tzion's look:
- Two tabs: **Videos** (full classes) and **Shorts** (short clips).
- Search box; sort by **Latest / Most popular / Oldest**, always opening on **newest first** (both tabs).
- Videos play on the site in **Ruach's sleek player** (its look and animation; privacy-enhanced YouTube embed loaded
  only on click; closes with its close button or Escape). After the old pages are removed (section 4) this is the
  **only** way any video plays on the site — no plain YouTube embeds remain anywhere.
- **Thumbnails keep today's size**: three across on desktop, like the current Classes tab (~470px wide, 16:9).
- **Content: the most recent uploads only** (the channel's public RSS feed, as today: latest 15, accumulated over
  time in `content/youtube.json`), plus the **27 bite-size videos** from the old site (the `/video/video-N` pages) in
  the **Shorts** tab. No full archive, no Google Cloud / YouTube API key (owner declined).
- A clear **"Visit our YouTube channel"** link (as on Ruach) for everything else.
- New uploads keep appearing automatically through the scheduled rebuilds (twice daily, see Events).
- Ends with the three sections that close today's Resources page: **"Live Speaking Engagements"**, the **quote**, and
  the **donate prompt** ("Yes, I would like to donate").

### 3. Articles page (new)

- The **18 weekly Parasha articles**, presented as today's "Articles" tab (same cards, same in-place pagination).
- Ends with the same three closing sections as Classes.
- Article titles and their spelling are **not** to be changed — the mixed "Parashas / Parshas / Parshat" spellings are
  intentional.
- (Done already, 2026-11-06: the articles' "Breeze of Breslov" header now renders correctly — PR #10 — and is
  tall enough to show the whole heart-shaped cloud — PR #11.)

### 4. Old pages removed, everything relinked (owner: "remove any old pages")

- **Removed entirely** (no page, no forwarding page left on the site):
  - `/resources/`, `/resources/page/2/`, `/resources/page/3/` (replaced by Classes and Articles);
  - the 27 `/video/video-N` pages (their clips are the Shorts tab);
  - the WordPress leftovers `/category/uncategorized/` (+ page 2) and `/author/esti-wolo/` (+ page 2), which only
    re-list the articles;
  - the `/about/` forwarding page.
- **Every link to them is redone for the new structure**: the menu (desktop and mobile) and footer Quick Links get the
  new items; the "**Enrich your life**" buttons on Home and About go to **Classes** *(my call)*; Home's "**Read my full
  story**" button, which points at the `/about/` forwarding page, goes straight to About (`/about-us/`); labels stay as
  they are; nothing on the site may link to a removed address (the export check enforces this).
- So old bookmarks and search results don't dead-end after launch, the **Cloudflare redirect rules** set up on switch
  day send the old addresses to their new homes (`/resources/` and the video pages → Classes, the archives and
  `/resources/page/N/` → Articles, `/about/` → About) *(my call)* — rules at the edge, not pages on the site.
- **Instagram**: switched off and hidden completely (no tab, no link). The code stays in the repo, dormant, so it can be
  turned back on later.

### 5. Gallery page (new)

- A copy of **Ruach's gallery** (photo grid + full-screen "cinematic" viewer with next/previous, keyboard, swipe, close).
- **Placeholder content for now**: the 4 real photos already on the site (class gathering, group selfie, the Rabbi
  lecturing, the Rabbi's portrait) and the **3 collages kept as they are**. Not included: the Likutei Moharan product
  shot, the sky/landscape banners, the logos.
- Swapping in real photos later must be "add files", no code changes.

### 6. Events page (new) with RSVPs

- A copy of **Ruach's events page**: upcoming events from **one dedicated Google Calendar** (plain Google Calendar — no
  Google Cloud), each with date, time, place and description. Whoever manages events only uses the calendar.
- The site checks the calendar **twice a day — morning and night, Israel time** (owner's choice; 07:00 and 21:00 is
  my call). The whole site rebuilds at those times, which also refreshes the YouTube videos (replacing today's single
  04:41 UTC rebuild). This must happen **without committing to `main`** (the branch only accepts reviewed PRs).
- **RSVP** on each event, using Ruach's dialog (name, email, number of guests 1–12, accessibility needs, consent) and
  Ruach's emails ("RSVP received" to the visitor, "New RSVP" to the organizer at the contact inbox).
- **RSVP rules, all controlled from the calendar** (owner agreed; differs from Ruach, whose Worker needs a hand-made
  database row per event, so Ruach shows no RSVP on calendar events at all):
  - every event takes RSVPs by default, **no attendance cap**, 1–12 people per RSVP;
  - RSVPs close when the event starts;
  - typing **"No RSVP"** in an event's description hides the button (e.g. talks at another venue);
  - typing **"RSVP limit: 40"** caps total attendance; the page then shows when the event is full;
  - each date of a recurring class takes its own RSVPs.
  No developer step per event and no Cloudflare credentials in GitHub: the Worker must learn which events exist, their
  start time and limit from the calendar data the site already publishes (exact mechanism left to the builder).
  The RSVP route and its storage were removed from Tzion's Worker on 2026-11-05 and come back adapted to these rules.
- **"Event announcements"**: a second opt-in email list next to the newsletter (as Ruach's signup form). It only
  **collects** sign-ups; announcements are sent **by hand** from Resend (owner's choice). No automatic sending.
- One-time owner step: make the calendar's address available to the site (Ruach's `docs/EVENT_CALENDAR.md`).

### 7. Privacy page (new)

- Adapted from **Ruach's privacy page** for Tzion: what the contact, newsletter, event-announcement and RSVP forms
  collect, where it is stored and for how long, Turnstile, Resend, YouTube (privacy-enhanced, on click), the map,
  Cloudflare, and that there are no analytics/ads cookies. Linked from the footer.
- The text describes the site as built; the owner reads and approves it before launch.

### 8. Map on the Contact page

- **Ruach's contact map**: an embedded Google map with a "get directions" link, added to the existing Contact page
  next to the "Beit Shemesh, Israel" card. The pin is **"Bet Shemesh, Israel"** (owner). Rest of the Contact page
  unchanged.

### 9. Self-service for monthly donors

- Ruach lets monthly donors manage or cancel their own gift (Stripe portal). Tzion's donations will run on **PayPal**
  (not wired yet), so the equivalent is a **"Manage your monthly donation"** link on the Donate page to PayPal's
  automatic-payments page.

## Non-goals

- Translations (phase 2), PayPal checkout wiring, Instagram, a full YouTube archive.
- Ruach's decorative extras (animated/WebGPU backgrounds, its own scroll effects) — Tzion keeps its own animations.
- Changing existing Tzion page content or design beyond what is listed.

## Anti-goals (would be a failure even if it works)

- Changing any wording that is on the site today (owner rule 1), or a change that can't be rolled back (owner rule 2).
- New pages that look like Ruach's rather than Tzion's.
- Dead ends: no link on the site may point to a removed page, and after launch old addresses must redirect.
- Changing the Parasha titles or their spelling.
- Turning the forms (contact, signup, RSVP) on before switch day: they only work on tzionbreslov.org, and the site is
  still served from the GitHub Pages preview; until then they show "temporarily unavailable — email us".
- Anything that needs a bot commit to `main`, a weaker CSP than necessary, or secrets in the repo.

## Constraints

- Stack and process as in `README.md` / `AGENTS.md`: static Next.js export on GitHub Pages, Cloudflare Worker for forms,
  PR-only `main` with CI, `node scripts/check-csp.mjs` must pass with every new third-party origin added to
  `config/security-headers.mjs` first (the map adds Google Maps), visual diff stays ~0.00% on untouched pages.
- Existing pages are imported WordPress HTML (`content/pages/*.json`); new pages are new code. **Build new pages so
  their text can later be translated** (no text baked into images, copy kept in one place per page) — phase 2 will
  translate everything, imported pages included.
- Owner-supplied later: real gallery photos, the Google Calendar, PayPal, Instagram access.

## Calls I made (owner to check while reading)

These came out of the builder check or the conversation and are mine, not the owner's:


1. Menu order: Home · About · Resources ▾ · Events · Gallery · Contact, Events and Gallery as top-level items.
2. Footer Quick Links mirror the new menu.
3. Where removed addresses redirect after launch (section 4); "Enrich your life" buttons → Classes.
4. Instagram code stays dormant in the repo rather than deleted; the footer Instagram **icon** stays (owner agreed).
5. Twice-daily rebuild times: 07:00 and 21:00 Israel time.
6. "Most popular" uses the view counts in YouTube's public feed (newest uploads only); videos without a count sort
   after those that have one; the Shorts tab sorts by date only. Default order everywhere: newest first (owner).
7. This repo is where content changes now (owner confirmed); structural changes survive a re-import.
8. Languages (phase 2, owner confirmed): English keeps today's addresses; Hebrew, Spanish, Persian under /he/, /es/,
   /fa/. Phase 1 keeps everything translatable and doesn't rule this out.

## Left to the builder

Page layouts and component styling within Tzion's look; URL slugs for new pages (`/classes/`, `/articles/`,
`/events/`, `/gallery/`, `/privacy/` suggested); data formats; how the hourly calendar check avoids commits; RSVP
storage schema and retention (Ruach used 365 days); how the dropdown is implemented; tests and verification.

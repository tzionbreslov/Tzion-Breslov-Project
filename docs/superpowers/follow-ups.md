# Phase 1 follow-ups (parked during the site-structure work)

Phase 1 of the site structure (plan `docs/superpowers/plans/2026-11-06-site-structure.md`) ended at checkpoint-016.
Each task's review and the final whole-branch review found small issues that were parked, not fixed. This file
keeps the ones still open, so they outlive the review notes. None blocks the preview site.

- **"Checked"** means the item was confirmed still present on main at cd94b1f (checkpoint-016).
- Every other item is as the review described it. Re-check the code before acting on it.

Owner decisions are not here; they live in `PROJECT_MEMORY.md` → "Owner decisions still open".

## Checks and tests

- **Known gaps in the export guard, not exposed today** (`scripts/lib/export-guard.mjs`, found in PR #29):
  - host matching is case-sensitive, so `https://TzionBreslov.com/about/` passes: the content spells the domain only
    in lowercase, and `resolveSiteUrl` lowercases the site URL;
  - unquoted attributes (`href=/about/`) aren't read: React and the imported HTML quote every attribute, and none is
    unquoted in `content/` or `out/`;
  - a single-quoted canonical isn't checked: Next's metadata writes the canonical, always double-quoted;
  - a single-quoted bare `/` under the base path isn't caught: the export has no single-quoted `href`/`src` at all;
  - the `out/**/*.txt` RSC payloads aren't walked: PR #29 measured them, and none links anywhere the page's HTML
    doesn't (default, .org and events-fixture builds);
  - `{"href":"…"}` props in the flight data aren't read: they belong to server-rendered elements, so the same link is
    always in the HTML too;
  - a URL in prose ending in `.`, `,` or `)` (`https://tzionbreslov.com/about.`) isn't read as a removed page:
    reading prose URLs needs a tokenizer, and the export has no such URL today;
  - an absolute site URL with an apostrophe (`https://tzionbreslov.com/video's-page`) is read by the text scan up to
    the `'` and fails as `/video`: this fails safe, and the text scan needs that cut-off for single-quoted attributes;
  - after the switch, an old-domain link outside an Events card gives two messages (the text one and the link one):
    noise only, since the deploy fails either way.
- **Per-text-node wording check.** It compares each text node separately, so splitting or merging an existing text
  node fails loudly. Never "fix" that by regenerating the baseline (`tests/wording/checkpoint-001.json` is never
  regenerated).
- **`playwright.config.ts:11`'s 60 s timeout** covers an unexplained local stall. CI is steady. Checked.
  Left as it is: a full local `npm run check` on 2026-11-08 (290 browser tests, 10 workers) didn't reproduce the
  stall. The slowest test took 11.5 s, and none took more than 30 s, so there's no evidence to change the timeout.

## Code

- **`compose.ts` hard-codes `SITE_NAME`** ("Tzion Breslov"). Checked. Left as it is (2026-11-08): no copy or site
  config holds the name. The only other copy is the Worker's `ORGANIZATION_NAME` in `wrangler.jsonc`, which the site
  build doesn't read.
- **`scripts/lib/youtube-feed.mjs` (`extractText`) escapes the tag name for a RegExp inline**, a third copy of
  `escapeRegExp` (found 2026-11-08, Group 4). Left as it is: it is a dependency-free parser for `sync:youtube`, and
  sharing the helper would make it import `config/site-structure.mjs` (and `site-url.mjs`) for one line.

## Events and calendar

- **Floating times in a UTC calendar are read as Israel time.**
- **Without JavaScript, a started event's card also says "To RSVP, email us…".** Since 2026-11-08 (Group 5) the build
  marks the events that had started by then (`data-started`), so the line could be dropped from their cards without
  new text. Left as it is: an accepted trade-off, outside Group 5's scope. An event that starts after the build still
  can't be known without JavaScript.
- **The RSVP button can still move the page on load, for an event that started after the page was built.** Since
  2026-11-08 (Group 5) the build marks the events that had started by then (`data-started`), and their RSVP slot never
  takes room. A card whose event starts between two builds still drops its button when JavaScript loads, which moves
  the content below by about 72 px. Left as it is: keeping that room would leave an empty gap in the card, or need new
  text to fill it.
- **If an island fails to start**, its RSVP button and announcements form stay hidden, with no email line. This is
  the trade Ruling R13 asks for.

## Worker and RSVPs

Left as they are by Group 6 (2026-11-08), which fixed the rest of this list: each is accepted, out of its scope.
The Cloudflare rate-limit rule on `/v1/rsvp/availability` stays open decision 14 in `PROJECT_MEMORY.md`.

- **The guest email carries a visitor-typed name** to an address that isn't verified. Turnstile and the limits
  mitigate this.
- **Four parties of 12 fill a 40-seat event.** There is no cancel tool; use the D1 console.
- **Gaps in RSVP retention:**
  - all-day events end at UTC midnight, which is too early in zones more than 3 h west of UTC (not Israel);
  - after a Worker rollback, someone must run the dated DELETE by hand every day (README → Switch day, step 4's
    undo);
  - an event moved later loses its RSVPs at its old end; the organizer still has them by email.

Left by Group 6 itself (review fix round 1 of PR #33), each rare or a judgment call rather than a defect:
- **An RSVP attempt that stops before it confirms keeps its seats unless the visitor retries.** Its emails and
  confirmation run under `waitUntil`, so a dropped connection no longer stops it. It can still stop if the Worker's
  run ends, or if D1 fails both to confirm the RSVP and to give the seats back (`RSVP_CANCEL_FAILED`). Its row then
  holds the seats unconfirmed until the event ends, and nobody is emailed about it, unless the visitor retries the
  same submission (same requestId), which books it again. Before Group 6 such a row also kept its seats.
- **The timing values are the implementer's, not rulings:** each Resend call gives up after 10 s; a row unconfirmed
  for 30 s counts as stopped, and a retry waits up to that long for it. (How a waiting request reads the row is the
  controller's ruling: after 200 ms, then after waits that double up to 4 s, never past the moment the row turns
  stale, within one 30 s deadline for the whole request. A full 30 s wait is 12 D1 reads, and one request makes at
  most 22 D1 queries however other attempts race it, inside Workers Free's 50.)
- **One deadline per RSVP request** (controller's ruling): the check before the reservation and its 3 rounds share
  one 30 s deadline. A row there when the request began waiting turns stale before it, so a retry of a stopped
  attempt still books that row in the same call. But a row that another attempt with the same requestId took after
  this request began waiting, and still holds unconfirmed at the deadline, gets `REQUEST_IN_PROGRESS` (409) instead
  of up to 30 s more waiting; the site keeps the requestId and token, and its retry books that row once stale.
- **A confirmation that fails after the guest's email** (D1, logged `RSVP_CONFIRM_FAILED`) leaves the booking
  standing but unconfirmed. The organizer is still emailed and the visitor gets the success answer. A replay of that
  requestId waits until the row is 30 s old, then books it again with the same email keys (no second copy).

## Look and feel (owner-visible)

- **The page jumps when the header turns fixed** (the original theme's behaviour, kept for fidelity). On desktop
  (1280 px and up), when a scroll goes past 100 px the theme's `global.js` makes the header `position: fixed`, and
  everything under it moves up by the header's height (about 90 px), one frame after the scroll. A click pressed
  before that frame and released after it misses.
  - A deterministic replay of this timing matches both desktop CI failures found on 2026-11-08,
    `e2e/classes.spec.ts` (run 42426373302) and `e2e/rsvp.spec.ts` (run 42441324412). The bad timing was never seen
    on its own (0 in 30 throttled local runs), so it isn't proven to be their cause. Both tests were hardened with
    `scrollIntoViewAndSettle` (`e2e/helpers.ts`).
  - The same holds for `e2e/articles.spec.ts` ("pagination swaps the articles in place…", desktop, CI run
    42466627116 on PR #33, which changed no page code): the click on page 2 left page 1 in place. Its link sits at
    about 1,466 px; scrolling to it takes the page to 1,003 px and the link moves up 88.5 px as the header turns
    fixed. Not reproduced (0 in 30 local runs), so not proven either; hardened the same way.
  - Any other desktop first click whose own scroll takes the page past 100 px shares this race. For example, the
    gallery's first photo (`e2e/gallery.spec.ts`, "the first photo opens in the viewer…") ends below the fold at
    1440×900, and its click scrolls the page to 165 px. If such a test flakes, `scrollIntoViewAndSettle` is the remedy.
  - Fixing the page itself (keeping the header's place) would change how the theme behaves, so it needs the owner's
    go-ahead.
- **Classes:**
  - "Visit our YouTube channel" wraps to 2 lines at about 351 px or narrower;
  - at 374 px or narrower, the meta line stacks under the logo;
  - the empty-search message (`role=status`) appears from `hidden`, so it may not be announced.
- **Menu:**
  - a mouse-originated focus (right-click, ctrl-click, an aborted press on Classes) keeps the Resources panel open
    after the mouse leaves;
  - on iOS, a sticky `:hover` before the scripts load.
- **Gallery:**
  - no `h1` on /gallery/ (nor on the imported Home, About, Contact or Donate) — this needs a site-wide accessibility
    pass;
  - the focus ring's radius doesn't match the placeholders' baked corners;
  - a fractional gap at 599/600 px;
  - on phones the gallery is as wide as Articles (330 px at 390), while the Classes cards keep a 16 px inset (298 px).
- **Contact:**
  - the outline pill doesn't lift on hover like the turquoise one;
  - there is no flex `gap` before Safari 14.1, so the pills touch;
  - the map links don't reuse the external-link icon;
  - "Find us in Bet Shemesh" versus the card's "Beit Shemesh, Israel" (owner's call).
- **No-JS footer:** without JavaScript the footer may render a lighter blue. Seen once, not investigated.

## Declined by the final review (not judged)

These were out of the final review's reach and remain open questions:
- the same-zone subrequest;
- the 26 Shorts;
- 375 px thumbnails;
- turquoise contrast (open decision 3);
- an RSVP retry after more than 300 s (since Group 6, a retry with the same requestId is how an RSVP whose attempt
  stopped gets booked again, within 30 s; a retry after 300 s most likely fails its Turnstile check and starts a new
  RSVP, so the stopped attempt's row would keep its seats, as in "Worker and RSVPs" above);
- the 24 h form;
- the live Cloudflare and Resend state;
- the broadcast unsubscribe (open decision 6).

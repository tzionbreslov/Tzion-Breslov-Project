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
  Group 9 (later on 2026-11-08) saw timeouts like it in both of its full local runs: 6 and then 3 desktop or mobile
  tests timed out, different ones each time, each in a `goto`, a click's navigation or a wait for a still element.
  All passed when re-run. In one trace, about 20 requests to the local static server (`scripts/serve-out.mjs` on port
  3100: Next's chunks, the theme's CSS, jQuery, GSAP) got no answer for the test's last 40 s, so `load` never fired.
  It isn't proven to be the same stall: those runs also had Group 9's 50 new tests, among them long resize proofs
  (since marked `test.slow()`). After that, one full run went green, and one run without the resize proofs had 2
  `goto` timeouts in tests Group 9 didn't change (both passed alone). Not proven further; CI stays steady.

## Code

- **`compose.ts` hard-codes `SITE_NAME`** ("Tzion Breslov"). Checked. Left as it is (2026-11-08): no copy or site
  config holds the name. The only other copy is the Worker's `ORGANIZATION_NAME` in `wrangler.jsonc`, which the site
  build doesn't read.
- **`scripts/lib/youtube-feed.mjs` (`extractText`) escapes the tag name for a RegExp inline**, a third copy of
  `escapeRegExp` (found 2026-11-08, Group 4). Left as it is: it is a dependency-free parser for `sync:youtube`, and
  sharing the helper would make it import `config/site-structure.mjs` (and `site-url.mjs`) for one line.

## Events and calendar

- **Floating times in a UTC calendar are read as Israel time.**
- **Without JavaScript, a card whose event started after the build still says "To RSVP, email us…".** Since Group 9
  (2026-11-08) a card the build marked as started (`data-started`) shows neither the button nor the line, with or
  without JavaScript; an event that starts between two builds can't be known without JavaScript.
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
  most 22 D1 queries however other attempts race it, inside Workers Free's 50. That bound assumes the isolates'
  clocks agree: skew can add a read per racing attempt, in theory about 33 queries, as the email's rate limit caps
  the attempts; still well under 50.)
- **One deadline per RSVP request** (controller's ruling): the check before the reservation and its 3 rounds share
  one deadline, 30 s and 1 ms after the request began waiting. A row stamped no later than that moment is stale by
  the deadline, so a retry of a stopped attempt still books that row in the same call. But a row that another attempt with the same requestId took after
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
- **Menu: on iOS, a sticky `:hover` before the scripts load.** Left as it is by Group 7 (2026-11-08): a
  `@media (hover: hover)` guard on the no-JS `:hover` rule keeps the keyboard path (`:focus-within`), but iPad Safari
  doesn't focus a tapped `<button>`, so on a 12.9"/13" iPad Pro in landscape (1366 px, the desktop menu) without
  JavaScript the panel could no longer be opened at all. The sticky hover is what opens it there.
- **No `h1`** on the imported Home, About, Contact or Donate — this needs a site-wide accessibility pass (their markup
  is kept for fidelity). The new pages each have one: the hero heading on /gallery/ (Group 7), /events/ and /privacy/
  (Group 9).
- **Gallery:**
  - the focus ring's radius doesn't match the placeholders' baked corners;
  - on phones the gallery is as wide as Articles (330 px at 390), while the Classes cards keep a 16 px inset (298 px).
- **Contact:**
  - "Find us in Bet Shemesh" versus the card's "Beit Shemesh, Israel" (owner's call).
  - The map links' external-link icon is hidden below 390px (Group 7): there a phone's pill has no room for "Open in
    Google Maps" and the icon on one line, so common phone widths (360, 375, 384px) get no new-tab cue on those links.
    Options: let the label wrap to two lines, or use smaller pill type on phones (owner's call).
- **No `inset` before Safari 14.1** (found by Group 9, 2026-11-08; not checked in a real old Safari). The browsers
  that get the flex-gap margins (`@supports not (inset: 0)` in `app/*.css`) also ignore `inset: 0`. Two live pieces
  are placed with it alone: the dialogs' backdrop (`.tz-dialog-overlay` in `app/dialog.css`: the Classes player, the
  Gallery viewer, the RSVP form) and the Classes cards' play overlay (`.tz-vl__play`). There neither would stretch
  over what it should cover (the page, the thumbnail). Left as it is: outside Group 9's brief.
  `top: 0; right: 0; bottom: 0; left: 0` in the same rules would cover it.
- **No-JS footer: "a lighter blue" is the theme's own fade-in, not a defect.** Investigated by Group 7 (2026-11-08):
  the theme fades the whole page in over 1 s (`.site-container { animation: fadein 1s }` in its `style.css`), with or
  without JavaScript, and on the checkpoint-001 build too. During that second the footer's `#003a71` shows lighter
  (for example `#2b5b89` at 0.82 opacity); once it ends, the footer is `#003a71` with JavaScript on and off, on the
  current build and on checkpoint-001. Left as it is (the original theme's behaviour).

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

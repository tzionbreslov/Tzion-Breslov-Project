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
- **Flaky browser test** `e2e/classes.spec.ts:71` [desktop], "Oldest and Most popular reorder the videos".
  - `aria-pressed` stayed "false" once in CI: PR #26, run 42426373302, attempt 1.
  - It passed on re-run, in the push run and locally. Root cause not investigated.
- **`cspViolations` (`e2e/helpers.ts`)** falls back to the console's capped history for a page that wasn't tracked.
  It should throw "call trackPageErrors first". Checked.
- **There is no committed test that proves the CSP-violation filter catches a violation.**
- **`check-wording.mjs --write-baseline`** reads the current tree's `content/routes.json`, not the baseline's
  (`:38`). Checked.
- **The wording check ignores `placeholder` attributes:** the footer's "Email address" and the Contact form fields.
  Checked.
- **Per-text-node wording check.** It compares each text node separately, so splitting or merging an existing text
  node fails loudly. Never "fix" that by regenerating the baseline (`tests/wording/checkpoint-001.json` is never
  regenerated).
- **The `--mask-nav` mask in `visual-diff.mjs` hides containers only.** A descendant with `visibility: visible` would
  still paint.
- **`playwright.config.ts:11`'s 60 s timeout** covers an unexplained local stall. CI is steady. Checked.
- **The nav screenshot generator** (`e2e/navigation.spec.ts:346`) runs in every `npm run check`, which costs about
  14 s. Checked.
- **"Most popular" on /classes/ is untested in practice.** Its e2e is vacuous until the feed carries view counts.
- **Further test gaps:**
  - no committed test of `renderHero`'s image, heading and subheading swaps;
  - no test for the Worker's "read failed" feed-body path;
  - wrangler prints "Missing required secrets" noise in `npm run test:worker`.

## Code

- **`esc()` is copied 7 times** (`lib/events.mjs`, `lib/instagram-feed.ts`, `lib/navigation.mjs`,
  `lib/pages/{classes,gallery,parts}.ts`, `lib/youtube-feed.ts`). Consolidate in phase 2. Checked.
- **The contact address is hard-coded twice:** `lib/events.mjs:92` (`CONTACT_EMAIL`) and `lib/client/config.ts:7`
  (`contactEmail`). Checked.
- **An import cycle:** `lib/content.ts` → registry → pages → `parts`/`compose` → `lib/content.ts`. It is a TDZ risk
  if a page module ever adds top-level calls.
- **`siteRoutes`** silently ignores a `NEW_ROUTES` path that collides with `routes.json`. None collide today.
- **Hard-coded values:**
  - `compose.ts` hard-codes `SITE_NAME` (checked);
  - `structure.test.mjs` pins the exact `NEW_ROUTES` and `REMOVED_PATHS`;
  - the dialog's 220 ms close is in both `lib/client/dialog.ts` (`EXIT_MS`) and `app/dialog.css`.
- **`compose.ts` and `parts.ts` edge cases:**
  - `compose.ts`'s head guard only fires when no Resources-own head tag exists;
  - `parts.ts`'s `replaceOnce` drops the caller's regex flags.

## Events and calendar

- **The tag stripper eats text.** It deletes everything between a literal `<` and `>` in plain-text descriptions,
  e.g. "kids <10, adults >18" (`scripts/lib/google-calendar.mjs:52`). Checked.
- **"No RSVP" plus a limit gives a contradictory record.**
- **Floating times in a UTC calendar are read as Israel time.**
- **`formatEventWhen` reads "Israel time" from the module-level `en.json`.** Phase-2 translation needs a copy
  parameter there.
- **Without JavaScript, a started event's card also says "To RSVP, email us…".** The static page can't know that the
  event has started.
- **The RSVP button moves the page on load.** When JavaScript loads, a started event's card drops its RSVP button,
  which moves the content below by about 72 px. This was already the case before the fix wave.
- **If an island fails to start**, its RSVP button and announcements form stay hidden, with no email line. This is
  the trade Ruling R13 asks for.

## Worker and RSVPs

- **`/v1/rsvp/availability` has no throttle or edge cache.** See open decision 14 in `PROJECT_MEMORY.md`.
- **The feed body is read before the size check** when there is no `Content-Length` (it is the site's own origin).
- **The guest email carries a visitor-typed name** to an address that isn't verified. Turnstile and the limits
  mitigate this.
- **Four parties of 12 fill a 40-seat event.** There is no cancel tool; use the D1 console.
- **A replay after the event starts returns `EVENT_CLOSED`**, even if the first attempt booked.
- **A concurrent request with the same `requestId` cancels the other one.** The client disabling its button
  mitigates this.
- **`rsvpConfirmationId` doesn't check the salt length itself.**
- **The client keeps its `requestId` after a 5xx, even if the fields change.** Resend answers 409 and the Worker 502
  until the dialog is reopened.
- **The smoke script can fail once after a redeploy**, inside the Worker's 60 s feed cache. It also doesn't check
  `availability.ok`.
- **Gaps in RSVP retention:**
  - nothing bounds RSVP retention while the calendar feed is down; the only signal is a 7-day log line;
  - all-day events end at UTC midnight, which is too early in zones more than 3 h west of UTC (not Israel);
  - after a Worker rollback, someone must run the dated DELETE by hand every day (README → Switch day, step 4's
    undo);
  - an event moved later loses its RSVPs at its old end; the organizer still has them by email.

## Look and feel (owner-visible)

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
- an RSVP retry after more than 300 s;
- the 24 h form;
- the live Cloudflare and Resend state;
- the broadcast unsubscribe (open decision 6).

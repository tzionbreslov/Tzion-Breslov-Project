# Project memory — Tzion Breslov website

## Decisions (owner-confirmed)

- 2026-11-05 — Rebuild tzionbreslov.com (WordPress 7.1.4, Genesis + `tzionbreslov` child theme, Spectra, Gravity
  Forms, Yoast, Smash Balloon YouTube feed) as an **exact** Next.js copy, using the Ruach Breslov project as the
  template: GitHub Pages + Cloudflare (DNS + forms Worker). A Go version was considered and dropped.
- 2026-11-05 — Donate page: replace the Gravity Forms/PayPal form with a better donation chooser built from the same
  options ($100/$150/$300/$600/other, monthly/one-time, dedication, name, email). **PayPal is wired later.**
- 2026-11-05 — Contact + newsletter forms use the Ruach-style Cloudflare Worker (D1 + Turnstile + Resend, double
  opt-in) instead of Gravity Forms/Mailchimp — at `api.tzionbreslov.org` since the .org decision (2026-11-06).
- 2026-11-05 — GitHub repo: `tzionbreslov/Tzion-Breslov-Project` (public). Only approved collaborators may change it.
- 2026-11-06 — **tzionbreslov.org** bought on Cloudflare Registrar (account tzionbreslovproject@gmail.com, zone
  a38137f548dead44f7178034ced45e15). It is the site's future home. **For now .org (+www) 302-redirects to
  tzionbreslov.com** (WordPress) until the owner is ready to switch; apex will be primary (www redirects to it).
- 2026-11-06 — Owner chose: security hardening (headers, CSP report-only first, HSTS later), forms backend on Cloudflare
  (api.tzionbreslov.org), email anti-spoofing (SPF -all, DMARC reject). Not chosen: Email Routing/forwarding.
- 2026-11-06 — main requires a PR with passing CI ("check"); force-push/deletion blocked. Applied from the owner account
  (ruleset "Protect main", admin role may bypass) and proven: an unreviewed push and a force-push were both rejected (GH013).
- 2026-11-06 — Instagram: owner wants a 4th Resources tab ("same idea as YouTube") with an in-site preview that leads
  to instagram.com; data via **Meta's official API** at build time. Account access pending ("waiting for full access");
  unknown whether it is Business/Creator or still posted to (44 posts; newest possibly Aug 2023, unverified).
- 2026-11-06 — **Owner rule: don't change any wording currently on the website.** New pages reuse existing wording where
  they say the same thing (Classes/Articles open with the Resources header); only removed pages lose text.
- 2026-11-06 — **Owner rule: a real checkpoint with every change.** Each merge into main is tagged `checkpoint-NNN`
  (workflow "Checkpoint") with a Release; ruleset "Protect checkpoints" (id 26672363, owner may bypass) blocks moving or
  deleting them (proven: a collaborator delete and a force-move were both rejected). The github-pages environment also
  accepts `checkpoint-*` tags, so a checkpoint can be redeployed right away. `checkpoint-001` = main at 071cdf6, before
  the site-structure work. Rollback for good: `npm run rollback -- checkpoint-NNN` (ROLLBACK.md).
- 2026-11-06 — Site structure design approved (docs/superpowers/specs/2026-11-06-site-structure-design.md); phase 1 =
  everything except translations, which come last.
- 2026-11-06 — Dependabot: TypeScript 7 ignored (typescript-eslint 8 supports TS < 7 only); revisit later.
- 2026-11-06 — Calendar refresh only twice daily, morning and night (owner): the deploy rebuilds around 07:00 and 21:00
  Israel time (cron 07:05 and 21:05 Asia/Jerusalem, off the hour; the times are the spec's call), replacing the
  daily 04:41 UTC rebuild. Events come from one public
  Google Calendar (`GOOGLE_CALENDAR_ICAL_URL`, a repository variable the owner sets: docs/EVENT_CALENDAR.md).

## Cloudflare state (2026-11-06)

- DNS: proxied placeholders A 192.0.2.1 / AAAA 100:: / www CNAME apex; TXT SPF + _dmarc.
- Rules: single redirect "tzion_org_to_com_temporary" (302); response header transform "tzion_security_headers".
- Settings: always_use_https on, min TLS 1.2, SSL strict, DNSSEC on (Registrar publishes DS automatically).
- Configuration rule "tzion_github_pages_origin_ssl_full": SSL Full for tzionbreslov.org + www (GitHub can't renew its
  certificate while proxied; strict would 526). Zone default stays strict.
- Resend DNS (verified 2026-11-06): TXT resend._domainkey, MX + TXT on send, CNAME rsend (DNS only).
- Worker tzion-breslov-api deployed 2026-11-06 → custom domain api.tzionbreslov.org, cron 17 3 * * *, 8 secrets
  (TURNSTILE_SECRET_KEY only in Cloudflare). Account workers.dev subdomain "tzionbreslov" created (required for cron);
  the Worker itself is not on workers.dev.
- D1 tzion-breslov-production 430c5c20-673d-4e3f-b186-18c8c00cbcd8 (0001 applied via API and recorded in d1_migrations).
- Turnstile "Tzion Breslov forms" site key 0x4AAAAAAF1kfPJ0qES50FAh (secret only in Cloudflare).
- Live WordPress bug found: the 18 Parasha posts' hero image points at the dead staging host tzionbreslov.estiwolo.com
  (404 on live). The rebuild serves the local copy instead (intentional difference from live).

## Status

- All 56 WordPress URLs + 404 + `/about/` redirect were exported. Visual diff vs the WordPress reference: 0.00–0.02% on
  every template at 1440px and 390px; Resources was 0.00% vs the live site (local WordPress feed cache is stale).
- Site structure, Task 4 (2026-11-06): the pages the owner asked to remove are gone — `/resources/` (+ pages 2, 3), the
  27 `/video/video-N/` clips, the `/category/` and `/author/` archives and the `/about/` forwarding page serve the 404
  page (edge redirects come on switch day). The site serves the 22 kept imported pages + 404, plus `/classes/` and
  `/articles/` (+ page 2). Menus (Home · About · Resources ▾ Classes, Articles · Contact) come from `lib/navigation.mjs`.
- Site structure, Task 5 (2026-11-06): `/gallery/` (menu item before Contact) shows the photos in `public/media/gallery`
  (7 placeholders from the old site until the owner sends real ones: adding a photo = adding a file) with an on-page
  viewer. Between 1280 and 1439px the menu links have 10px side padding (not 15px) so the logo stays centred
  (superseded in Task 7).
- Site structure, Task 6 (2026-11-06): the Contact page has a Google map pinned on "Bet Shemesh, Israel" (owner) under
  the form and the three cards, with "Get directions" and "Open in Google Maps" links (`lib/pages/contact-map.ts`); the
  rest of the page is unchanged. CSP frame-src now allows `https://www.google.com`: the Cloudflare rule
  `tzion_security_headers` must gain it on switch day (owner go-ahead).
- Site structure, Task 7 (2026-11-06): `/events/` (menu item before Gallery) lists the upcoming events of the Google
  Calendar, read at every deploy into `content/events.json` (Actions cache, never committed; git keeps the empty
  default, so until `GOOGLE_CALENDAR_ICAL_URL` is set it says "No events are currently scheduled"), and publishes them
  as `/events.json` for the Worker's RSVPs (Task 8). "No RSVP" / "RSVP limit: 40" lines in a description set an
  event's RSVPs. With six menu items the desktop menu links have 17px text and 8px side padding from 1340 to 1919px,
  6px below 1340px (18px and 15px from 1920px, as before), so the logo stays centred with ≥12px around it.
- Site structure, Task 8 (2026-11-06, built and tested, **not deployed**): RSVPs on `/events/` (button per event, hidden
  once it starts, "This event is full" from `GET /v1/rsvp/availability`, the form in the site's dialog) and a "Get event
  announcements" signup (lists: Event announcements, Newsletter → `topics` on `/v1/subscribe`). The Worker reads the
  site's `/events.json` (`EVENTS_FEED_URL`, no redirects followed) and reserves seats in one SQL statement; RSVPs never
  touch `request_log`. Migration 0002 (additive), secret `RESEND_EVENTS_TOPIC_ID` (9 secrets), the Resend topic and
  the Worker deploy wait for switch day (README → Switch day, steps 1–4, each with its undo). RSVPs deleted once the
  event is over — owner decision 2026-11-07 (Task 10b).
- Site structure, Task 9 (2026-11-07): `/privacy/`, the privacy notice ("Last updated November 7, 2026"), linked last in
  the footer Quick Links (footer only) and from "privacy notice" in the RSVP and "Get event announcements" consent
  lines. Its text describes the site as built, checked against the code and a network capture of every page (e.g. the
  Classes thumbnails come from i.ytimg.com when the page opens, the Contact map loads with the page, Turnstile loads on
  every page once the forms are on). **The owner reads and approves the text before launch**; RSVPs deleted once the
  event is over — owner decision 2026-11-07 (Task 10b).
- Site structure, Task 10 (2026-11-07): the Donate form has a "Manage your monthly donation" link right under "How
  often would you like to donate?", always shown, with the note "Already giving monthly through PayPal? Change or
  cancel it in your PayPal account." (content/copy/en.json `donate`). It opens PayPal's automatic payments page
  (`PAYPAL_AUTOPAY_URL` = https://www.paypal.com/myaccount/autopay/) in a new tab. **The URL is pending the owner's
  confirmation**; the rest of the form is unchanged.
- Site structure, Task 10b (2026-11-07, owner decision; built and tested, **not deployed**): RSVPs deleted once the
  event is over. Each RSVP stores its event's end (`rsvps.event_ends_at`, from `/events.json` `endsAt`; an all-day
  event ends at the UTC midnight of its exclusive end date). The Worker's daily cleanup (cron 03:17 UTC) first reads
  `/events.json` and gives the RSVPs of every listed event its current end (Ruling R44: a moved event keeps its id
  and so its RSVPs until its new end; an event no longer listed keeps its stored end), then deletes the RSVPs whose
  end has passed, normally within a day. A day `/events.json` can't be read logs `RSVP_CLEANUP_FEED_UNAVAILABLE` and
  deletes only the RSVPs whose stored end is more than 7 days past (follow-up Group 6, 2026-11-08; before, it
  deleted none, so nothing bounded retention while the feed was down). The old 90-day Worker var is removed. Migration 0002 was edited in place (only
  ever applied to local D1s, which must be re-created: move `.wrangler/state/v3/d1` aside and run
  `npm run db:migrate:local`). The privacy notice's RSVP sentence says "normally within a day" (its date stays
  November 7, 2026); the owner still approves the full text before launch. RSVP emails already in the organizer's
  inbox are not affected.
- Follow-up Group 6 (2026-11-08, built and tested, **not deployed**; it ships with the RSVP release, switch day step 4):
  - `EVENT_FULL` carries `remaining`, the places left as the refused reservation saw them; the site's "only N places
    are left" uses it and no longer reads availability again.
  - `GET /v1/rsvp/availability` is shared for 30 s through the Cache API (per Cloudflare data center), and browsers
    keep it 30 s (was 60). The Cloudflare rate-limit rule is still open decision 14.
  - A replay (same requestId) of a booked RSVP answers its confirmation before any event check, so also once the
    event has started or while `/events.json` can't be read.
  - Migration 0002 was edited in place again (`rsvps.confirmed_at`; only ever applied to local D1s, which must be
    re-created). An RSVP is confirmed once the guest's email has gone out. A second request with the same requestId
    waits for the first one's outcome instead of answering 202 at once. An attempt confirms or gives back only the
    row it holds. Its emails and confirmation run under `waitUntil`, so a visitor's dropped connection doesn't cut
    them off, and each Resend call gives up after 10 s. A row still unconfirmed after 30 s was left by an attempt
    that stopped anyway: the site's retry (same requestId and token) waits for it to turn 30 s old, then books it
    again in that one call, with the same email keys. A failed confirmation is logged (`RSVP_CONFIRM_FAILED`) and the
    organizer is still emailed. (Review fix round 1 of PR #33; the 10 s and 30 s values are the implementer's, not
    the brief's.) While it waits, a request reads the row again after 200 ms, then after waits that double up to
    4 s, never past the moment the row turns stale: 12 D1 reads for a full 30 s wait (about 150 at the earlier
    200 ms poll). The check before the reservation and its 3 rounds share one 30 s deadline and that backoff, so one
    request makes at most 22 D1 queries however other attempts race it (barring clock skew between isolates, which
    can add a read per racing attempt: in theory about 33, as the email's rate limit caps the attempts; still well
    under 50), and the wait doesn't depend on the Workers plan (Workers Free allows 50 D1 queries per invocation).
    The deadline is 30 s and 1 ms, so a row there when the request began waiting is stale by it. A row another
    attempt took after the request began waiting, still unconfirmed at the deadline, answers `REQUEST_IN_PROGRESS`;
    the site's retry books it once stale. The backoff and the shared deadline are the controller's rulings
    (2026-11-08).
  - With the feed down, the daily clean-up deletes RSVPs whose stored end is more than 7 days past (before: none).
  - The RSVP dialog takes a new requestId when a retry changes its details.
  - `scripts/check-rsvp-availability.mjs` checks `ok` and retries for 2 minutes while events are missing.
  - `npm run test:worker` no longer reads a local `.dev.vars` (no "Missing required secrets" noise).
- Follow-up Group 7 (2026-11-08): small layout and accessibility fixes on the new pages, no new wording.
  - Classes: below 375px (zoomed fractional widths too) the channel header is smaller (56px logo, 12px handle line,
    10.5px channel button), so the handle stays beside the logo and "Visit our YouTube channel" on one line down to
    320px; from 375px it is unchanged.
    The empty-search message is a live region that is always on the page; only its text changes.
  - Menu: only keyboard focus inside the Resources panel (or a click on its button) keeps it open after the mouse
    leaves; a mouse press on a link inside it no longer does.
  - Gallery: the hero heading is the page's h1 (it looks as before); its 600px layout switch has no gap at fractional
    (zoomed) widths.
  - Contact map: the outline pill lifts on hover and focus like the turquoise one (not with reduced motion); both
    links end with the Classes channel link's external-link icon from 390px (below that a phone's pill has no room
    for it), so the pills fit on one row from 722px (was 668px); margins replace the flex gaps in Safari before 14.1.
  - Left: the iOS sticky `:hover` before the scripts load, the no-JS footer's "lighter blue" (the theme's 1 s
    fade-in), and the map links' icon below 390px (owner's call): `docs/superpowers/follow-ups.md`.
- Follow-up Group 9 (2026-11-08): the last new-page fixes that need no owner decision, no new wording.
  - Events and Privacy: the hero heading is the page's h1 (it looks as before), as on Gallery. The imported Home,
    About, Contact and Donate still have none (fidelity).
  - Events without JavaScript: a card the build marked as started shows neither the RSVP button nor "To RSVP, email
    us…" (as with JavaScript). A card whose event starts between two builds still shows the line.
  - Safari before 14.1 (no flex gap): margins replace the gaps in the other new pieces too, under the Contact map's
    `@supports not (inset: 0)`: the Classes channel button, tabs, search box and sort pills; the Events cards' icons,
    the checkboxes (signup and RSVP form) and the signup's lists; the subscription notices; the Donate frequency and
    other-amount rows; the Gallery viewer's caption; and the Resources menu toggle's caret. Each spec applies the
    fallback in Chromium and compares every box (`expectGapFallbackLayout`, `e2e/helpers.ts`).
  - Found and left: the dialogs' backdrop and the Classes play overlay also rely on `inset`
    (`docs/superpowers/follow-ups.md`).
- **Site structure phase 1 is complete on the preview** (2026-11-07, Task 11). Everything in the design except
  translations is merged and live on the github.io preview. The live-service steps wait for the owner: README →
  Switch day is the one ordered runbook (pre-checks, D1 migration 0002, the Resend topic + secret, the Worker deploy,
  the CSP rule, the redirect rules, the edge privacy check, the calendar variable, go-live, forms on, smoke test), each
  step with its commands, verification and undo. Checkpoints:
  - checkpoint-004 (#14) — wording check, browser tests, checkpoint comparison (Task 1)
  - checkpoint-005 (#15) — structure layer, composed pages, the Articles page (Task 2)
  - checkpoint-006 (#16) — the Classes page: Ruach's video library in Tzion's look (Task 3)
  - checkpoint-007 (#17) — Home and the Resources dropdown, old pages removed, everything relinked (Task 4)
  - checkpoint-008 (#18) — the Gallery page and its viewer (Task 5)
  - checkpoint-009 (#19) — the map on the Contact page (Task 6)
  - checkpoint-010 (#20) — the Events page, rebuilt twice a day from Google Calendar (Task 7)
  - checkpoint-011 (#21) — RSVPs and "Event announcements", built and tested, not deployed (Task 8)
  - checkpoint-012 (#22) — the privacy notice `/privacy/` (Task 9)
  - checkpoint-013 (#23) — Donate: "Manage your monthly donation" (Task 10)
  - checkpoint-014 (#24) — RSVPs deleted once the event is over, not deployed (Task 10b)
  - checkpoint-015 (#25) — the switch-day runbook, every step with its undo; phase 1 verified (Task 11)
  - checkpoint-016 (#26) — final-review fixes: calendar text can't fail the deploy, no-JS Events controls, the
    "places left" message, og:image on the new pages, runbook corrections
  - Parked review items that are still open: `docs/superpowers/follow-ups.md`.
- **Follow-ups (2026-11-08; the owner asked to "fix everything we can in advance").** Checkpoints:
  - checkpoint-017 (#27) — phase 1's parked review items recorded in `docs/superpowers/follow-ups.md`; a switch-day
    prerequisite (step 3.1: don't restore a stale `.env.worker.bak`)
  - checkpoint-018 (#28) — switch-day runbook: a stale backup can't come back; redirects catch addresses without the
    slash (Group 1)
  - checkpoint-019 (#29) — static-export check: old-domain links in event cards, and the guard's other gaps (Group 2)
  - checkpoint-020 (#30) — tests: the Classes sort test steadied; tighter wording, visual and CSP checks (Group 3)
  - checkpoint-021 (#31) — tidy-up: one HTML-escape helper, one contact address, no import cycle (Group 4)
  - checkpoint-022 (#32) — Events: "<" and ">" kept in calendar text, contradictory RSVP settings flagged (Group 5)
  - checkpoint-023 (#34) — tests: the Articles pagination link settles before the desktop click (split out of
    Group 6's pull request)
  - checkpoint-024 (#33) — Worker: RSVP replays, races and retention hardening (Group 6). **Not deployed:** it ships
    with the RSVP release at switch day, step 4.
  - checkpoint-025 (#35) — new pages: small layout and accessibility fixes (Group 7)
  - checkpoint-026 (#36) — dependencies: minimatch 11.0.1 for the eslint toolchain, Dependabot alert 1 (Group 8)
  - checkpoint-027 (#37) — new pages: h1 on Events and Privacy, old-Safari spacing, no RSVP line on started events
    (Group 9)
  - Group 9b (`inset: 0` written out for Safari before 14.1) opened no pull request: the build folds the four sides
    back into `inset:0`. The item stays open in `docs/superpowers/follow-ups.md`, with the two ways to fix it.
  - What is still open: `docs/superpowers/follow-ups.md`.
- **Final verification** (2026-11-07, Task 11, on main at 38f5132 = checkpoint-014):
  - `npm run check` is green:
    - typecheck, Worker typecheck and lint are clean;
    - unit tests 107/107 and Worker tests 71/71 pass;
    - the build exports 30 static pages;
    - the static-export check passes: 28 routes, 0 redirects, every local reference resolves;
    - the wording check passes: 23 pages still say everything they said at checkpoint-001;
    - browser tests: 187 passed, 73 skipped of 260. The skips are by design: each project's desktop- or mobile-only
      tests, and the RSVP fixture variants, which CI runs in its own steps.
  - `node scripts/check-csp.mjs`: "CSP OK: 29 pages + interactions, zero violations".
  - Masked visual diff of every pre-existing page (the 22 kept imported pages + the 404) against the checkpoint-001
    build, at 1440 and 390:
    - 0.00% everywhere except /about-us/ (0.03% at 1440);
    - the two intended exceptions: /contact/ at 0.09% / 0.04%, confined to the new map section, and /donate/ at
      7.82% / 1.90%, the manage link, the same as at Task 10.
  - The new pages, checked by hand at 1440, 1280, 768 and 390 against the spec's goals 1–9: all met on the preview.
    The live parts (the redirects, the RSVP Worker, the CSP rule) are switch-day steps.
    1. Navigation: Home · About · Resources ▾ (Classes, Articles) · Events · Gallery · Contact + Taste A Class /
       Donate on desktop (dropdown at 1440 and 1280); the same items in the mobile menu (768, 390); the footer Quick
       Links mirror them and end with Privacy.
    2. Classes: Videos/Shorts, search, Latest/Most popular/Oldest, the on-page player, "Visit our YouTube channel",
       15 + 26 = 41 videos. Three thumbnails across from 768px; at 1440 each is 375×211, the old Classes tab's size.
       The page ends with the three closing sections.
    3. Articles: the 18 Parasha articles, 9 per page with in-place pagination, titles unchanged.
    4. Old pages: the 35 removed addresses serve the 404 page and nothing links to them. The 301s come at switch day,
       step 6.
    5. Gallery: 7 photos (4 photos + 3 collages) and the viewer (counter, previous/next, keys, swipe).
    6. Events: the empty state today (no calendar yet). A fixture build shows the cards: the "No RSVP" event has no
       button, and an RSVP on the preview says "RSVPs open when the new site launches…".
    7. Privacy: `/privacy/`, "Last updated November 7, 2026", six sections, linked from the footer and both consent
       lines.
    8. Map: "Find us in Bet Shemesh" with the Google map, "Get directions" and "Open in Google Maps".
    9. Donate: "Manage your monthly donation" → https://www.paypal.com/myaccount/autopay/ in a new tab.
- WordPress reference content verified identical to live (text, images, links) on all 57 pages
  (`scripts/compare-live.mjs`).
- Worker: 93 tests pass (`npm run test:worker` on 2026-11-08 at checkpoint-027 reports "93 passed (93)"; the
  undeployed RSVP release and Group 6 included; 34 when it was first deployed). Deployed and smoke-tested live
  (health/D1, CORS, Turnstile, confirm redirect, webhook signature). A real email has not been sent yet (needs a
  Turnstile token from tzionbreslov.org, i.e. switch day).
- Resend (owner's account): domain tzionbreslov.org verified; topic "Newsletter" 934b4bcd-a4a7-43ce-9310-8fac1cc4541c
  (default opt-out); webhook 3ade2dad-e974-4e65-ad11-4c3db16a9677; send-only key 82913060-a568-4518-8a2b-bef4f36255f5.
- GitHub: Pages preview live at https://tzionbreslov.github.io/Tzion-Breslov-Project/ (rebuilds around 07:00 and 21:00 Israel time);
  Actions limited to GitHub-owned actions, read-only token, outside-contributor workflows need approval; wiki/projects
  off; secret scanning + push protection, Dependabot alerts/updates, private vulnerability reporting on.
- Dependencies (2026-11-08): `package.json` `overrides` pins `minimatch` to exactly 11.0.1 under `eslint`,
  `@eslint/config-array` and `@typescript-eslint/typescript-estree` (Dependabot alert 1, GHSA-g3hv-75wg-m249,
  development only; their releases still declare `^10`). Drop the override once they depend on minimatch ≥ 11.0.1,
  and before any eslint upgrade that needs a newer minimatch major.
- Instagram switched off with the Resources page (owner, 2026-11-06): no tab and no link (the footer icon stays). The
  sync script and tests stay dormant (`INSTAGRAM_ENABLED=false`; the deploy no longer syncs or caches the feed); turning
  it back on needs INSTAGRAM_ACCESS_TOKEN (secret) and INSTAGRAM_USER_ID / INSTAGRAM_API_VERSION (variables):
  docs/instagram-setup.md.
  The emailed confirmation link (GET) only redirects to the site (`?subscription=confirm#token=…`); the visitor's
  "Confirm my subscription" click POSTs the token (mail scanners can't confirm). Confirmation emails reply to
  `RESEND_REPLY_TO_EMAIL` (tzionbreslovproject@gmail.com) because tzionbreslov.org has no MX by choice.
- Known pre-existing theme bug kept for fidelity: `global.js` number counter throws on pages without `.numbers`
  (also on the live site).

## Owner decisions still open

1. **Privacy text:** read and approve `/privacy/` before launch, i.e. before switch day, step 10. Approve with it the
   four new sentences on Events (`content/copy/en.json`):
   - "To RSVP, email us at tzionbreslovproject@gmail.com." (no JavaScript)
   - "To get event announcements, email us at tzionbreslovproject@gmail.com." (no JavaScript)
   - "Sorry — only {remaining} places are left. Lower the number of guests, or email us at
     tzionbreslovproject@gmail.com."
   - "Sorry — only 1 place is left. Lower the number of guests, or email us at tzionbreslovproject@gmail.com."
2. **PayPal autopay URL:** confirm that `https://www.paypal.com/myaccount/autopay/` (`PAYPAL_AUTOPAY_URL`) is where
   monthly donors manage their gift.
3. **Turquoise contrast:** white text on turquoise pills and turquoise hover text fail WCAG AA. Keep the look, or
   darken turquoise for text and pills.
4. **Email retention:** how long contact and RSVP emails stay in the Gmail inbox and in Resend's email logs. The
   notice doesn't state it.
5. **NEL / Report-To on .org:** Cloudflare already sends them. Turn them off, or disclose them in the notice (switch
   day, step 7).
6. **Broadcasts:** every hand-sent Resend broadcast needs an unsubscribe link.
7. **Gallery:**
   - the page description "Photos from Tzion Breslov classes and gatherings." is new copy;
   - collage 1 repeats photo 2;
   - the photos are placeholders, to be replaced.
8. **Switch day and go-live timing:** after the conversation with the Rabbi (README → Switch day, step 9 only on the
   owner's word).
9. **Instagram:** off until access is available (docs/instagram-setup.md).
10. **Translations (phase 2):** come next, with their own design.
11. **RSVP dialog privacy link:** "privacy notice" in the RSVP dialog opens in the same tab, so a visitor who follows
    it loses what they typed.
12. **Manage-donation link:** it opens PayPal in a new tab with no cue that it does.
13. **Live Worker logging: answered** (2026-11-08). The question was whether `tzion-breslov-api`, deployed on
    2026-11-06 without an `observability` block, stores invocation logs (request URLs with confirmation tokens,
    headers, IPs). The controller checked it read-only, with Cloudflare API GETs and Workers Observability queries;
    nothing was changed.
    - The Worker's script settings had `observability: null`, `logpush: false` and no tail consumers.
    - The Workers Observability dataset had no events from any Worker in the previous 7 days, although the live
      Worker runs a daily cron.
    - So Workers Logs stored nothing for this Worker, invocation logs included.
    - Switch day, step 4's deploy **starts** storing the Worker's own log lines (codes such as
      `RSVP_CONFIRM_FAILED`). `wrangler.jsonc` sets
      `"observability": { "enabled": true, "redact_query_string": true, "logs": { "invocation_logs": false } }`, so
      no per-request invocation records are stored. Step 4's log-probe check checks whether a stored line carries
      request fields; if one does, step 4 turns Workers Logs off (`"enabled": false`).
    - The privacy notice already covers those lines: "error records from the forms service, designed to contain no
      personal details, for up to 7 days" (`content/copy/en.json` → privacy). So no new owner decision arises.
    - README → Switch day, step 1.3 still checks the dashboard on the day, since the setting can change before then.
14. **Rate limit on RSVP availability (after go-live):** the final review recommends a Cloudflare rate-limiting rule
    on `api.tzionbreslov.org/v1/rsvp/availability`, which anyone can call and which reads D1 whenever its shared
    30 s answer (per Cloudflare data center, since 2026-11-08) has expired.
    Nothing is set up; the owner decides after go-live.

## Local reference setup notes

- `.wpress` extracted with a small Node script (4377-byte headers per file; skip empty-name directory entries).
- Import needs `SET NAMES utf8mb4` (dump has none → mojibake), relaxed `sql_mode` (zero dates),
  `SERVMASK_PREFIX_` → `wp_`. All plugins and the theme are inactive in the dump and must be activated.
- Footer "Quick Links" is a `legacy-widget` block signed with the live salts → re-sign locally
  (`tools/wordpress-reference/resign-legacy-widgets.php`) or it silently renders nothing.
- Copy wp-content into the container (bind mounts on Docker Desktop made each page ~20 s).

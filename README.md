# Tzion Breslov website

A static Next.js rebuild of [tzionbreslov.com](https://tzionbreslov.com), migrated off WordPress. Every page is a
pixel-for-pixel copy of the WordPress site (verified with `scripts/visual-diff.mjs`); the only intentional change is a
new donation form. Same stack as Ruach Breslov: **GitHub Pages** for the site, **Cloudflare** for DNS/TLS and a
**Worker** (`worker/`) for the contact and newsletter forms.

## How it works

```
WordPress backup (.wpress, private, not in git)
  └─ tools/wordpress-reference   Docker copy of the old site at http://localhost:8088
       └─ scripts/crawl-wordpress.mjs   → ../golden (raw HTML + assets snapshot)
            └─ scripts/import-wordpress.mjs → content/ + public/   ← committed
                 └─ next build (output: export) → out/ → GitHub Pages
```

- `content/pages/*.json` — one file per URL: head tags, body classes, page HTML, scripts.
- `content/fragments/`, `content/styles/`, `content/scripts/` — shared header/footer HTML and de-duplicated inline CSS/JS.
- `public/wp-content`, `public/wp-includes` — only the images, CSS and JS the pages actually reference.
- `config/site-structure.mjs` — the site's structure on top of the import: pages composed in code (`NEW_ROUTES`, keys
  `tz:…`), imported pages that are removed (`REMOVED_PATHS`, plus everything under `REMOVED_SECTIONS`: `/resources/`,
  the 27 `/video/video-N/` clips, the `/category/` and `/author/` archives and the `/about/` forwarding page), link
  rewrites (`LINK_REWRITES`: `/resources/` → `/classes/`, `/about/` → `/about-us/`) and the Yoast sitemaps that are no
  longer published. Next (`lib/content.ts`), the export and CSP checks and the browser smoke test take their route list
  from its `siteRoutes()`, so a re-import can't bring a removed page back (and a `NEW_ROUTES` path that is removed, that `routes.json`
  still serves as a page or redirect, or that is listed twice, throws instead of being dropped); the wording check skips `isRemovedPath()`
  pages; `write-site-files.mjs` drops removed pages and sitemaps from the sitemaps and adds the `NEW_ROUTES`; the export
  check fails on any link, sitemap entry or structured-data URL that still points at a removed page, and on any plain
  YouTube embed. It reads double- and single-quoted `href`/`src`, the escaped copies in Next's flight data, paths with
  or without the trailing slash, and the site's origin over http or https, bare or `www.`; after the site-URL switch
  it fails on the same spellings of tzionbreslov.com, Events cards included. Calendar text (the Events cards) never
  fails it. Its matching lives in `scripts/lib/export-guard.mjs`, tested by `scripts/export-guard.test.mjs`.
  `visual-diff.mjs` keeps its own fixed page list.
- `lib/navigation.mjs` — the menus: the header's desktop and mobile menus and the footer Quick Links are rendered into
  the imported header/footer HTML for each page (`NAV`: Home · About · Resources ▾ Classes, Articles · Events ·
  Gallery · Contact, then Donate and Taste a Class in the mobile menu and footer, and Privacy last in the footer
  only; the footer list is in two columns, `app/navigation.css`). `ORIGINAL_NAV` is the WordPress menu, which `scripts/navigation.test.mjs` proves renders every imported
  fragment byte for byte. The Resources dropdown runs on
  `lib/client/menu.ts` (mouse, touch, keyboard; keyboard focus inside it keeps it open after the mouse leaves, a mouse
  press inside it doesn't) and `app/navigation.css` (also opens on hover/focus without JS).
- `lib/pages/` — the composed pages (today `/articles/`, `/articles/page/2/`, `/classes/`, `/gallery/`, `/events/`
  and `/privacy/`), built from Tzion's own markup: `parts.ts` cuts the hero, the Articles grid and the closing sections verbatim out of `content/pages/resources*.json`,
  `compose.ts` wraps them in the Resources page's stylesheets, scripts, header and footer with their own title,
  description and canonical URL, and `registry.ts` maps each `tz:` key to its builder. The pages read `content/`
  through `lib/content-files.ts`, never `lib/content.ts` (which imports them: `scripts/imports.test.mjs`); their string
  edits are in `edits.mjs` (unit-tested). All markup built as strings (these pages, the menus, the feeds, the Events
  list) escapes text with the one `esc()` in `lib/html.mjs`. `contact-map.ts` adds the map
  (Google Maps pinned on Bet Shemesh, with directions) to the imported Contact page, right after its form and cards;
  from 390px its two new-tab links end with the external-link icon in `lib/icons.ts` (drawn by `.tz-icon` in
  `app/enhancements.css`), as the Classes channel link does; below 390px a phone's pill has no room for it.
  Their new English text lives only in `content/copy/en.json`.
- `/privacy/` (`lib/pages/privacy.ts`) — the privacy notice, linked from the footer Quick Links and from the
  "privacy notice" words in the RSVP and "Get event announcements" consent lines. Its text (`content/copy/en.json`
  `privacy`) describes the site as built: the forms and what they collect, the Worker's database and how long it keeps
  each record, and every third party a page contacts (when, and from which host). Change it with the site: a new
  third-party origin, form field or retention period changes the notice too, and its `date` ("Last updated …") is set
  by hand when the text changes, never by the build. The owner reads and approves it before launch.
- `app/[[...slug]]` — one catch-all route renders every page; `app/global-not-found.tsx` is the 404.
- The original theme scripts (jQuery, GSAP animations, Spectra blocks, slick carousel) still run unchanged.
  React only adds the interactive pieces in `components/enhancers.tsx`:
  - the Resources dropdown in the header menus → `lib/client/menu.ts`
  - contact + footer signup forms → `lib/client/forms.ts` → Worker API (`lib/api-contract.ts`)
  - Events page RSVPs (button per event, "This event is full", the RSVP form in `lib/client/dialog.ts`) →
    `lib/client/rsvp.ts`, and its "Get event announcements" signup → `lib/client/announcements.ts`; both send
    through `lib/client/submit.ts` like the other forms
  - Articles post-grid pagination → `lib/client/post-grid.ts` (no admin-ajax)
  - (dormant since the Resources page was removed: its YouTube grid `lib/client/youtube.ts` and Instagram tab
    `lib/client/instagram.ts`)
  - Classes video library (Videos/Shorts tabs, search, sort, on-page player) → `lib/client/video-library.ts` +
    `lib/client/dialog.ts`; ordering/search in `lib/video-library.mjs`, data in `content/youtube.json` (Videos, with
    the feed's view counts for "Most popular") and `content/shorts.json` (the old `/video/video-N/` clips)
  - Gallery photo viewer (whole photo, caption, "3 of 7", previous/next, arrow keys, swipe) → `lib/client/gallery.ts` +
    `lib/client/dialog.ts`; the photos are the files in `public/media/gallery` (see "Gallery photos" below)
  - Donate page → `components/donate-form.tsx` (**PayPal not wired yet** — see `lib/client/donations.ts`). Under the
    frequency choice, "Manage your monthly donation" opens PayPal's automatic payments page (`PAYPAL_AUTOPAY_URL`) in
    a new tab, for donors who already give monthly
- Events page (`lib/pages/events.ts`, cards and the announcements signup from `lib/events.mjs`): the list is rendered
  at build time from the Google Calendar (see "Events" below); only the RSVPs and the signup run in the browser.

URLs are identical to WordPress (trailing slashes, `/wp-content/uploads/...`), and Yoast's sitemaps and `robots.txt` are
republished at the same paths, minus the removed pages. Removed addresses (`/resources/`, `/video/…`, the archives,
`/about/`) serve the 404 page: no page and no forwarding page is left on the site. After launch the switch-day
Cloudflare redirect rules send them to their new homes.

## Commands

| | |
|---|---|
| `npm run dev` | Next dev server at http://localhost:3000 |
| `npm run build` | Static export to `out/` |
| `node scripts/serve-out.mjs` | Serve `out/` like GitHub Pages at http://localhost:3100 |
| `npm run check` | Typecheck (site + Worker), lint, unit tests (`scripts/**/*.test.mjs`), Worker tests, build, export check, wording and placeholder checks against checkpoint-001, browser tests (Playwright on `out/` with the enforced CSP) |
| `NAV_SCREENSHOTS=1 npx playwright test e2e/navigation.spec.ts -g "screenshots" --project=desktop` | Save the header, footer and open-menu screenshots (1280, 1440 and 390 px) to `test-results/nav/` for a pull request that changes the menus; `npm run check` skips them. In PowerShell: `$env:NAV_SCREENSHOTS = "1"; npx playwright test e2e/navigation.spec.ts -g "screenshots" --project=desktop; Remove-Item Env:NAV_SCREENSHOTS` (the last command unsets the variable again, or every later `npm run check` in that window takes the screenshots too) |
| `npm run sync:instagram` | Dormant (Instagram is switched off): pull the latest Instagram posts + photos (needs `INSTAGRAM_ACCESS_TOKEN` / `INSTAGRAM_USER_ID`; see docs/instagram-setup.md) |
| `npm run sync:youtube` | Pull the latest uploads from the channel RSS feed into `content/youtube.json` (outage-tolerant; `-- --strict` to fail instead) |
| `npm run sync:events` | Pull the upcoming events from the Google Calendar at `GOOGLE_CALENDAR_ICAL_URL` into `content/events.json` (outage-tolerant; `-- --strict` to fail instead; never commit the result) |
| `npm run worker:dev` | Forms API at http://localhost:8787 (copy `.dev.vars.example` → `.dev.vars`) |
| `node scripts/visual-diff.mjs` | Pixel-compare against the WordPress reference (needs it running), or a checkpoint build with `REF=…` (AGENTS.md). `--mask-nav` hides the menus and footer and compares what is above the footer; `--crop-footer` compares everything above the footer, header included |
| `node scripts/compare-live.mjs` | Compare the WordPress reference's text/images/links with the live site |
| `npm run rollback -- checkpoint-NNN` | Open a pull request that rolls every file back to a checkpoint (`--dry-run` to only list what it undoes); see ROLLBACK.md |

## Checkpoints and rollback

Every merge into `main` is tagged `checkpoint-NNN` with a Release listing its changes; checkpoints can't be moved or
deleted. How to roll the preview back right away, or for good: [ROLLBACK.md](ROLLBACK.md).

## Gallery photos

The Gallery shows every `.webp`, `.jpg`, `.jpeg` or `.png` in `public/media/gallery`, whole, at its own shape. To add a
photo, add the file; to remove one, delete it. Optionally give it alt text (what the photo shows, for people who can't
see it) and a place in `public/media/gallery/gallery.json`: `"my-photo.jpg": { "alt": "…", "order": 8 }` (lower
orders first; photos not listed come after them, by file name, with the alt text "Photo from Tzion Breslov"). Every
build lists the folder into `content/gallery.generated.json` (`scripts/write-site-files.mjs`, git-ignored). Today's 7
photos are placeholders from the old site (`scripts/convert-gallery-placeholders.mjs`, a one-time script).

## YouTube feed (Classes page)

Source: the channel's public RSS feed,
`https://www.youtube.com/feeds/videos.xml?channel_id=UC69mDA498p7l9GGBdaUdkkA` (latest 15 uploads, no API key).
The deploy workflow refreshes it at build time and runs twice a day (around 07:00 and 21:00 Israel time), so new uploads
appear within half a day without a commit. Videos that scroll out of the feed's 15-entry window only stay listed if they
are in the committed `content/youtube.json` — run `npm run sync:youtube` and commit occasionally to archive them. YouTube's RSS endpoint is
intermittently unavailable (it returned 404 on 2026-11-06); the sync then keeps the committed list and only warns.

## Events (Google Calendar)

The Events page lists the upcoming events of one public Google Calendar, "Tzion Breslov Events": whoever manages
events only uses the calendar. Every deploy (and the rebuilds around 07:00 and 21:00 Israel time) reads its public iCal
address, the repository variable `GOOGLE_CALENDAR_ICAL_URL`, into `content/events.json`, carried between deploys in
the Actions cache and never committed (git keeps the empty default). Unset, the page says "No events are currently
scheduled". A line "No RSVP" or "RSVP limit: 40" in an event's description controls its RSVPs. The build also
publishes the list as `/events.json` for the forms Worker, which reads it (`EVENTS_FEED_URL`) to take RSVPs
(`POST /v1/rsvp`, `GET /v1/rsvp/availability`). Availability is advisory: the Worker shares one answer for 30 s per
Cloudflare data center (Cache API) and browsers keep it 30 s, while the reservation itself enforces every limit and its
`EVENT_FULL` answer says how many places are left. Each RSVP is deleted once its event is over (owner decision
2026-11-07): it stores the event's end (`rsvps.event_ends_at`). The Worker's daily cleanup first reads `/events.json`
and gives the RSVPs of every event listed there that event's current end, so a moved event (it keeps its id) keeps its
RSVPs until its new end; an event no longer listed keeps the end its RSVPs stored. Then it deletes the RSVPs whose end
has passed, normally within a day. If `/events.json` can't be read, it logs `RSVP_CLEANUP_FEED_UNAVAILABLE` and
that day deletes only the RSVPs whose stored end is more than 7 days past: a moved event's later end can't be seen
then (Ruling R44 keeps a moved event's RSVPs), but no RSVP outlives its event by much more than a week while the feed
is down. The copies already emailed to the organizer's inbox stay there.
The RSVP route, migration 0002 and the "Event announcements" Resend topic are built and tested but **not deployed**:
they go live on switch day (Switch day below, steps 1–4, then step 10 turns the forms on; each step has its
undo). Owner steps and details:
[docs/EVENT_CALENDAR.md](docs/EVENT_CALENDAR.md).

## Instagram (switched off)

An owner-requested addition (WordPress never had it): latest posts from @tzionbreslovproject in a 4th Resources tab,
with an in-site preview that leads to instagram.com, from Meta's official API at build time. **Switched off since the
Resources page was removed (owner, 2026-11-06)**: no tab and no link (the footer's Instagram icon stays), the deploy no
longer syncs it, and `INSTAGRAM_ENABLED` in `config/site-structure.mjs` keeps the importer from adding the tab. The
code and its tests stay, dormant, so it can come back: [docs/instagram-setup.md](docs/instagram-setup.md).

## Editing content

Pages are WordPress HTML in `content/pages/<slug>.json` (`main`). Edit the HTML there (keep the class names — the
original CSS depends on them), or change the shared header/footer in `content/fragments/` — except their menus, which
`lib/navigation.mjs` renders (edit `NAV` there; new labels go in `content/copy/en.json`). Re-running the importer
overwrites `content/` from the WordPress snapshot, so only do that while WordPress is still the source of truth.

The owner's edits of 2026-11-08 are made where each page is rendered (`lib/pages/edits.mjs`, called from
`components/site-document.tsx`), not in `content/`, so a re-import can't undo them: every footer's last line reads
"© 2026 Tzion Breslov" (the imported "© 2026 Tzion Beslov | Site by Esti Wolo" with its link), and the 18 Parasha
articles name Tzion Breslov as their author in their `<meta name="author">`, `twitter:data1` and JSON-LD. Each edit
fails the build if what it changes is missing or repeated, so editing those places in `content/` means editing the
edit too. The importer copies the theme's `style.css` without its header's author lines
(`scripts/lib/theme-header.mjs`).

## Wording check

`npm run check:wording` (part of `npm run check`) holds every page to what it said at checkpoint-001: the same text,
in the same order, with new text allowed in between (`tests/wording/checkpoint-001.json`; the form placeholders in
`checkpoint-001-placeholders.json`). Both baselines are never regenerated or edited.

The only exceptions are the changes the owner asked for, in `tests/wording/owner-approved.json`. Each entry gives its
routes, the exact checkpoint-001 text node, its new text (or `null` when it is removed), the date and the owner's own
words. The check applies them to the baseline before comparing, and fails on an entry that is no longer used, that
would reach a second node on a route, or that has no date or owner's words. **Add an entry only with the owner's
words.** A summary of an answer the owner gave to a question may sit beside them, labelled as the controller's
summary, never as the owner's words. Today it holds the footer's credit line (2026-11-08).

## Configuration (GitHub → Settings → Secrets and variables → Actions → **Variables**)

All public, build-time values:

- `NEXT_PUBLIC_SITE_URL` — the site's public origin for canonical links, social cards, structured data, sitemaps and
  `robots.txt`. Unset = `https://tzionbreslov.com` (where WordPress still lives); set to `https://tzionbreslov.org` on
  switch day (step 9.3).
- `NEXT_PUBLIC_API_BASE_URL` — `https://api.tzionbreslov.org`, set on switch day (step 10), after go-live
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY` — `0x4AAAAAAF1kfPJ0qES50FAh` (widget "Tzion Breslov forms", tzionbreslov.org + www), set
  with the API address (step 10)
- `NEXT_PUBLIC_PAYPAL_CLIENT_ID` — when PayPal checkout is wired
- `GOOGLE_CALENDAR_ICAL_URL` — the Events calendar's public iCal address (`…/public/basic.ics`, docs/EVENT_CALENDAR.md);
  read by the deploy's calendar sync, not by the site itself

Unless both `NEXT_PUBLIC_API_BASE_URL` and `NEXT_PUBLIC_TURNSTILE_SITE_KEY` are set, the forms show a "temporarily
unavailable — email us" message instead of failing silently.
Worker secrets go in Cloudflare (`wrangler secret put …`), never in GitHub. See `SECURITY.md`.

## Domains and Cloudflare

**tzionbreslov.org** (Cloudflare Registrar + DNS, account `tzionbreslovproject@gmail.com`) is the site's future home.
**tzionbreslov.com** is still the WordPress site at the old host. Until the switch:

| Piece | State |
|---|---|
| `tzionbreslov.org`, `www` | Proxied placeholder records (`192.0.2.1`, `100::`) + redirect rule **302** → `https://tzionbreslov.com` + same path. 302, not 301: a cached 301 would loop once .com later redirects to .org. |
| Zone security | Always HTTPS, TLS ≥ 1.2, DNSSEC, SSL Full (strict) for the zone plus a Configuration Rule giving the two site hosts SSL **Full** (see switch day, step 9.4), security headers via Transform Rule (CSP **report-only**) — values from `config/security-headers.mjs` |
| Email | `v=spf1 -all` + DMARC `p=reject` (nothing may send as @tzionbreslov.org; Resend's DKIM still aligns later). No MX: inbound mail is declined, so the Worker sets a Reply-To on its emails. |
| Forms API | D1 `tzion-breslov-production` (schema applied), Turnstile widget (site key above). Worker `tzion-breslov-api` → `api.tzionbreslov.org` deploys with `npm run worker:deploy` |
| GitHub Pages preview | `tzionbreslov.github.io/Tzion-Breslov-Project/` (canonical links still point at the real domain) |

### Switch day

Everything the new structure, the RSVPs and the forms need from the live services, in one ordered list. **Every step
changes a live service and runs only with the owner's go-ahead, given for that step.** Before a step runs, its undo
values (the Worker version, the D1 bookmark, the exported rules and records) go into the switch-day pull request
(owner rule 2; ROLLBACK.md lists the same undos). Steps 1–8 can run before the domain switch, on different days if
wanted. **Step 9 (go-live) happens only on the owner's word, after the conversation with the Rabbi**; steps 10 and 11
follow it.

**Running the commands**

- Run them from the repository root, logged in as the owner: `npx wrangler login` (Cloudflare account
  tzionbreslovproject@gmail.com) and `gh auth login` (GitHub).
- Each command is one line that works as written, with its quotes, in bash and in PowerShell (Windows PowerShell 5.1
  and PowerShell 7). Where a line differs between the shells beyond `curl`, both are given.
- On every `curl` line, PowerShell uses `curl.exe` with the same arguments, never plain `curl`: in Windows PowerShell
  5.1, plain `curl` is `Invoke-WebRequest`.
- Replace each placeholder in angle brackets, brackets included (`<version-id>` becomes the id itself). `<` and `>`
  are redirection in both shells.
- D1 SQL runs with `npx wrangler d1 execute tzion-breslov-production --remote --command "<SQL>"` (or in the
  dashboard's D1 console). Every statement here holds only single quotes (no `"`, `$`, backtick or `!`), so it
  reaches D1 unchanged inside `--command "…"`. Each one was rehearsed that way on a local D1 (`--local`) in bash,
  PowerShell 7 and Windows PowerShell 5.1.
- The Cloudflare exports in steps 5, 6 and 9 read the Cloudflare API with a **read-only** token. Create it under
  dashboard → My Profile → API Tokens → Create Token → Custom token, for the zone tzionbreslov.org, with Zone · Single
  Redirect · Read, Zone · Transform Rules · Read and Zone · DNS · Read. (9.6 adds the zone tzionbreslov.com: see
  there.)
  - Keep it in the shell for the session only, typed without showing it:
    - bash: `read -rs CF_READ_TOKEN`
    - PowerShell 7: `$env:CF_READ_TOKEN = Read-Host -MaskInput`
    - Windows PowerShell 5.1: `$s = Read-Host -AsSecureString; $env:CF_READ_TOKEN = [System.Net.NetworkCredential]::new('', $s).Password`
  - Don't name it `CLOUDFLARE_API_TOKEN`: wrangler would use that token instead of its login.
  - The exports land in `.tmp/switch-day/` (git-ignored). They hold no secrets: copy each one into the switch-day
    pull request.
  - Each export uses `curl -sS --fail`, so a refused request (e.g. a token without a permission) prints an error and
    saves nothing. It also leaves an earlier file of the same name as it was, so each export first deletes its file
    (a `node -e "require('fs').rmSync(…)"` line). A `node -e` line after each export then checks that the saved
    file is the real export, not an error body or nothing. **An export that fails its check is not an undo: fix the
    token and export again before going on.**

#### 1. Pre-checks

*Changes:* nothing. The check in 1.6 runs a statement on the live D1 that writes no row, so it still waits for the
owner's go-ahead.

1. **Bundle check:** `npx wrangler deploy --dry-run --outdir .tmp/worker-dry-run` bundles the Worker (with
   `lib/events.mjs` and its `content/copy/en.json` import) and checks `wrangler.jsonc`. It uploads nothing.
   *Verify:* it lists the bindings (D1 `DB` and seven variables, `EVENTS_FEED_URL` among them) and ends with
   `--dry-run: exiting now.`
2. **Worker version:** `npx wrangler deployments list`. Record the newest version id in the pull request ("before
   switch day").
3. **The live Worker's logging:** dashboard → Workers & Pages → tzion-breslov-api → Settings → Observability. Record
   whether Workers Logs is on, and whether invocation logs are on.
   - Today's Worker was deployed on 2026-11-06 without an `observability` block. A read-only check on 2026-11-08
     (Cloudflare API GETs and Workers Observability queries; nothing changed) found Workers Logs storing nothing for
     it, invocation logs included: its settings had `observability: null`, `logpush: false` and no tail consumers,
     and Workers Observability had no events from any Worker in the previous 7 days, although this Worker runs a daily
     cron (PROJECT_MEMORY.md, decision 13, answered).
   - The setting can change before switch day, so record on the day what the dashboard shows. Step 4 then turns
     Workers Logs on, with invocation logs off.
   - Step 4's deploy sets the logging that `wrangler.jsonc` asks for. Its undo checks the Worker against this record
     after the rollback.
4. **D1 bookmark:** `npx wrangler d1 time-travel info tzion-breslov-production`. Record the bookmark it prints.
   Time Travel restores any minute of the last 30 days on the Workers Paid plan, or 7 days on Workers Free. The
   repository doesn't record the account's plan, so count on 7.
5. **Migrations:** `npx wrangler d1 migrations list tzion-breslov-production --remote` must list
   `0002_rsvps_and_topics.sql` as the only migration to apply. **If `0001_initial.sql` is listed too, stop.**
   0001 was applied through the API and recorded in `d1_migrations` by hand (PROJECT_MEMORY.md), and running it again
   would fail on tables that already exist.
6. **`UPDATE … FROM` check:** the daily clean-up's RSVP step uses `UPDATE … FROM` (SQLite 3.33+). Check that D1
   takes it, on a table that exists since 0001. `json_each('{}')` has no rows, so it changes no row:
   `npx wrangler d1 execute tzion-breslov-production --remote --json --command "UPDATE subscription_confirmations SET used_at = feed.value FROM json_each('{}') AS feed WHERE subscription_confirmations.id = feed.key;"`
   - It must print JSON with `"success": true`. Keep `--json`: without it, a terminal shows only
     `🚣 Executed 1 command …`, not the answer this check needs. An error prints `"error": { "text": "…" }` instead.
   - **If it errors, stop: run none of the steps below.** Every daily clean-up would fail, including the sign-up
     deletion the privacy notice promises.
   - The fix is a follow-up pull request that rewrites the clean-up's UPDATE as a correlated
     `SET event_ends_at = (SELECT …) WHERE event_id IN (SELECT …)`.
   - Step 2 repeats the check on `rsvps` itself. That table only exists after migration 0002, so the same check on
     `rsvps` can't run here: it fails with "no such table: rsvps".

*Undo:* nothing to undo.

#### 2. D1: migration 0002

*Changes:* the live database gains the table `rsvps` (with two indexes) and the column
`subscription_confirmations.topics_json` (default `'["newsletter"]'`). The migration is additive, and the running
Worker ignores it. It must come before step 4: the new Worker writes `topics_json`, and its daily clean-up deletes
from `rsvps`. *Owner's go-ahead.*

1. Right before migrating, always record a fresh bookmark (the undo restores to it):
   `npx wrangler d1 time-travel info tzion-breslov-production`.
2. `npm run db:migrate:remote` (that is `wrangler d1 migrations apply tzion-breslov-production --remote`). It shows
   0002 and asks to confirm.

*Verify:*
- `npx wrangler d1 migrations list tzion-breslov-production --remote` has no migration left to apply.
- Then the gate for step 4, on the real table:
  `npx wrangler d1 execute tzion-breslov-production --remote --json --command "UPDATE rsvps SET event_ends_at = feed.value FROM json_each('{}') AS feed WHERE rsvps.event_id = feed.key;"`
  must print JSON with `"success": true` (keep `--json`, as in 1.6). **If it prints an `"error"`, stop: don't run
  step 4**, and undo this step.

*Undo (if step 4 ran, only after its undo, including its DELETE, which needs `topics_json`), either:*
- losing only the RSVPs:
  `npx wrangler d1 execute tzion-breslov-production --remote --command "DROP TABLE rsvps; ALTER TABLE subscription_confirmations DROP COLUMN topics_json; DELETE FROM d1_migrations WHERE name = '0002_rsvps_and_topics.sql';"`
  This also drops the table's two indexes. Every other row stays, and 0002 can be applied again later.
- or `npx wrangler d1 time-travel restore tzion-breslov-production --bookmark=<bookmark>`. This restores the whole
  database to the bookmark and loses every contact, signup and RSVP row written since.

#### 3. Resend: the "Event announcements" list

*Changes:*
- Resend gains the topic "Event announcements". Its default is opt-out, so nobody is on it until they confirm, and
  that can't be changed later.
- `.env.worker` gains `RESEND_EVENTS_TOPIC_ID`.
- The Worker gets it as its 9th secret. `wrangler secret put` deploys a new Worker version at once: today's code
  plus the secret, which that code ignores.

*Owner's go-ahead.*

**Before:** back up `.env.worker`, which 3.1 writes to. The undos below restore it, so that a later `--secrets-file`
upload can't push a deleted webhook's secret or a revoked key. It holds secrets: it is copied, never printed.
- Both shells: `node -e "require('fs').copyFileSync('.env.worker', '.env.worker.bak', require('fs').constants.COPYFILE_EXCL)"`
- If it stops with `EEXIST`, a backup already exists, from an earlier try at this step. Decide whether it may stay.
  - Compare the two files (both shells). It prints variable names only, never a value: the names in only one of the
    files, the names whose value differs between them, and whether the files are byte-identical:
    `node -e "const fs = require('fs'); const vars = f => new Map(fs.readFileSync(f, 'utf8').split(/\r?\n/).map(l => l.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)/)).filter(Boolean).map(m => [m[1], m[2].trim()])); const a = vars('.env.worker'), b = vars('.env.worker.bak'); const show = x => x.join(' ') || '(none)'; console.log('only in .env.worker:', show([...a.keys()].filter(n => b.has(n) === false))); console.log('only in .env.worker.bak:', show([...b.keys()].filter(n => a.has(n) === false))); console.log('value changed:', show([...a.keys()].filter(n => b.has(n) && (a.get(n) === b.get(n)) === false))); console.log(fs.readFileSync('.env.worker').equals(fs.readFileSync('.env.worker.bak')) ? 'identical' : 'different')"`
  - **`identical`:** keep the backup.
  - **`different`, with `value changed: (none)`, `only in .env.worker.bak: (none)`, and nothing under "only in
    .env.worker" but `RESEND_EVENTS_TOPIC_ID` (or nothing at all):** keep it. No variable was added, removed or
    changed since that backup, apart from the line the earlier try at 3.1 wrote, so it is the older, clean copy.
  - **Otherwise** (any name under `value changed`, e.g. a rotated key; any name under "only in .env.worker.bak"; any
    other name under "only in .env.worker"; or you can't tell): `.env.worker` was changed since that backup, on
    purpose or by an earlier try, and the check can't tell which. Treat the backup as stale: restoring it could bring
    an old value back. Delete it and take a fresh copy:
    1. If the comparison listed `RESEND_EVENTS_TOPIC_ID` under "only in .env.worker", remove that line from
       `.env.worker` by hand (in an editor, never printed). 3.1 writes it again.
    2. `node -e "require('fs').rmSync('.env.worker.bak')"` (both shells).
    3. The copy line above again. It must not stop with `EEXIST` this time.
- `git check-ignore -v .env.worker.bak` must print `.gitignore:3:.env.*` and the file name: the backup is
  git-ignored. Never commit it.

1. `node scripts/setup-resend.mjs` (it uses the full-access key `RESEND_CONTACTS_API_KEY` in `.env.worker`, and
   re-running it reuses what exists). Expected output:
   - `domain tzionbreslov.org: verified (… DNS records → .tmp/resend-dns.json)`
   - `topic "Newsletter": 934b4bcd-a4a7-43ce-9310-8fac1cc4541c` (reused)
   - `added the missing RESEND_EVENTS_TOPIC_ID line to .env.worker`, printed when `.env.worker` has no such line yet
     (the usual case)
   - `topic "Event announcements": <topic-id>`, the only new thing in Resend
   - `webhook 3ade2dad-e974-4e65-ad11-4c3db16a9677 already exists; secret already saved`
   - `RESEND_TRANSACTIONAL_API_KEY already set; left unchanged`
   - a last line where every value reads `=set`

   Stop and tell the owner on any of these. Either way, the script has already created the topic "Event
   announcements" and written its `RESEND_EVENTS_TOPIC_ID` line to `.env.worker` (it does that before it looks at
   the webhook and the key). **If you halt here, also apply this step's undo** (below) for the topic and its line;
   skip its `secret delete`, since 3.2 hasn't run.
   - **`webhook created` or `send-only key created`:** an unplanned live change, and the script has written its
     signing secret (`RESEND_WEBHOOK_SECRET`) or key (`RESEND_TRANSACTIONAL_API_KEY`) into `.env.worker`. The undo:
     delete that webhook, or revoke that key, in Resend, then restore `.env.worker` from the backup:
     `node -e "require('fs').copyFileSync('.env.worker.bak', '.env.worker')"` (both shells). If `.env.worker` was
     changed on purpose since the backup, remove the lines by hand instead: the `RESEND_EVENTS_TOPIC_ID=` line, and
     the `RESEND_WEBHOOK_SECRET=` or `RESEND_TRANSACTIONAL_API_KEY=` line that 3.1 wrote.
   - **`webhook … already exists but its secret isn't in .env.worker — delete it in Resend (or ask Claude) and
     re-run.`:** `.env.worker` has lost `RESEND_WEBHOOK_SECRET`, which the live Worker still uses to check Resend's
     webhooks. Don't follow the message's advice on switch day: a new webhook means a new secret for the Worker. The
     owner decides first.
2. `npx wrangler secret put RESEND_EVENTS_TOPIC_ID`, and paste the `<topic-id>` from step 3.1 when it asks.

*Verify:*
- `npx wrangler secret list` shows nine names, `RESEND_EVENTS_TOPIC_ID` among them.
- `TURNSTILE_SECRET_KEY` exists **only** in Cloudflare. Never put it in `.env.worker`, or a `--secrets-file` upload
  would overwrite it.
- In Resend → Audience → Topics, "Event announcements" is listed.

*Undo (if step 4 ran, only after its undo; the new Worker needs both):*
- `npx wrangler secret delete RESEND_EVENTS_TOPIC_ID`.
- Delete the topic in Resend: Audience → Topics, or `DELETE https://api.resend.com/topics/<topic-id>` with the
  full-access key.
  - **Once step 10 has run, people have confirmed that they want Event announcements.** Deleting the topic silently
    drops every one of those choices. After step 10, keep the topic unless the owner decides otherwise. If it must
    go, first save the list of its subscribers from Resend, so they can be asked again.
- Restore `.env.worker` from the backup made before 3.1:
  `node -e "require('fs').copyFileSync('.env.worker.bak', '.env.worker')"` (both shells). That removes the
  `RESEND_EVENTS_TOPIC_ID` line, and any webhook secret or key that 3.1 wrote. If `.env.worker` was changed on
  purpose since the backup (e.g. a rotated key), remove the lines by hand instead: the `RESEND_EVENTS_TOPIC_ID=`
  line, and any webhook secret or key line that 3.1 wrote.

#### 4. Worker deploy: RSVPs, announcements, Workers Logs

*Changes:* the forms Worker `tzion-breslov-api` gains:
- `POST /v1/rsvp` and `GET /v1/rsvp/availability`;
- lists (`topics`) on `/v1/subscribe`;
- the RSVP clean-up in its daily cron (03:17 UTC);
- the variable `EVENTS_FEED_URL`;
- **Workers Logs** (`observability` in `wrangler.jsonc`).

The site's forms stay off until step 10, so no visitor reaches the new routes yet. *Owner's go-ahead.*

**Before:** `npx wrangler deployments list`. Record the newest version id in the pull request: the version step 3
made, today's code with the new secret. This is the rollback target. The deploy needs migration 0002 (step 2) and the
secret (step 3) first. Deployed earlier, it would break the newsletter signup and the daily clean-up. Because
`secrets.required` lists the secret in `wrangler.jsonc`, wrangler refuses to deploy while `RESEND_EVENTS_TOPIC_ID` is
missing.

**Deploy:** `npm run worker:deploy`. The variable `EVENTS_FEED_URL` ships with it, and so do Workers Logs:
- **Invocation logs stay off** (`"invocation_logs": false`). They would store every request's URL (confirmation
  tokens included), its headers and the visitor's IP.
- So Workers Logs are expected to keep only the Worker's own log lines, for up to 7 days (3 days on Workers Free
  until December 1, 2026), under dashboard → Workers & Pages → tzion-breslov-api → **Observability**.
- Those lines are codes such as `RSVP_ORGANIZER_EMAIL_FAILED`, `RSVP_CANCEL_FAILED`, `RSVP_CONFIRM_FAILED`,
  `RSVP_CLEANUP_FEED_UNAVAILABLE` and `EVENTS_FEED_EVENT_SKIPPED`, plus the method and path (never the query string)
  and request or correlation ids.
  They hold no personal data.
- Cloudflare's own fields in a stored event are `$`-prefixed (e.g. `$workers.event.request.url`, `$metadata.…`). The
  Worker's own fields are not (`correlationId`, `method`, `path`, `error`, `code`).
- Cloudflare's docs don't say whether a stored line still carries request fields with invocation logs off. The probe
  below confirms it.
- `"redact_query_string": true` should also strip the query string from any URL Cloudflare does record.

**Smoke tests, right after the deploy** (in PowerShell, `curl.exe` with the same arguments):
- **Health:** `curl -s "https://api.tzionbreslov.org/health"` → `{"ok":true}` (it reads D1). It answers GET only:
  a HEAD (`curl -I`) gets a 404 by design.
- **RSVP preflight:**
  `curl -si -X OPTIONS "https://api.tzionbreslov.org/v1/rsvp" -H "Origin: https://tzionbreslov.org" -H "Access-Control-Request-Method: POST" -H "Access-Control-Request-Headers: content-type"`
  → status 204, `Access-Control-Allow-Origin: https://tzionbreslov.org`, `Access-Control-Allow-Methods: POST, OPTIONS`.
  - Before the deploy, the same request answers 404, because the old Worker has no `/v1/rsvp`. So a 204 proves the
    new code is live.
  - With `-H "Origin: https://example.com"` instead, it answers 403 `ORIGIN_NOT_ALLOWED`.
- **Availability:** `curl -s "https://api.tzionbreslov.org/v1/rsvp/availability"` →
  `{"ok":false,"error":"EVENTS_UNAVAILABLE","correlationId":"…"}` (503) **until go-live**. The Worker reads
  `https://tzionbreslov.org/events.json` without following redirects, and .org still answers it with a 302 to .com.
  After step 9 it answers 200 `{"ok":true,"events":{…}}` (step 11).

**Expected until go-live (step 9):** from this deploy until the site is live on tzionbreslov.org, the daily clean-up
logs `RSVP_CLEANUP_FEED_UNAVAILABLE` every day and deletes only RSVPs that ended more than 7 days before (there are
none: none can be made yet). The other clean-ups run as usual, and the line stops once the site is live (step 11).

**Log-probe check, at once, before step 10 turns the forms on:**
- **Force a stored line.** On a healthy deploy the Worker only logs failures. Pick a probe of letters, digits and
  hyphens that appears nowhere else, e.g. `tzprobe-7k2q9x`, and run, with the quotes:
  `curl -s "https://api.tzionbreslov.org/nope?probe=tzprobe-7k2q9x"` in bash, or
  `curl.exe -s "https://api.tzionbreslov.org/nope?probe=tzprobe-7k2q9x"` in PowerShell.
  - The answer is a 404, `{"ok":false,"error":"NOT_FOUND","correlationId":"<id>"}`.
  - The Worker logs exactly one line:
    `{"correlationId":"<id>","method":"GET","path":"/nope","error":"NOT_FOUND"}`.
- **Open it:** Workers & Pages → tzion-breslov-api → Observability. Search for that `<id>`, open the event and
  expand the full event, not just the message column.
- **The check fails** if any of these appear:
  - the probe string anywhere;
  - any URL, path or trigger field besides the Worker's own four (`correlationId`, `method`, `path`, `error`, also
    shown parsed as fields), e.g. `$workers.event.request.url` or `$workers.event.request.path`;
  - any request header (e.g. `cf-connecting-ip`, `user-agent`);
  - any `cf` request data (e.g. colo, country, city, ASN).

  Cloudflare's own bookkeeping is fine: timestamp, level, Worker name and version, outcome, ids. Both tests count:
  with query strings redacted, a stored URL would no longer hold the probe.
- **If it fails:**
  1. Change that line of `wrangler.jsonc` to `"observability": { "enabled": false },` and run
     `npm run worker:deploy` again straight away. Not `wrangler rollback`: that would take back the whole RSVP
     release.
  2. From then on, diagnose live with `npx wrangler tail`.
  3. Delete the stored test lines if the dashboard allows it; otherwise they expire within 7 days.
  4. Record the change in its own pull request. The owner may later choose a Tail Worker that strips those fields,
     or sampling, instead.

*Undo (the whole release):*
1. **If step 10 ran, undo it first, wait until that Deploy GitHub Pages run has finished, then wait 10 more
   minutes.** GitHub Pages serves the pages with `Cache-Control: max-age=600` (seen with `curl -sI` on 2026-11-08),
   so a browser can keep showing the forms-on page for 10 minutes after the deploy.
   - Otherwise the site keeps sending `topics` to the old Worker. That Worker ignores them and confirms every signup
     into the Newsletter, and its rows get the default `topics_json` (`["newsletter"]`), which the DELETE below
     can't catch.
   - RSVPs would also fail: the old Worker has no `/v1/rsvp`, so even the preflight answers 404.
2. `npx wrangler rollback <version-id>` (the version recorded above).
3. Then, at once:
   `npx wrangler d1 execute tzion-breslov-production --remote --command "DELETE FROM subscription_confirmations WHERE used_at IS NULL AND topics_json = json_array('events');"`
   - Why the DELETE: the previous Worker confirms every signup into the Newsletter, so an events-only signup still
     pending (24 h) would land on a list its visitor never chose. Those visitors sign up again.
   - A pending signup for both lists keeps the Newsletter.
4. **RSVPs: required whenever the table `rsvps` has rows.** The old Worker's daily clean-up never touches `rsvps`,
   so they would stay forever, and the privacy notice ("deleted once the event is over") would be untrue.
   - Count them: `npx wrangler d1 execute tzion-breslov-production --remote --json --command "SELECT COUNT(*) AS rsvps FROM rsvps;"`
   - **If the count is above 0, run this every day** until the RSVP release is deployed again (from then on its own
     daily clean-up does it):
     `npx wrangler d1 execute tzion-breslov-production --remote --json --command "DELETE FROM rsvps WHERE event_ends_at < datetime('now');"`
     - It must print `"success": true`. It is the release's own deletion: every RSVP whose event has ended, by the
       end the RSVP stored (an event moved later loses its RSVPs at its old end; the organizer has them by email).
     - Note each day's run, with its date and the count after it, in the switch-day pull request.
   - **Only if the RSVP release won't come back**, undo step 2 instead: it drops the table and every RSVP in it, so
     nothing is left to delete. Not while it may come back: applying 0002 again starts every event's count at zero,
     so an event with an RSVP limit could be overbooked.
5. Check the logging: dashboard → the Worker → Settings → Observability. Logging is a Worker setting, not part of
   the code, and Cloudflare's docs don't say whether a rollback restores it.
   - If it doesn't match what step 1.3 recorded, set it back by hand.
   - If step 1.3 found invocation logs on, keep them off unless the owner decides otherwise: they store request URLs
     and IPs.
6. After that, undo steps 3 and 2 if wanted, in that order (step 2's undo also ends the daily DELETE of 4).

#### 5. Cloudflare rule `tzion_security_headers`: the CSP

*Changes:* the zone's response-header Transform Rule `tzion_security_headers` (its description, as PROJECT_MEMORY.md
records it; 5.1's export confirms it). Its `Content-Security-Policy-Report-Only` value becomes `CSP_REPORT_ONLY`
from `config/security-headers.mjs`:
- frame-src **gains `https://www.google.com`** (the Contact page's map);
- frame-src **loses `https://www.youtube.com`** (no plain YouTube embed remains; the Classes player uses
  youtube-nocookie);
- nothing else changes.

While the header is report-only, browsers block nothing either way. *Owner's go-ahead.*

1. **Export the rule first**, check the export, and copy the file into the pull request:
   - Delete any earlier export first (both shells), so a failed export can't leave an old file that passes the check:
     `node -e "require('fs').rmSync('.tmp/switch-day/transform-rules-before.json', { force: true })"`
   - bash: `curl -sS --fail --create-dirs -o .tmp/switch-day/transform-rules-before.json "https://api.cloudflare.com/client/v4/zones/a38137f548dead44f7178034ced45e15/rulesets/phases/http_response_headers_transform/entrypoint" -H "Authorization: Bearer $CF_READ_TOKEN"`
   - PowerShell: `curl.exe -sS --fail --create-dirs -o .tmp/switch-day/transform-rules-before.json "https://api.cloudflare.com/client/v4/zones/a38137f548dead44f7178034ced45e15/rulesets/phases/http_response_headers_transform/entrypoint" -H "Authorization: Bearer $env:CF_READ_TOKEN"`
   - Check it (both shells):
     `node -e "const j = JSON.parse(require('fs').readFileSync('.tmp/switch-day/transform-rules-before.json', 'utf8')); console.log(j.success, j.result.rules.map(r => r.description))"`
     must print `true` and a list that includes `'tzion_security_headers'`. A `curl: (22)` error, an `ENOENT`
     error, `false`, a `TypeError` or a missing name means the export failed.
   - **That name is the rule to edit.** If the list holds no `'tzion_security_headers'` but another rule that sets
     the security headers, stop: the live rule isn't the one PROJECT_MEMORY.md records, so find out why before
     editing anything.
2. Print the new value: `node -e "import('./config/security-headers.mjs').then(m => console.log(m.CSP_REPORT_ONLY))"`.
3. Dashboard → tzionbreslov.org → Rules → Transform Rules → response header rules → edit
   `tzion_security_headers` → replace the value of `Content-Security-Policy-Report-Only` with that line → Save.

*Verify:* the rule already applies to .org's 302 today, so the new value shows at once:
- bash: `curl -sI "https://tzionbreslov.org/" | grep -i "^content-security-policy"`
- PowerShell: `curl.exe -sI "https://tzionbreslov.org/" | Select-String -Pattern "^content-security-policy"`

It must read `frame-src https://www.youtube-nocookie.com https://challenges.cloudflare.com https://www.google.com`.
After go-live, step 11 runs the live CSP check.

*Later, separately (owner's go-ahead, not on switch day):* once the live check passes,
1. rename the header to `Content-Security-Policy` with the value of `CSP` (it re-adds `upgrade-insecure-requests`);
2. stage HSTS (short max-age first).

Export the rule before each of these changes too.

*Undo:* put the exported value back in the same rule (it is the `Content-Security-Policy-Report-Only` value in
`.tmp/switch-day/transform-rules-before.json`).

#### 6. Redirect rules for the removed addresses (301)

*Changes:* three Single Redirect rules on the zone. Each is a static 301 that sends a removed address on the site's
two hosts to its new home. *Owner's go-ahead.*
- **They go below the existing 302 rule `tzion_org_to_com_temporary`.** Cloudflare uses the first redirect rule that
  matches, so on tzionbreslov.org and www the new rules don't fire until step 9 deletes the 302.
  - Above it, `/resources/` would get a 301, which browsers cache for good, to `/classes/`. The 302 would then send
    that to .com, where the page doesn't exist.
- **Each rule is scoped to the 302's hosts**, `http.host in {"tzionbreslov.org" "www.tzionbreslov.org"}`. The 302
  doesn't cover `api.tzionbreslov.org` (its `/health` answers 200 today), so rules without the scope would fire on
  `api.` at once.
- Single Redirects only act on proxied traffic, so the rules take effect when step 9 proxies the records again.
- The zone's quota is 10 Single Redirect rules on the Free plan (wildcards yes, regular expressions no). With the
  302, this makes 4.

1. **Export the redirect rules first**, check the export, and copy the file into the pull request:
   - Delete any earlier export first (both shells):
     `node -e "require('fs').rmSync('.tmp/switch-day/redirect-rules-before.json', { force: true })"`
   - bash: `curl -sS --fail --create-dirs -o .tmp/switch-day/redirect-rules-before.json "https://api.cloudflare.com/client/v4/zones/a38137f548dead44f7178034ced45e15/rulesets/phases/http_request_dynamic_redirect/entrypoint" -H "Authorization: Bearer $CF_READ_TOKEN"`
   - PowerShell: `curl.exe -sS --fail --create-dirs -o .tmp/switch-day/redirect-rules-before.json "https://api.cloudflare.com/client/v4/zones/a38137f548dead44f7178034ced45e15/rulesets/phases/http_request_dynamic_redirect/entrypoint" -H "Authorization: Bearer $env:CF_READ_TOKEN"`
   - Check it (both shells):
     `node -e "const j = JSON.parse(require('fs').readFileSync('.tmp/switch-day/redirect-rules-before.json', 'utf8')); console.log(j.success, j.result.rules.map(r => r.description))"`
     must print `true` and a list that includes `'tzion_org_to_com_temporary'`. A `curl: (22)` error, an `ENOENT`
     error, `false`, a `TypeError` or a missing name means the export failed.
2. Create the rules in this order. For each: dashboard → tzionbreslov.org → Rules → Redirect Rules → Create rule →
   Custom filter expression → Edit expression. Then set: Static, the URL, status code **301**, Preserve query string
   off, Place at **Last**.

   | Rule name | Expression | URL |
   |---|---|---|
   | `tzion_removed_archives_to_articles` | `(http.host in {"tzionbreslov.org" "www.tzionbreslov.org"}) and ((http.request.uri.path wildcard "/resources/page/*") or (http.request.uri.path wildcard "/category/uncategorized") or (http.request.uri.path wildcard "/category/uncategorized/*") or (http.request.uri.path wildcard "/author/esti-wolo") or (http.request.uri.path wildcard "/author/esti-wolo/*"))` | `https://tzionbreslov.org/articles/` |
   | `tzion_removed_resources_to_classes` | `(http.host in {"tzionbreslov.org" "www.tzionbreslov.org"}) and ((http.request.uri.path in {"/resources/" "/resources"}) or (http.request.uri.path wildcard "/video") or (http.request.uri.path wildcard "/video/*"))` | `https://tzionbreslov.org/classes/` |
   | `tzion_removed_about_to_about_us` | `(http.host in {"tzionbreslov.org" "www.tzionbreslov.org"}) and (http.request.uri.path in {"/about/" "/about"})` | `https://tzionbreslov.org/about-us/` |

   How Cloudflare matches the path (Rules language → Operators,
   https://developers.cloudflare.com/ruleset-engine/rules-language/operators/#wildcard-matching):
   - `wildcard` must match the whole path and ignores case. Each `*` matches any characters, or none, and `/` has no
     special meaning. So `/video/*` covers `/video/` and `/video/video-1/`, and `/category/uncategorized/*` covers
     `/category/uncategorized/` itself.
   - `eq` and `in` match the exact path, case included.
   - So each address typed without its final slash gets its own exact match, which ignores case just when its slash
     form does: `wildcard "/video"` (no `*`: the whole path, any case), `in {"/resources/" "/resources"}`. A shorter
     pattern would catch pages it shouldn't: `/video*` also matches `/video-x`, and `/about*` matches `/about-us/`.
   - The archives rule comes first, so `/resources/page/2/` can never meet the Classes rule.

*Verify:*
- **Now:** the dashboard lists the three rules after `tzion_org_to_com_temporary`.
- **Now:** `curl -sI "https://api.tzionbreslov.org/about/"` still answers the Worker's 404, not a 301: the host scope
  holds.
- **Now:** `curl -sI "https://tzionbreslov.org/resources/"` still answers 302 → `https://tzionbreslov.com/resources/`,
  because the 302 rule wins.
- **After step 9:** each address answers 301 with the right `location` (step 11):

  | Address | `location` |
  |---|---|
  | `/resources/` | `/classes/` |
  | `/resources` | `/classes/` |
  | `/video/video-1/` | `/classes/` |
  | `/video` | `/classes/` |
  | `/resources/page/2/` | `/articles/` |
  | `/category/uncategorized/` | `/articles/` |
  | `/category/uncategorized` | `/articles/` |
  | `/author/esti-wolo/page/2/` | `/articles/` |
  | `/author/esti-wolo` | `/articles/` |
  | `/about/` | `/about-us/` |
  | `/about` | `/about-us/` |

  Test each with `curl -sI "https://tzionbreslov.org/resources/"`, swapping in the address.
- **After step 9:** no rule catches a page that exists or a look-alike address. `/about-us/`, `/articles/` and
  `/classes/` answer 200, and `/resources-x/` and `/video-x/` answer 404, each without a 301.

*Undo:* delete the three rules (the export shows what was there before). Browsers keep a 301 they already followed,
so the undo is only complete before go-live.

#### 7. Privacy check at the Cloudflare edge

*Changes:* nothing by itself. Only a setting change the owner approves changes anything.

The privacy notice (`/privacy/`, `content/copy/en.json` `privacy`) says the site sets no cookies of its own and uses no
analytics or tracking. Some Cloudflare features would make that untrue once the records are proxied:
- a `__cf_bm` cookie (Bot Fight Mode / bot management);
- the Web Analytics beacon (`static.cloudflareinsights.com`);
- Network Error Logging: `Nel` and `Report-To` headers, which make browsers send error reports to
  `a.nel.cloudflare.com`;
- anything else Cloudflare injects under `/cdn-cgi/` (e.g. email address obfuscation).

**Today (seen 2026-11-07), tzionbreslov.org and api.tzionbreslov.org already send `Nel` and `Report-To`, so this
check fails now.** The owner chooses, before step 10 turns the forms on:
- **Turn NEL off** in the zone's Network Error Logging setting, recording its previous value as the undo. Cloudflare's
  docs don't describe that switch, so it may not exist on this plan. If not, take the second option.
- **Or keep it** and disclose it: a sentence about it in the notice (`content/copy/en.json` `privacy`, in its own
  pull request), with the notice's `date` updated.

**Headers (any time; run each command as written, with the quotes):**
- bash:
  - `curl -sI "https://tzionbreslov.org/" | grep -iE "^(set-cookie|nel|report-to):"`
  - `curl -sI "https://www.tzionbreslov.org/" | grep -iE "^(set-cookie|nel|report-to):"`
  - `curl -si "https://api.tzionbreslov.org/health" | grep -iE "^(set-cookie|nel|report-to):"`
- PowerShell:
  - `curl.exe -sI "https://tzionbreslov.org/" | Select-String -Pattern "^(set-cookie|nel|report-to):"`
  - `curl.exe -sI "https://www.tzionbreslov.org/" | Select-String -Pattern "^(set-cookie|nel|report-to):"`
  - `curl.exe -si "https://api.tzionbreslov.org/health" | Select-String -Pattern "^(set-cookie|nel|report-to):"`

**The pages' HTML (only after step 9 proxies the site; until then the hosts only answer with a 302):**
- bash: `curl -s "https://tzionbreslov.org/contact/" | grep -oiE "cdn-cgi|cloudflareinsights"`
- PowerShell: `curl.exe -s "https://tzionbreslov.org/contact/" | Select-String -Pattern "cdn-cgi|cloudflareinsights"`
- Repeat both with `https://www.tzionbreslov.org/contact/`.

*Verify:* the check passes when every command prints nothing.

For each hit, choose one, with the owner's go-ahead:
- turn the feature off (Security → Bots for Bot Fight Mode; Web Analytics for the beacon; Scrape Shield for email
  obfuscation; the NEL setting above), record its previous value as the undo, and run the check again;
- or, if it stays on (or the plan can't turn it off), add a sentence about it to the notice and update its `date`
  before step 10.

*Undo:* put back the recorded previous value of any setting changed here.

#### 8. Calendar: the Events page's Google Calendar

*Changes:* every deploy, and the rebuilds around 07:00 and 21:00 Israel time, read the calendar's public iCal address
into `/events/` and `/events.json`. That happens on the github.io preview now, and on tzionbreslov.org after step 9.
The owner first creates the calendar ([docs/EVENT_CALENDAR.md](docs/EVENT_CALENDAR.md), one-time owner setup, steps
1–5). *Owner's go-ahead.*

1. `gh variable set GOOGLE_CALENDAR_ICAL_URL --body "<public-ical-address>"`. Use the calendar's **public** address
   ending in `/public/basic.ics`, never the secret address.
2. `gh workflow run deploy-github-pages.yml --ref main`.

*Verify:*
- In the run (Actions → Deploy GitHub Pages), "Refresh calendar events" no longer says the variable is not set.
- The preview's `/events/` lists the calendar's events.
- For step 11, at least one upcoming event must take RSVPs, i.e. have no "No RSVP" line.

*Undo:* the deploy carries the last list in the Actions cache, so deleting the variable alone would keep the old
events on the page.
1. `gh variable delete GOOGLE_CALENDAR_ICAL_URL`
2. `gh cache list --key events-`, then `gh cache delete <cache-key>` for each key it lists.
3. `gh workflow run deploy-github-pages.yml --ref main`. The page says "No events are currently scheduled" again.

#### 9. Go-live: tzionbreslov.org (only on the owner's word)

*Changes:* tzionbreslov.org stops redirecting to the WordPress site on tzionbreslov.com and serves this site from
GitHub Pages through Cloudflare. Canonical links, sitemaps and structured data switch to .org. tzionbreslov.com stays
WordPress until 9.6. **Only when the owner says so, after the conversation with the Rabbi.** Do 9.2–9.5 in one
sitting: once Pages has the custom domain, the github.io preview forwards to tzionbreslov.org, which until 9.4 still
redirects to .com.

**Before:** export the zone's DNS records (a BIND file) and check the export, and keep step 6's checked
redirect-rule export, which holds the 302 rule. Copy both into the pull request.
- Delete any earlier export first (both shells):
  `node -e "require('fs').rmSync('.tmp/switch-day/dns-before.txt', { force: true })"`
- bash: `curl -sS --fail --create-dirs -o .tmp/switch-day/dns-before.txt "https://api.cloudflare.com/client/v4/zones/a38137f548dead44f7178034ced45e15/dns_records/export" -H "Authorization: Bearer $CF_READ_TOKEN"`
- PowerShell: `curl.exe -sS --fail --create-dirs -o .tmp/switch-day/dns-before.txt "https://api.cloudflare.com/client/v4/zones/a38137f548dead44f7178034ced45e15/dns_records/export" -H "Authorization: Bearer $env:CF_READ_TOKEN"`
- Check it (both shells):
  `node -e "const t = require('fs').readFileSync('.tmp/switch-day/dns-before.txt', 'utf8'); console.log(t.trim().startsWith('{') ? 'NOT A BIND FILE' : t.split('\n').filter(l => /\sIN\s+(A|AAAA|CNAME)\s/.test(l)).join('\n'))"`
  must list the site's records as BIND lines: the apex `A 192.0.2.1`, the apex `AAAA 100::` and the `www` CNAME. A
  `curl: (22)` error, an `ENOENT` error, `NOT A BIND FILE` (a JSON error body) or no such lines means the export
  failed.

1. **Days before (owner account): verify the domain with GitHub**, so nobody else's Pages site can ever claim it.
   1. Owner profile → Settings → Pages → *Verified domains* → Add `tzionbreslov.org`.
   2. Create the TXT record GitHub shows (`_github-pages-challenge-tzionbreslov.tzionbreslov.org`) in Cloudflare.
   3. Wait until it resolves, then click *Verify*.

   **Keep that TXT record forever**: removing it can drop the verification.
2. **GitHub Pages (owner account):** repo Settings → Pages → custom domain `tzionbreslov.org`, only after the domain
   shows *Verified*. From then on the deploy's base path is empty instead of `/Tzion-Breslov-Project`.
3. **Site URL:** `gh variable set NEXT_PUBLIC_SITE_URL --body "https://tzionbreslov.org"`, then
   `gh workflow run deploy-github-pages.yml --ref main`. CI already builds and checks this variant on every PR.
4. **Cloudflare DNS, in this order:**
   1. Replace the placeholders with GitHub Pages records, **DNS-only**:
      - apex `A` 185.199.108.153 / .109 / .110 / .111;
      - apex `AAAA` 2606:50c0:8000::153 / 8001::153 / 8002::153 / 8003::153;
      - `www` CNAME `tzionbreslov.github.io`.

      Change DNS *before* touching the redirect rule: DNS-only traffic never hits it, while deleting it first would
      send visitors to the placeholder address.
   2. When repo Settings → Pages shows the certificate, tick *Enforce HTTPS*. Then **delete the 302 redirect rule**
      `tzion_org_to_com_temporary`. It must be gone before re-proxying, or it would loop once .com 301s to .org.
      Step 6's 301 rules are now first in line.
   3. Switch the records to proxied.
      - The Configuration Rule "tzion_github_pages_origin_ssl_full" (already created) makes Cloudflare use SSL
        **Full** for the site hosts. GitHub reports proxied domains as not HTTPS-eligible and may fail to renew its
        certificate, and under Full (strict) that would turn every page into a 526. Ruach Breslov runs the same way.
      - Do not put these hosts back on strict unless
        `gh api repos/tzionbreslov/Tzion-Breslov-Project/pages --jq .https_certificate` shows a valid certificate
        for tzionbreslov.org with > 30 days left.
5. **Privacy check at the edge, right after proxying:** run step 7 again, now with the HTML commands. Don't go on
   to step 10 until it passes, or until the owner's choice for each hit is done.
6. **tzionbreslov.com, later, once its DNS is on Cloudflare (owner's word for each part).** First export .com's
   records into a file of their own (`dns-before.txt` is .org's undo; never overwrite it), check the export, and
   copy it into that part's pull request.
   - The read-only token covers only the zone tzionbreslov.org. Edit it (My Profile → API Tokens) to add the zone
     tzionbreslov.com with Zone · DNS · Read, or create a second token the same way. `<com-zone-id>` is the Zone ID
     on .com's Overview page in the dashboard.
   - Delete any earlier export first (both shells):
     `node -e "require('fs').rmSync('.tmp/switch-day/dns-com-before.txt', { force: true })"`
   - bash: `curl -sS --fail --create-dirs -o .tmp/switch-day/dns-com-before.txt "https://api.cloudflare.com/client/v4/zones/<com-zone-id>/dns_records/export" -H "Authorization: Bearer $CF_READ_TOKEN"`
   - PowerShell: `curl.exe -sS --fail --create-dirs -o .tmp/switch-day/dns-com-before.txt "https://api.cloudflare.com/client/v4/zones/<com-zone-id>/dns_records/export" -H "Authorization: Bearer $env:CF_READ_TOKEN"`
   - Check it (both shells):
     `node -e "const t = require('fs').readFileSync('.tmp/switch-day/dns-com-before.txt', 'utf8'); console.log(t.trim().startsWith('{') ? 'NOT A BIND FILE' : t.split('\n').filter(l => /\sIN\s+(A|AAAA|CNAME|MX|TXT)\s/.test(l)).join('\n'))"`
     must list .com's records as BIND lines: its web records (the apex and `www`, pointing at the WordPress host)
     and its mail records (MX, TXT). A `curl: (22)` error, an `ENOENT` error, `NOT A BIND FILE` (a JSON error
     body) or no such lines means the export failed.
   1. **A 302 first:** redirect every path to `https://tzionbreslov.org` + the same path, keeping its MX/TXT mail
      records. Browsers don't keep a 302, so this part can still be undone.
      *Undo:* delete that rule, and .com serves WordPress again. **This holds only while .com's web records still
      point at a WordPress host that still runs** (an open question below: what happens to the hosting).
      - If the records changed since the export, first put them back from `dns-com-before.txt`.
      - If that host no longer runs, deleting the rule leaves .com with nothing to serve. Keep the 302 until
        WordPress runs again: restore the site from the WordPress backup to a host, point .com's web records at it,
        and only then delete the rule.
   2. **A 301 once the move is stable:** when the owner decides nothing will be rolled back (e.g. after some weeks),
      change that rule's status to 301.
      - **From here on, go-live is one-way.** Browsers keep .com → .org for good, so re-creating .org's 302 → .com
        (step 9's undo) would make a redirect loop.
      - *Undo:* set the rule back to 302. That only helps browsers that haven't followed the 301 yet.
   3. **SPF + DMARC for .com;** it has neither today, at Wix DNS.
      1. Start DMARC at `p=none` with a report address.
      2. List every service that sends as @tzionbreslov.com (Google Workspace? WordPress/Gravity Forms
         notifications? newsletters?).
      3. Publish one SPF covering exactly those.
      4. Then tighten DMARC to `quarantine`/`reject`.

      *Undo:* put back the records exported in `dns-com-before.txt`.

*Verify:* step 11.

*Undo, the forward steps in reverse.* **Only before 9.6.2:** once .com answers with a 301, there is no undo (see
9.6.2).
1. If 9.6.1 ran, delete .com's 302 first (its undo, with its condition: a WordPress host that still runs): with
   both redirects in place, .org → .com → .org would loop.
2. If the forms are on, undo step 10 first.
3. Switch the records to DNS-only. GitHub keeps serving the site.
4. Re-create the 302 rule from the export with **Place at: First**, above step 6's three 301 rules. At "Last", the
   301s would match first: `/resources/` would get a 301 that browsers cache for good, then land on .com, where the
   page doesn't exist. While the records are DNS-only, the rule does nothing yet.
5. Set the records back to the exported placeholders, proxied. The 302 now catches everything, so .org goes back to
   WordPress. Restoring the placeholders before the 302 exists would send visitors to `192.0.2.1` (Cloudflare 52x
   errors).
6. Remove the custom domain in Settings → Pages.
7. `gh variable delete NEXT_PUBLIC_SITE_URL`, then `gh workflow run deploy-github-pages.yml --ref main`.

Browsers keep the 301s they followed from step 6. Those land on .org pages, which then 302 to .com, where they
don't exist.

*Open questions (the repository doesn't describe these):*
- how and when tzionbreslov.com's DNS moves from Wix to Cloudflare, and from which account;
- which services send mail as @tzionbreslov.com;
- what happens to the WordPress hosting once .com redirects;
- whether the zone's plan offers a Network Error Logging switch (step 7).

#### 10. Forms on

*Changes:* four forms start sending to the Worker, with Turnstile:
- the contact form;
- the footer newsletter signup;
- the Events page's RSVP buttons;
- "Get event announcements".

**How the code decides:** it is decided at build time from two repository variables that the deploy's Build step
passes in (`lib/client/config.ts`).
- A form is live only when **both** `NEXT_PUBLIC_API_BASE_URL` and `NEXT_PUBLIC_TURNSTILE_SITE_KEY` are set
  (`lib/client/forms.ts`, `rsvp.ts`, `announcements.ts`).
- With either one missing, the forms show "temporarily unavailable — email us" (RSVPs: "RSVPs open when the new site
  launches…").
- Without the API address, the Events page doesn't ask for availability, and the confirm-subscription page says
  signups are unavailable.

**Only after step 9:**
- the Worker accepts `https://tzionbreslov.org` (+www) only, and the Turnstile widget only runs on those hostnames,
  so on github.io the forms would break on the only live copy;
- after the privacy check passes, or the owner's NEL choice is in the notice (steps 7 and 9.5);
- after the owner has approved the privacy notice.

*Owner's go-ahead.*

1. `gh variable set NEXT_PUBLIC_API_BASE_URL --body "https://api.tzionbreslov.org"`
2. `gh variable set NEXT_PUBLIC_TURNSTILE_SITE_KEY --body "0x4AAAAAAF1kfPJ0qES50FAh"` (the widget "Tzion Breslov
   forms": tzionbreslov.org + www)
3. `gh workflow run deploy-github-pages.yml --ref main`

*Verify:*
- `/contact/` shows the Turnstile check under the form.
- Step 11's test sign-ups go through.

*Undo:* the forms go back to "temporarily unavailable".
1. `gh variable delete NEXT_PUBLIC_API_BASE_URL`
2. `gh variable delete NEXT_PUBLIC_TURNSTILE_SITE_KEY`
3. `gh workflow run deploy-github-pages.yml --ref main`

#### 11. After the switch: smoke test

*Changes:* nothing, except the test sign-ups, which the owner removes afterwards.

1. **RSVPs:** `node scripts/check-rsvp-availability.mjs` must print "RSVPs OK".
   - It checks that every upcoming event that takes RSVPs in `https://tzionbreslov.org/events.json` is listed by
     `https://api.tzionbreslov.org/v1/rsvp/availability`, and that the answer says `"ok": true`. A 200 alone isn't
     enough: with every event skipped it would list none.
   - It fails at once if either address doesn't answer a plain 200 (the Worker never follows a redirect), or if the
     answer lacks `"ok": true`.
   - Right after a redeploy of the site, the Worker can still hold the previous events for up to 90 s (its 60 s feed
     cache, then the 30 s shared availability answer). So while events are missing, it says so and checks again every
     30 s, up to 2 minutes, before it fails.
   - It exits with 2 when no upcoming event takes RSVPs: add one to the calendar, redeploy, and check again.
2. **Health:** `curl -s "https://api.tzionbreslov.org/health"` → `{"ok":true}` (PowerShell: `curl.exe`).
3. **Privacy page:** `curl -sI "https://tzionbreslov.org/privacy/"` answers 200. In a browser it shows "Last updated …"
   and its six sections, and the footer's Privacy link opens it.
4. **CSP, live:** `node scripts/check-csp.mjs https://tzionbreslov.org` and
   `node scripts/check-csp.mjs https://www.tzionbreslov.org` must report zero violations.
5. **Redirects:** the eleven addresses in step 6 answer 301 with their `location`, and the five addresses it says no
   rule catches answer without a 301.
6. **Test sign-ups**, each with an address the owner reads:
   - **Event announcements:** on `/events/`, "Get event announcements" with **only** "Event announcements" ticked.
     - The confirmation email arrives; "Confirm my subscription" on the site succeeds.
     - In Resend → Audience the contact is on "Event announcements" only. This is the one path that uses
       `RESEND_EVENTS_TOPIC_ID`.
     - Then delete the test contact in Resend.
   - **Contact form:** the message arrives at the inbox, replying to the visitor.
   - **RSVP:** an RSVP to an upcoming event.
     - "RSVP received" reaches the visitor, and "New RSVP" reaches the inbox.
     - It counts toward a limit. It is deleted with the event's other RSVPs once the event is over. To remove it at
       once:
       `npx wrangler d1 execute tzion-breslov-production --remote --command "DELETE FROM rsvps WHERE email = lower('<test-address>');"`
7. **Log probe again:** with real traffic flowing, repeat step 4's log-probe check (a new probe string). Any stored
   line from the test sign-ups must hold only the Worker's own fields.
8. **`RSVP_CLEANUP_FEED_UNAVAILABLE`:** expected every day only between step 4 and go-live.
   - From the first clean-up after step 9 (03:17 UTC), Observability shows no new line with that code.
   - If it still appears, `https://tzionbreslov.org/events.json` isn't a plain 200. Check with
     `curl -sI "https://tzionbreslov.org/events.json"`.

Then update PROJECT_MEMORY.md ("Cloudflare state", Status) with what changed and each undo value, in the switch-day
pull request.

## Security headers

`config/security-headers.mjs` is the source of truth; Cloudflare's Transform Rule `tzion_security_headers` must match it.
Any new third-party origin (e.g. PayPal) goes there first, then `npm run build && node scripts/check-csp.mjs` (serves
`out/` with the headers enforced, visits every page and the interactive islands, fails on any violation), then the
Cloudflare rule. The Contact page's map added `https://www.google.com` to frame-src; the Cloudflare rule gains it on
switch day (step 5, which also drops `https://www.youtube.com`).

## Launch checklist

1. ✅ **Resend** (2026-11-06, `node scripts/setup-resend.mjs`): sending domain tzionbreslov.org **verified** (DKIM
   `resend._domainkey`, return path `send` MX + SPF, `rsend` CNAME — all on Cloudflare), "Newsletter" topic (default
   opt-out: nobody is subscribed until they confirm), webhook → `https://api.tzionbreslov.org/webhooks/resend`
   (bounces, complaints, failures, suppressions, topic changes), and a **send-only** key restricted to the domain for
   `RESEND_TRANSACTIONAL_API_KEY` (the owner's full-access key is `RESEND_CONTACTS_API_KEY`, needed for Contacts).
   Still to do by hand in Resend: set Reply-To `tzionbreslovproject@gmail.com` in broadcast settings (the domain has no
   MX by choice; the Worker already sets it on confirmation emails).
2. ✅ **Worker deployed** (2026-11-06) at `https://api.tzionbreslov.org` with all 8 secrets and the daily cleanup cron;
   smoke-tested live (health, CORS allow/deny, Turnstile rejects fake tokens, confirm link redirects, unsigned webhook
   refused). Secrets persist across deploys, so later code changes need only `npm run worker:deploy`. The secrets live
   in the git-ignored `.env.worker` (owner's machine) and in Cloudflare; `TURNSTILE_SECRET_KEY` exists **only** in
   Cloudflare (copied from the widget) — never put it in `.env.worker`, or `--secrets-file` would overwrite it.
   To rotate a value: `npx wrangler secret put NAME`.
   **Except the RSVP release (Task 8, not deployed yet):** its code needs migration 0002 and the secret
   `RESEND_EVENTS_TOPIC_ID` *before* `npm run worker:deploy` (deployed first, it would break the newsletter signup and the
   daily cleanup). Follow Switch day, steps 1–4.
3. **Turn the forms on only on switch day** (Switch day, step 10). The Worker accepts requests from
   `https://tzionbreslov.org` (+www) only and Turnstile only runs there, so setting `NEXT_PUBLIC_API_BASE_URL` +
   `NEXT_PUBLIC_TURNSTILE_SITE_KEY` while the site is still served from github.io would break the forms on the only live
   copy. Until then they show "temporarily unavailable — email us".
4. Switch day (above), in its order, including the Cloudflare 301 redirects for the removed addresses (step 6):
   `/resources/` and `/video/…` → `/classes/`, `/resources/page/N/`, `/category/…` and `/author/…` → `/articles/`,
   `/about/` → `/about-us/`, each also without its final slash.
5. Wire PayPal in `lib/client/donations.ts` (add its origins to `config/security-headers.mjs` first), and confirm that
   `PAYPAL_AUTOPAY_URL` there is where the owner's monthly donors manage their gift.

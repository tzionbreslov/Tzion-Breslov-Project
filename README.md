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
  from its `siteRoutes()`, so a re-import can't bring a removed page back; the wording check skips `isRemovedPath()`
  pages; `write-site-files.mjs` drops removed pages and sitemaps from the sitemaps and adds the `NEW_ROUTES`; the export
  check fails on any link, sitemap entry or structured-data URL that still points at a removed page, and on any plain
  YouTube embed. `visual-diff.mjs` keeps its own fixed page list.
- `lib/navigation.mjs` — the menus: the header's desktop and mobile menus and the footer Quick Links are rendered into
  the imported header/footer HTML for each page (`NAV`: Home · About · Resources ▾ Classes, Articles · Events ·
  Gallery · Contact, then Donate and Taste a Class in the mobile menu and footer). `ORIGINAL_NAV` is the WordPress
  menu, which `scripts/navigation.test.mjs` proves renders every imported fragment byte for byte. The Resources dropdown runs on
  `lib/client/menu.ts` (mouse, touch, keyboard) and `app/navigation.css` (also opens on hover/focus without JS).
- `lib/pages/` — the composed pages (today `/articles/`, `/articles/page/2/`, `/classes/`, `/gallery/` and
  `/events/`), built from Tzion's own markup: `parts.ts` cuts the hero, the Articles grid and the closing sections verbatim out of `content/pages/resources*.json`,
  `compose.ts` wraps them in the Resources page's stylesheets, scripts, header and footer with their own title,
  description and canonical URL, and `registry.ts` maps each `tz:` key to its builder. `contact-map.ts` adds the map
  (Google Maps pinned on Bet Shemesh, with directions) to the imported Contact page, right after its form and cards.
  Their new English text lives only in `content/copy/en.json`.
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
  - Donate page → `components/donate-form.tsx` (**PayPal not wired yet** — see `lib/client/donations.ts`)
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
| `npm run check` | Typecheck (site + Worker), lint, unit tests (`scripts/**/*.test.mjs`), Worker tests, build, export check, wording check against checkpoint-001, browser tests (Playwright on `out/` with the enforced CSP) |
| `npm run sync:instagram` | Dormant (Instagram is switched off): pull the latest Instagram posts + photos (needs `INSTAGRAM_ACCESS_TOKEN` / `INSTAGRAM_USER_ID`; see docs/instagram-setup.md) |
| `npm run sync:youtube` | Pull the latest uploads from the channel RSS feed into `content/youtube.json` (outage-tolerant; `-- --strict` to fail instead) |
| `npm run sync:events` | Pull the upcoming events from the Google Calendar at `GOOGLE_CALENDAR_ICAL_URL` into `content/events.json` (outage-tolerant; `-- --strict` to fail instead; never commit the result) |
| `npm run worker:dev` | Forms API at http://localhost:8787 (copy `.dev.vars.example` → `.dev.vars`) |
| `node scripts/visual-diff.mjs` | Pixel-compare against the WordPress reference (needs it running) |
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
(`POST /v1/rsvp`, `GET /v1/rsvp/availability`; RSVPs are deleted 90 days after the event, `RSVP_RETENTION_DAYS`).
The RSVP route, migration 0002 and the "Event announcements" Resend topic are built and tested but **not deployed**:
they go live on switch day (step 6 below, with each step's undo). Owner steps and details:
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

## Configuration (GitHub → Settings → Secrets and variables → Actions → **Variables**)

All public, build-time values:

- `NEXT_PUBLIC_SITE_URL` — the site's public origin for canonical links, social cards, structured data, sitemaps and
  `robots.txt`. Unset = `https://tzionbreslov.com` (where WordPress still lives); set to `https://tzionbreslov.org` on
  switch day.
- `NEXT_PUBLIC_API_BASE_URL` — `https://api.tzionbreslov.org` once the Worker has its Resend secrets
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY` — `0x4AAAAAAF1kfPJ0qES50FAh` (widget "Tzion Breslov forms", tzionbreslov.org + www)
- `NEXT_PUBLIC_PAYPAL_CLIENT_ID` — when PayPal checkout is wired
- `GOOGLE_CALENDAR_ICAL_URL` — the Events calendar's public iCal address (`…/public/basic.ics`, docs/EVENT_CALENDAR.md);
  read by the deploy's calendar sync, not by the site itself

Without the first two, the forms show a "temporarily unavailable — email us" message instead of failing silently.
Worker secrets go in Cloudflare (`wrangler secret put …`), never in GitHub. See `SECURITY.md`.

## Domains and Cloudflare

**tzionbreslov.org** (Cloudflare Registrar + DNS, account `tzionbreslovproject@gmail.com`) is the site's future home.
**tzionbreslov.com** is still the WordPress site at the old host. Until the switch:

| Piece | State |
|---|---|
| `tzionbreslov.org`, `www` | Proxied placeholder records (`192.0.2.1`, `100::`) + redirect rule **302** → `https://tzionbreslov.com` + same path. 302, not 301: a cached 301 would loop once .com later redirects to .org. |
| Zone security | Always HTTPS, TLS ≥ 1.2, DNSSEC, SSL Full (strict) for the zone plus a Configuration Rule giving the two site hosts SSL **Full** (see switch day, step 3), security headers via Transform Rule (CSP **report-only**) — values from `config/security-headers.mjs` |
| Email | `v=spf1 -all` + DMARC `p=reject` (nothing may send as @tzionbreslov.org; Resend's DKIM still aligns later). No MX: inbound mail is declined, so the Worker sets a Reply-To on its emails. |
| Forms API | D1 `tzion-breslov-production` (schema applied), Turnstile widget (site key above). Worker `tzion-breslov-api` → `api.tzionbreslov.org` deploys with `npm run worker:deploy` |
| GitHub Pages preview | `tzionbreslov.github.io/Tzion-Breslov-Project/` (canonical links still point at the real domain) |

### Before switch day (any time, owner account)

**Verify the domain with GitHub first**, so nobody else's Pages site can ever claim it: owner profile → Settings → Pages →
*Verified domains* → Add `tzionbreslov.org`, create the TXT record GitHub shows
(`_github-pages-challenge-tzionbreslov.tzionbreslov.org`) in Cloudflare, wait until it resolves, click *Verify*. **Keep that
TXT record forever** — removing it can drop the verification.

### Switch day (.com → .org)

1. **GitHub (owner account):** repo Settings → Pages → custom domain `tzionbreslov.org` (only after the domain shows *Verified*).
2. **GitHub variables:** `NEXT_PUBLIC_SITE_URL=https://tzionbreslov.org`; re-run *Deploy GitHub Pages*. (CI already builds
   and checks this variant on every PR.)
3. **Cloudflare DNS, in this order:**
   1. Replace the placeholders with GitHub Pages records, **DNS-only**: apex `A` 185.199.108.153 / .109 / .110 / .111,
      `AAAA` 2606:50c0:8000::153 / 8001::153 / 8002::153 / 8003::153, `www` CNAME `tzionbreslov.github.io`. (Change DNS
      *before* touching the redirect rule — DNS-only traffic never hits it, while deleting it first would send visitors
      to the placeholder address.)
   2. When repo Settings → Pages shows the certificate, tick *Enforce HTTPS*, then **delete the 302 redirect rule** (it
      must be gone before re-proxying, or it would loop once .com 301s to .org).
   3. Switch the records to proxied. The Configuration Rule "tzion_github_pages_origin_ssl_full" (already created) makes
      Cloudflare use SSL **Full** for the site hosts: GitHub reports proxied domains as not HTTPS-eligible and may fail
      to renew its certificate, and under Full (strict) that would turn every page into a 526. Ruach Breslov runs the
      same way. Do not put these hosts back on strict unless
      `gh api repos/tzionbreslov/Tzion-Breslov-Project/pages --jq .https_certificate` shows a valid certificate for
      tzionbreslov.org with > 30 days left.
4. **Cloudflare 'Tzion security headers' rule must gain `https://www.google.com` in frame-src on switch day (owner
   go-ahead)** — the Contact page's map; copy the policy from `config/security-headers.mjs` (`CSP_REPORT_ONLY` while
   the header is still report-only). Undo: put back the rule's previous value.
   **Verify live:** `node scripts/check-csp.mjs https://tzionbreslov.org` (and `https://www.tzionbreslov.org`) must report
   zero violations; then rename the header to `Content-Security-Policy` with the value of `CSP` (it re-adds
   `upgrade-insecure-requests`) and stage HSTS (short max-age first).
5. **tzionbreslov.com:** once its DNS is on Cloudflare, 301 every path to `https://tzionbreslov.org`, keeping its MX/TXT
   mail records — and give it SPF + DMARC (it has neither today, at Wix DNS): start DMARC at `p=none` with a report
   address, list every service that sends as @tzionbreslov.com (Google Workspace? WordPress/Gravity Forms
   notifications? newsletters?), publish one SPF covering exactly those, then tighten DMARC to `quarantine`/`reject`.
6. **RSVPs and "Event announcements" (Task 8, owner go-ahead), in this order.** Migration 0002 must come before the
   deploy: the new Worker writes `subscription_confirmations.topics_json` and its daily cleanup deletes from `rsvps`.
   SQL below runs with `npx wrangler d1 execute tzion-breslov-production --remote --command "<SQL>"` (or in the
   dashboard's D1 console). Every statement here holds only single quotes (no `"`, `$`, backtick or `!`), so it
   reaches D1 unchanged inside `--command "…"` in bash and in PowerShell; each was rehearsed that way with `--local`.
   1. **Any time before:** `npx wrangler deploy --dry-run --outdir .tmp/worker-dry-run` bundles the Worker (with
      `lib/events.mjs` and its `content/copy/en.json` import) and checks `wrangler.jsonc`; it changes nothing live.
   2. **Topic:** `node scripts/setup-resend.mjs` (the full-access key in `.env.worker`) creates "Event announcements"
      and writes `RESEND_EVENTS_TOPIC_ID` to `.env.worker`. *Undo:* delete the topic in Resend (Audience → Topics, or
      `DELETE https://api.resend.com/topics/<id>`) and that line.
   3. **Secret:** `npx wrangler secret put RESEND_EVENTS_TOPIC_ID` (9 secrets; `TURNSTILE_SECRET_KEY` stays only in
      Cloudflare). *Undo (after step 5's undo):* `npx wrangler secret delete RESEND_EVENTS_TOPIC_ID`.
   4. **Migration:** note a bookmark (`npx wrangler d1 time-travel info tzion-breslov-production`), then
      `npx wrangler d1 migrations apply tzion-breslov-production --remote` (0002 only: additive, the running Worker
      ignores it). *Undo (only after step 5's undo, including its DELETE, which needs `topics_json`):* either
      - losing only the RSVPs: `DROP TABLE rsvps; ALTER TABLE subscription_confirmations DROP COLUMN topics_json;
        DELETE FROM d1_migrations WHERE name = '0002_rsvps_and_topics.sql';` (also drops the table's two indexes; every
        other row stays; 0002 can be applied again later), or
      - `npx wrangler d1 time-travel restore tzion-breslov-production --bookmark=<bookmark>`, which restores the whole
        database and loses every contact, signup and RSVP row written since.
   5. **Deploy:** note the current version (`npx wrangler deployments list`), then `npm run worker:deploy`; the vars
      `EVENTS_FEED_URL` and `RSVP_RETENTION_DAYS` ship with it, and so do **Workers Logs** (`observability` in
      `wrangler.jsonc`): from then on `RSVP_ORGANIZER_EMAIL_FAILED`, `RSVP_CANCEL_FAILED` and
      `EVENTS_FEED_EVENT_SKIPPED` are kept 7 days (dashboard → the Worker → Logs), each with a request id or a
      reason, never personal data. *Undo:* `npx wrangler rollback <version>`, then at once
      `DELETE FROM subscription_confirmations WHERE used_at IS NULL AND topics_json = json_array('events');` — the
      previous Worker confirms every signup into the Newsletter, so an events-only signup still pending (24 h) would
      land on a list its visitor never chose. Those visitors sign up again; a pending signup for both lists keeps the
      Newsletter.
   6. **After the switch:** `node scripts/check-rsvp-availability.mjs` must print "RSVPs OK": every upcoming event
      that takes RSVPs in `https://tzionbreslov.org/events.json` is listed by
      `https://api.tzionbreslov.org/v1/rsvp/availability` (a 200 alone isn't enough: with every event skipped it would
      list none). It fails if either address doesn't answer a plain 200 (the Worker never follows a redirect), and exits
      with 2 when no upcoming event takes RSVPs (add one to the calendar, redeploy, check again). Then turn the site's
      forms on (launch checklist, step 3).

## Security headers

`config/security-headers.mjs` is the source of truth; Cloudflare's Transform Rule "Tzion security headers" must match it.
Any new third-party origin (e.g. PayPal) goes there first, then `npm run build && node scripts/check-csp.mjs` (serves
`out/` with the headers enforced, visits every page and the interactive islands, fails on any violation), then the
Cloudflare rule. The Contact page's map added `https://www.google.com` to frame-src; the Cloudflare rule gains it on
switch day (step 4).

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
   daily cleanup). Follow switch day, step 6.
3. **Turn the forms on only on switch day.** The Worker accepts requests from `https://tzionbreslov.org` (+www) only and
   Turnstile only runs there, so setting `NEXT_PUBLIC_API_BASE_URL` + `NEXT_PUBLIC_TURNSTILE_SITE_KEY` while the site
   is still served from github.io would break the forms on the only live copy. Until then they show "temporarily
   unavailable — email us".
4. Switch day (above), plus Cloudflare 301 redirects for the removed addresses: `/resources/` and `/video/…` →
   `/classes/`, `/resources/page/N/`, `/category/…` and `/author/…` → `/articles/`, `/about/` → `/about-us/`.
5. Wire PayPal in `lib/client/donations.ts` (add its origins to `config/security-headers.mjs` first).

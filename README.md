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
  `tz:…`), imported pages that are removed (`REMOVED_PATHS`) and link rewrites. Next (`lib/content.ts`), the export and
  CSP checks and the browser smoke test take their route list from its `siteRoutes()`, so a re-import can't bring a
  removed page back; the wording check skips `isRemovedPath()` pages, and `page-sitemap.xml` gains the `NEW_ROUTES`.
  `visual-diff.mjs` and `compare-live.mjs` keep their own fixed page lists.
- `lib/pages/` — the composed pages (today `/articles/`, `/articles/page/2/` and `/classes/`), built from Tzion's own
  markup: `parts.ts` cuts the hero, the Articles grid and the closing sections verbatim out of `content/pages/resources*.json`,
  `compose.ts` wraps them in the Resources page's stylesheets, scripts, header and footer with their own title,
  description and canonical URL, and `registry.ts` maps each `tz:` key to its builder. Their new English text lives
  only in `content/copy/en.json`.
- `app/[[...slug]]` — one catch-all route renders every page; `app/global-not-found.tsx` is the 404.
- The original theme scripts (jQuery, GSAP animations, Spectra blocks, slick carousel) still run unchanged.
  React only adds the interactive pieces in `components/enhancers.tsx`:
  - contact + footer signup forms → `lib/client/forms.ts` → Worker API (`lib/api-contract.ts`)
  - Resources YouTube grid (lightbox, Load More) → `lib/client/youtube.ts`, data in `content/youtube.json`
  - Resources and Articles post-grid pagination → `lib/client/post-grid.ts` (no admin-ajax)
  - Classes video library (Videos/Shorts tabs, search, sort, on-page player) → `lib/client/video-library.ts` +
    `lib/client/dialog.ts`; ordering/search in `lib/video-library.mjs`, data in `content/youtube.json` (Videos, with
    the feed's view counts for "Most popular") and `content/shorts.json` (the old `/video/video-N/` clips)
  - Donate page → `components/donate-form.tsx` (**PayPal not wired yet** — see `lib/client/donations.ts`)

URLs are identical to WordPress (trailing slashes, `/wp-content/uploads/...`), Yoast's sitemaps and `robots.txt` are
republished at the same paths, and `/about/` redirects to `/about-us/`.

## Commands

| | |
|---|---|
| `npm run dev` | Next dev server at http://localhost:3000 |
| `npm run build` | Static export to `out/` |
| `node scripts/serve-out.mjs` | Serve `out/` like GitHub Pages at http://localhost:3100 |
| `npm run check` | Typecheck (site + Worker), lint, unit tests (`scripts/**/*.test.mjs`), Worker tests, build, export check, wording check against checkpoint-001, browser tests (Playwright on `out/` with the enforced CSP) |
| `npm run sync:instagram` | Pull the latest Instagram posts + photos (needs `INSTAGRAM_ACCESS_TOKEN` / `INSTAGRAM_USER_ID`; see docs/instagram-setup.md) |
| `npm run sync:youtube` | Pull the latest uploads from the channel RSS feed into `content/youtube.json` (outage-tolerant; `-- --strict` to fail instead) |
| `npm run worker:dev` | Forms API at http://localhost:8787 (copy `.dev.vars.example` → `.dev.vars`) |
| `node scripts/visual-diff.mjs` | Pixel-compare against the WordPress reference (needs it running) |
| `node scripts/compare-live.mjs` | Compare the WordPress reference's text/images/links with the live site |
| `npm run rollback -- checkpoint-NNN` | Open a pull request that rolls every file back to a checkpoint (`--dry-run` to only list what it undoes); see ROLLBACK.md |

## Checkpoints and rollback

Every merge into `main` is tagged `checkpoint-NNN` with a Release listing its changes; checkpoints can't be moved or
deleted. How to roll the preview back right away, or for good: [ROLLBACK.md](ROLLBACK.md).

## YouTube feed (Resources and Classes pages)

Source: the channel's public RSS feed,
`https://www.youtube.com/feeds/videos.xml?channel_id=UC69mDA498p7l9GGBdaUdkkA` (latest 15 uploads, no API key).
The deploy workflow refreshes it at build time and runs daily (04:41 UTC), so new uploads appear within a day without a
commit. Videos that scroll out of the feed's 15-entry window only stay listed if they are in the committed
`content/youtube.json` — run `npm run sync:youtube` and commit occasionally to archive them. YouTube's RSS endpoint is
intermittently unavailable (it returned 404 on 2026-11-06); the sync then keeps the committed list and only warns.

## Instagram tab (Resources page)

An owner-requested addition (WordPress never had it): latest posts from @tzionbreslovproject in a 4th Resources tab,
with an in-site preview that leads to instagram.com. Data comes from Meta's official API at build time
(`npm run sync:instagram`, photos copied onto the site); until the account is connected the tab shows the profile and
a link. **Setup and token care: [docs/instagram-setup.md](docs/instagram-setup.md).**

## Editing content

Pages are WordPress HTML in `content/pages/<slug>.json` (`main`). Edit the HTML there (keep the class names — the
original CSS depends on them), or change the shared header/footer in `content/fragments/`. Re-running the importer
overwrites `content/` from the WordPress snapshot, so only do that while WordPress is still the source of truth.

## Configuration (GitHub → Settings → Secrets and variables → Actions → **Variables**)

All public, build-time values:

- `NEXT_PUBLIC_SITE_URL` — the site's public origin for canonical links, social cards, structured data, sitemaps and
  `robots.txt`. Unset = `https://tzionbreslov.com` (where WordPress still lives); set to `https://tzionbreslov.org` on
  switch day.
- `NEXT_PUBLIC_API_BASE_URL` — `https://api.tzionbreslov.org` once the Worker has its Resend secrets
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY` — `0x4AAAAAAF1kfPJ0qES50FAh` (widget "Tzion Breslov forms", tzionbreslov.org + www)
- `NEXT_PUBLIC_PAYPAL_CLIENT_ID` — when PayPal checkout is wired

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
4. **Verify live:** `node scripts/check-csp.mjs https://tzionbreslov.org` (and `https://www.tzionbreslov.org`) must report
   zero violations; then rename the header to `Content-Security-Policy` with the value of `CSP` (it re-adds
   `upgrade-insecure-requests`) and stage HSTS (short max-age first).
5. **tzionbreslov.com:** once its DNS is on Cloudflare, 301 every path to `https://tzionbreslov.org`, keeping its MX/TXT
   mail records — and give it SPF + DMARC (it has neither today, at Wix DNS): start DMARC at `p=none` with a report
   address, list every service that sends as @tzionbreslov.com (Google Workspace? WordPress/Gravity Forms
   notifications? newsletters?), publish one SPF covering exactly those, then tighten DMARC to `quarantine`/`reject`.

## Security headers

`config/security-headers.mjs` is the source of truth; Cloudflare's Transform Rule "Tzion security headers" must match it.
Any new third-party origin (e.g. PayPal) goes there first, then `npm run build && node scripts/check-csp.mjs` (serves
`out/` with the headers enforced, visits every page and the interactive islands, fails on any violation), then the
Cloudflare rule.

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
3. **Turn the forms on only on switch day.** The Worker accepts requests from `https://tzionbreslov.org` (+www) only and
   Turnstile only runs there, so setting `NEXT_PUBLIC_API_BASE_URL` + `NEXT_PUBLIC_TURNSTILE_SITE_KEY` while the site
   is still served from github.io would break the forms on the only live copy. Until then they show "temporarily
   unavailable — email us".
4. Switch day (above), plus a Cloudflare redirect `/about/` → `/about-us/` (301).
5. Wire PayPal in `lib/client/donations.ts` (add its origins to `config/security-headers.mjs` first).

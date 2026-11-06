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
- `app/[[...slug]]` — one catch-all route renders every page; `app/global-not-found.tsx` is the 404.
- The original theme scripts (jQuery, GSAP animations, Spectra blocks, slick carousel) still run unchanged.
  React only adds the interactive pieces in `components/enhancers.tsx`:
  - contact + footer signup forms → `lib/client/forms.ts` → Worker API (`lib/api-contract.ts`)
  - Resources YouTube grid (lightbox, Load More) → `lib/client/youtube.ts`, data in `content/youtube.json`
  - Resources post-grid pagination → `lib/client/post-grid.ts` (no admin-ajax)
  - Donate page → `components/donate-form.tsx` (**PayPal not wired yet** — see `lib/client/donations.ts`)

URLs are identical to WordPress (trailing slashes, `/wp-content/uploads/...`), Yoast's sitemaps and `robots.txt` are
republished at the same paths, and `/about/` redirects to `/about-us/`.

## Commands

| | |
|---|---|
| `npm run dev` | Next dev server at http://localhost:3000 |
| `npm run build` | Static export to `out/` |
| `node scripts/serve-out.mjs` | Serve `out/` like GitHub Pages at http://localhost:3100 |
| `npm run check` | Typecheck, lint, Worker tests, build, export check |
| `npm run sync:youtube` | Pull the latest uploads from the channel RSS feed into `content/youtube.json` (outage-tolerant; `-- --strict` to fail instead) |
| `npm run worker:dev` | Forms API at http://localhost:8787 (copy `.dev.vars.example` → `.dev.vars`) |
| `node scripts/visual-diff.mjs` | Pixel-compare against the WordPress reference (needs it running) |
| `node scripts/compare-live.mjs` | Compare the WordPress reference's text/images/links with the live site |

## YouTube feed (Resources page)

Source: the channel's public RSS feed,
`https://www.youtube.com/feeds/videos.xml?channel_id=UC69mDA498p7l9GGBdaUdkkA` (latest 15 uploads, no API key).
The deploy workflow refreshes it at build time and runs daily (04:41 UTC), so new uploads appear within a day without a
commit. Videos that scroll out of the feed's 15-entry window only stay listed if they are in the committed
`content/youtube.json` — run `npm run sync:youtube` and commit occasionally to archive them. YouTube's RSS endpoint is
intermittently unavailable (it returned 404 on 2026-11-06); the sync then keeps the committed list and only warns.

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
| Zone security | Always HTTPS, TLS ≥ 1.2, SSL Full (strict), security headers via Transform Rule (CSP **report-only**) — values from `config/security-headers.mjs` |
| Email | `v=spf1 -all` + DMARC `p=reject` (nothing may send as @tzionbreslov.org; Resend's DKIM still aligns later) |
| Forms API | D1 `tzion-breslov-production` (schema applied), Turnstile widget (site key above). Worker `tzion-breslov-api` → `api.tzionbreslov.org` deploys with `npm run worker:deploy` |
| GitHub Pages preview | `tzionbreslov.github.io/Tzion-Breslov-Project/` (canonical links still point at the real domain) |

### Switch day (.com → .org)

1. **GitHub (owner account):** Settings → Pages → custom domain `tzionbreslov.org`. Also verify the domain under the
   owner's Settings → Pages → *Verified domains* (TXT `_github-pages-challenge-tzionbreslov`) so nobody else can claim it.
2. **GitHub variables:** `NEXT_PUBLIC_SITE_URL=https://tzionbreslov.org`; re-run *Deploy GitHub Pages*.
3. **Cloudflare DNS:** delete the redirect rule; replace the placeholders with GitHub Pages records, **DNS-only** at first
   so GitHub can issue its certificate — apex `A` 185.199.108.153 / .109 / .110 / .111, `AAAA` 2606:50c0:8000::153 /
   8001 / 8002 / 8003, `www` CNAME `tzionbreslov.github.io`. When Pages shows the certificate, tick *Enforce HTTPS*,
   then switch the records to proxied (SSL Full (strict) is already set).
4. **Verify live**, then turn the CSP from `Content-Security-Policy-Report-Only` into `Content-Security-Policy` and stage
   HSTS (short max-age first). `node scripts/check-csp.mjs` must pass before any CSP change.
5. **tzionbreslov.com:** once its DNS is on Cloudflare, 301 every path to `https://tzionbreslov.org` (keep its MX/TXT mail records).

## Security headers

`config/security-headers.mjs` is the source of truth; Cloudflare's Transform Rule "Tzion security headers" must match it.
Any new third-party origin (e.g. PayPal) goes there first, then `npm run build && node scripts/check-csp.mjs` (serves
`out/` with the headers enforced, visits every page and the interactive islands, fails on any violation), then the
Cloudflare rule.

## Launch checklist (not done yet)

1. Resend: verify the sending domain tzionbreslov.org (adds its DKIM + `send.` records), create the "newsletter" topic,
   then set the Worker's Resend secrets and `npm run worker:deploy`. Only then set `NEXT_PUBLIC_API_BASE_URL` and
   `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (until then the forms show "temporarily unavailable — email us").
2. Switch day (above), plus a Cloudflare redirect `/about/` → `/about-us/` (301).
3. Wire PayPal in `lib/client/donations.ts` (add its origins to `config/security-headers.mjs`).

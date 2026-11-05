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
| `npm run sync:youtube` | Pull the latest channel uploads into `content/youtube.json` |
| `npm run worker:dev` | Forms API at http://localhost:8787 (copy `.dev.vars.example` → `.dev.vars`) |
| `node scripts/visual-diff.mjs` | Pixel-compare against the WordPress reference (needs it running) |
| `node scripts/compare-live.mjs` | Compare the WordPress reference's text/images/links with the live site |

## Editing content

Pages are WordPress HTML in `content/pages/<slug>.json` (`main`). Edit the HTML there (keep the class names — the
original CSS depends on them), or change the shared header/footer in `content/fragments/`. Re-running the importer
overwrites `content/` from the WordPress snapshot, so only do that while WordPress is still the source of truth.

## Configuration (GitHub → Settings → Secrets and variables → Actions → **Variables**)

All public, build-time values:

- `NEXT_PUBLIC_API_BASE_URL` — `https://api.tzionbreslov.com` once the Worker is deployed
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY` — Cloudflare Turnstile site key for tzionbreslov.com
- `NEXT_PUBLIC_PAYPAL_CLIENT_ID` — when PayPal checkout is wired

Without the first two, the forms show a "temporarily unavailable — email us" message instead of failing silently.
Worker secrets go in Cloudflare (`wrangler secret put …`), never in GitHub. See `SECURITY.md`.

## Launch checklist (not done yet)

1. Deploy the Worker: create the D1 database, fill `account_id`/`database_id` in `wrangler.jsonc`, set secrets,
   `npm run db:migrate:remote`, `npm run worker:deploy`.
2. Resend: verify the sending domain, create the "newsletter" topic. Turnstile: create a widget for the two hostnames.
3. Move DNS for tzionbreslov.com to Cloudflare (preserve MX/TXT mail records), point the apex + `www` at GitHub Pages,
   set the custom domain in the repo's Pages settings, and add a redirect rule `/about/` → `/about-us/` (301).
4. Wire PayPal in `lib/client/donations.ts`.

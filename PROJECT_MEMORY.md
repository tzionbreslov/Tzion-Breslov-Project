# Project memory — Tzion Breslov website

## Decisions (owner-confirmed)

- 2026-11-05 — Rebuild tzionbreslov.com (WordPress 7.1.4, Genesis + `tzionbreslov` child theme, Spectra, Gravity
  Forms, Yoast, Smash Balloon YouTube feed) as an **exact** Next.js copy, using the Ruach Breslov project as the
  template: GitHub Pages + Cloudflare (DNS + forms Worker). A Go version was considered and dropped.
- 2026-11-05 — Donate page: replace the Gravity Forms/PayPal form with a better donation chooser built from the same
  options ($100/$150/$300/$600/other, monthly/one-time, dedication, name, email). **PayPal is wired later.**
- 2026-11-05 — Contact + newsletter forms use the Ruach-style Cloudflare Worker (D1 + Turnstile + Resend, double
  opt-in) at `api.tzionbreslov.com` instead of Gravity Forms/Mailchimp.
- 2026-11-05 — GitHub repo: `tzionbreslov/Tzion-Breslov-Project` (public). Only approved collaborators may change it.
- 2026-11-05 — Domain has not been moved to Cloudflare yet; no Cloudflare resources created yet.

## Status

- All 56 WordPress URLs + 404 + `/about/` redirect exported. Visual diff vs the WordPress reference: 0.00–0.02% on
  every template at 1440px and 390px; Resources is 0.00% vs the live site (local WordPress feed cache is stale).
- WordPress reference content verified identical to live (text, images, links) on all 57 pages
  (`scripts/compare-live.mjs`).
- Worker: 26 tests pass; local end-to-end (CORS → Turnstile → validation) verified; real email untested (no Resend key).
- Known pre-existing theme bug kept for fidelity: `global.js` number counter throws on pages without `.numbers`
  (also on the live site).

## Local reference setup notes

- `.wpress` extracted with a small Node script (4377-byte headers per file; skip empty-name directory entries).
- Import needs `SET NAMES utf8mb4` (dump has none → mojibake), relaxed `sql_mode` (zero dates),
  `SERVMASK_PREFIX_` → `wp_`. All plugins and the theme are inactive in the dump and must be activated.
- Footer "Quick Links" is a `legacy-widget` block signed with the live salts → re-sign locally
  (`tools/wordpress-reference/resign-legacy-widgets.php`) or it silently renders nothing.
- Copy wp-content into the container (bind mounts on Docker Desktop made each page ~20 s).

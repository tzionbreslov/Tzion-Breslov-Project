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
- 2026-11-06 — main requires a PR with passing CI ("check"); force-push/deletion blocked (to be applied from the owner account).

## Cloudflare state (2026-11-06)

- DNS: proxied placeholders A 192.0.2.1 / AAAA 100:: / www CNAME apex; TXT SPF + _dmarc.
- Rules: single redirect "tzion_org_to_com_temporary" (302); response header transform "tzion_security_headers".
- Settings: always_use_https on, min TLS 1.2, SSL strict.
- D1 tzion-breslov-production 430c5c20-673d-4e3f-b186-18c8c00cbcd8 (0001 applied via API and recorded in d1_migrations).
- Turnstile "Tzion Breslov forms" site key 0x4AAAAAAF1kfPJ0qES50FAh (secret only in Cloudflare).
- Live WordPress bug found: the 18 Parasha posts' hero image points at the dead staging host tzionbreslov.estiwolo.com
  (404 on live). The rebuild serves the local copy instead (intentional difference from live).

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

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
  viewer. Between 1280 and 1439px the menu links have 10px side padding (not 15px) so the logo stays centred.
- WordPress reference content verified identical to live (text, images, links) on all 57 pages
  (`scripts/compare-live.mjs`).
- Worker: 34 tests pass; deployed and smoke-tested live (health/D1, CORS, Turnstile, confirm redirect, webhook
  signature). A real email has not been sent yet (needs a Turnstile token from tzionbreslov.org, i.e. switch day).
- Resend (owner's account): domain tzionbreslov.org verified; topic "Newsletter" 934b4bcd-a4a7-43ce-9310-8fac1cc4541c
  (default opt-out); webhook 3ade2dad-e974-4e65-ad11-4c3db16a9677; send-only key 82913060-a568-4518-8a2b-bef4f36255f5.
- GitHub: Pages preview live at https://tzionbreslov.github.io/Tzion-Breslov-Project/ (daily rebuild 04:41 UTC);
  Actions limited to GitHub-owned actions, read-only token, outside-contributor workflows need approval; wiki/projects
  off; secret scanning + push protection, Dependabot alerts/updates, private vulnerability reporting on.
- Instagram switched off with the Resources page (owner, 2026-11-06): no tab and no link (the footer icon stays). The
  sync script and tests stay dormant (`INSTAGRAM_ENABLED=false`; the deploy no longer syncs or caches the feed); turning
  it back on needs INSTAGRAM_ACCESS_TOKEN (secret) and INSTAGRAM_USER_ID / INSTAGRAM_API_VERSION (variables):
  docs/instagram-setup.md.
  The emailed confirmation link (GET) only redirects to the site (`?subscription=confirm#token=…`); the visitor's
  "Confirm my subscription" click POSTs the token (mail scanners can't confirm). Confirmation emails reply to
  `RESEND_REPLY_TO_EMAIL` (tzionbreslovproject@gmail.com) because tzionbreslov.org has no MX by choice.
- Known pre-existing theme bug kept for fidelity: `global.js` number counter throws on pages without `.numbers`
  (also on the live site).

## Local reference setup notes

- `.wpress` extracted with a small Node script (4377-byte headers per file; skip empty-name directory entries).
- Import needs `SET NAMES utf8mb4` (dump has none → mojibake), relaxed `sql_mode` (zero dates),
  `SERVMASK_PREFIX_` → `wp_`. All plugins and the theme are inactive in the dump and must be activated.
- Footer "Quick Links" is a `legacy-widget` block signed with the live salts → re-sign locally
  (`tools/wordpress-reference/resign-legacy-widgets.php`) or it silently renders nothing.
- Copy wp-content into the container (bind mounts on Docker Desktop made each page ~20 s).

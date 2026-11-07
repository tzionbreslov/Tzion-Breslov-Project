# Checkpoints and rolling back

Every change to the site is recorded as a **checkpoint** that the site can be rolled back to (owner rule, 2026-11-06).

## What a checkpoint is

- Each change is its own pull request. When it is merged into `main`, the **Checkpoint** workflow
  (`.github/workflows/checkpoint.yml`) tags that exact version `checkpoint-NNN` and publishes a
  [Release](https://github.com/tzionbreslov/Tzion-Breslov-Project/releases) that lists what changed since the previous
  checkpoint and how to come back to it.
- Checkpoints can't be moved or deleted by anyone but the owner (ruleset "Protect checkpoints"), so a checkpoint always
  means the same version.
- `checkpoint-001` is the site before the site-structure work (2026-11-06).
- The scheduled rebuilds don't create checkpoints: they change no files, only refresh the YouTube videos (and later the
  calendar) from their public feeds.

## Roll the preview back right away

For when something is visibly broken and has to go back now:

1. GitHub → **Actions** → **Deploy GitHub Pages** → **Run workflow**.
2. **Use workflow from** → **Tags** → pick the checkpoint (for example `checkpoint-007`) → **Run workflow**.

That checkpoint's code is built and published in a few minutes. It is temporary: the next merge or scheduled rebuild
builds `main` again, so also do the next section.

## Roll back for good

```bash
npm run rollback -- checkpoint-007 --dry-run   # lists the changes that would be undone; changes nothing
npm run rollback -- checkpoint-007             # opens a pull request "Roll back to checkpoint-007"
```

The pull request makes every file exactly what it was at that checkpoint (files added since are removed; ignored files
such as `.env.worker` are never touched). When its "check" passes, merge it: the site redeploys and the rollback is
recorded as a new checkpoint, so it can itself be undone the same way.

To undo **one** change but keep everything after it, revert just that pull request instead (GitHub → the merged pull
request → **Revert**), which opens a new pull request.

## Live services (outside GitHub)

These are only changed with the owner's go-ahead, and each change records its undo first, in the pull request. The
switch-day steps and the exact commands for each undo are in [README.md](README.md) → Switch day.

| Service | Before the change | To roll back |
|---|---|---|
| Forms Worker `tzion-breslov-api` | `npx wrangler deployments list` (note the newest version id) | If the site's forms are on (switch day, step 10), turn them off first and wait for that deploy: the old Worker would confirm every signup into the Newsletter and refuse RSVPs. Then `npx wrangler rollback <version-id>`. After the RSVP release (switch day, step 4), also run its events-only `DELETE FROM subscription_confirmations …` at once, and check the Worker's logging setting against the one recorded before. |
| Worker secrets | nothing to save: the values live in `.env.worker` (and `TURNSTILE_SECRET_KEY` only in Cloudflare) | `npx wrangler secret delete <NAME>`, only after rolling back the code that needs it (step 3) |
| D1 database `tzion-breslov-production` | `npx wrangler d1 time-travel info tzion-breslov-production` (note the bookmark) | a migration's own undo SQL (0002: switch day, step 2; loses only the RSVPs), or `npx wrangler d1 time-travel restore tzion-breslov-production --bookmark=<bookmark>` (the whole database: any minute in the last 30 days on Workers Paid, 7 on Workers Free) |
| Cloudflare rules: Transform Rule "Tzion security headers", redirect rules | export the phase's rules with the API into the pull request (switch day, steps 5 and 6) | put the exported rule value back; delete the added redirect rules (browsers keep a 301 they already followed) |
| Cloudflare DNS | export the zone's records with the API (BIND file) into the pull request (switch day, step 9) | in the order of switch day, step 9's undo: records DNS-only, re-create the exported 302 rule placed **first** (above the 301 rules), then restore the exported records. Only while tzionbreslov.com doesn't 301 to .org (step 9.6.2): after that, go-live is one-way. |
| Resend lists | nothing to save: changes are additive | delete the added topic (and its line in `.env.worker`). Once people have confirmed a topic, deleting it drops their choice: keep it unless the owner decides otherwise, and save its subscriber list first. |
| GitHub Actions variables | `gh variable list` | `gh variable delete <NAME>` (or set the old value), then re-run Deploy GitHub Pages. For `GOOGLE_CALENDAR_ICAL_URL`, also delete the `events-*` caches (switch day, step 8). |

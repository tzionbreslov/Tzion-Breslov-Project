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

These are only changed with the owner's go-ahead, and each change records its undo first:

| Service | Before the change | To roll back |
|---|---|---|
| Forms Worker `tzion-breslov-api` | `npx wrangler deployments list` (note the current version) | `npx wrangler rollback <version-id>` |
| D1 database `tzion-breslov-production` | `npx wrangler d1 time-travel info tzion-breslov-production` (note the bookmark) | `npx wrangler d1 time-travel restore tzion-breslov-production --bookmark=<bookmark>` (any minute in the last 30 days) |
| Cloudflare DNS / redirect rules | export the records or rule (dashboard or API) into the pull request | re-create the exported records / rule |
| Resend lists | nothing to save: changes are additive | delete the added topic |

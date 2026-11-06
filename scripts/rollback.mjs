#!/usr/bin/env node
// Roll the whole site back to a checkpoint, for good (see ROLLBACK.md).
//
//   npm run rollback -- checkpoint-007 --dry-run   # only list what would be undone
//   npm run rollback -- checkpoint-007             # branch + commit + push + pull request
//   npm run rollback -- checkpoint-007 --no-push   # branch + commit only (inspect locally first)
//
// main only accepts reviewed pull requests, so a rollback is a normal pull
// request: one commit that makes every tracked file exactly what it was at the
// checkpoint. Merging it redeploys the site and records a new checkpoint, so
// the rollback itself can be undone the same way. Ignored files (.env.worker,
// builds) are never touched.
import { execFileSync } from "node:child_process";
import { checkpointNumber, restoreTree } from "./lib/checkpoints.mjs";

const args = process.argv.slice(2);
const tag = args.find((a) => !a.startsWith("--"));
const dryRun = args.includes("--dry-run");
const noPush = args.includes("--no-push");

const run = (cmd, cmdArgs) => execFileSync(cmd, cmdArgs, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const git = (...a) => run("git", a);
function fail(message) {
  console.error(`rollback: ${message}`);
  process.exit(1);
}

if (!tag || checkpointNumber(tag) === null) fail("usage: npm run rollback -- checkpoint-NNN [--dry-run] [--no-push]");

git("fetch", "--quiet", "--tags", "origin", "main");
try {
  git("rev-parse", "--verify", "--quiet", `refs/tags/${tag}`);
} catch {
  fail(`${tag} does not exist. See the list: git tag -l "checkpoint-*" (or the repository's Releases page).`);
}
try {
  git("merge-base", "--is-ancestor", tag, "origin/main");
} catch {
  fail(`${tag} is not part of main's history.`);
}

const undone = git("log", "--format=  %h %s", `${tag}..origin/main`);
if (!undone) fail(`main is already at ${tag}; nothing to roll back.`);
console.log(`Rolling back to ${tag} undoes these changes on main:\n${undone}\n`);
if (dryRun) process.exit(0);
if (git("status", "--porcelain")) fail("you have uncommitted changes; commit or stash them first.");

const branch = `rollback-to-${tag}`;
git("switch", "--quiet", "-c", branch, "origin/main");
if (!restoreTree(tag)) fail(`the files on main already match ${tag}.`);
git("commit", "--quiet", "-m", `Roll back to ${tag}`, "-m", `Restores every tracked file to ${tag}. Undoes:\n${undone}`);
console.log(`Committed on branch ${branch}.`);

if (noPush) {
  console.log("Not pushed (--no-push). Push it and open a pull request when ready, or delete the branch.");
  process.exit(0);
}
git("push", "--quiet", "-u", "origin", branch);
const url = run("gh", [
  "pr", "create", "--base", "main", "--head", branch,
  "--title", `Roll back to ${tag}`,
  "--body", `Restores every tracked file to **${tag}** (see ROLLBACK.md). Merging redeploys the site and records a new checkpoint.\n\nUndoes:\n\n\`\`\`\n${undone}\n\`\`\``
]);
console.log(`Pull request: ${url}\nWhen the "check" passes, merge it; the site redeploys within a few minutes.`);

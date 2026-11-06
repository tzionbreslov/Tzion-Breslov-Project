#!/usr/bin/env node
// Runs in .github/workflows/checkpoint.yml after every push to main: tags the
// pushed commit as the next checkpoint-NNN and publishes a GitHub Release whose
// notes list what changed and how to come back (ROLLBACK.md). Idempotent: a
// commit that already has a checkpoint is left alone. Tags can't be moved or
// deleted afterwards (ruleset "Protect checkpoints").
//
// Needs: GH_TOKEN (contents: write), GITHUB_REPOSITORY, CHECKPOINT_SHA, and a
// full-history checkout (fetch-depth: 0) for the change list.
import { execFileSync } from "node:child_process";
import { checkpointNotes, checkpointNumber, nextCheckpointTag } from "./lib/checkpoints.mjs";

const repo = process.env.GITHUB_REPOSITORY;
const sha = process.env.CHECKPOINT_SHA;
if (!repo || !/^[0-9a-f]{40}$/.test(sha ?? "")) throw new Error("GITHUB_REPOSITORY and a full CHECKPOINT_SHA are required");

const run = (cmd, args, input) => execFileSync(cmd, args, { encoding: "utf8", input, stdio: ["pipe", "pipe", "pipe"] }).trim();
const gh = (...args) => run("gh", args);
const ghJson = (...args) => JSON.parse(gh("api", ...args) || "null");

/** All checkpoint tags with the commit each points at (annotated tags dereferenced). */
function checkpoints() {
  const refs = ghJson(`repos/${repo}/git/matching-refs/tags/checkpoint-`) ?? [];
  return refs
    .filter((r) => checkpointNumber(r.ref) !== null)
    .map((r) => ({
      tag: r.ref.replace("refs/tags/", ""),
      commit: r.object.type === "tag" ? ghJson(`repos/${repo}/git/tags/${r.object.sha}`).object.sha : r.object.sha
    }));
}

function changesSince(previous) {
  try {
    return run("git", ["log", "--format=%s", `${previous.commit}..${sha}`]).split("\n").filter(Boolean);
  } catch {
    return [run("git", ["log", "-1", "--format=%s", sha])];
  }
}

let existing = checkpoints();
const already = existing.find((c) => c.commit === sha);
if (already) {
  console.log(`${sha.slice(0, 7)} is already ${already.tag}; nothing to do.`);
  process.exit(0);
}

// Two merges close together could pick the same number: creating the ref is the
// atomic step, so on a clash re-read the tags and take the next free number.
let tag;
for (let attempt = 1; ; attempt += 1) {
  tag = nextCheckpointTag(existing.map((c) => c.tag));
  try {
    gh("api", "-X", "POST", `repos/${repo}/git/refs`, "-f", `ref=refs/tags/${tag}`, "-f", `sha=${sha}`);
    break;
  } catch (error) {
    if (attempt >= 5) throw error;
    console.log(`${tag} was taken (${String(error.stderr ?? error.message).trim().slice(0, 120)}); retrying`);
    existing = checkpoints();
  }
}

const previous = existing
  .filter((c) => c.tag !== tag)
  .sort((a, b) => checkpointNumber(b.tag) - checkpointNumber(a.tag))[0] ?? null;
const subjects = previous ? changesSince(previous) : [];
const subject = run("git", ["log", "-1", "--format=%s", sha]);
const notes = checkpointNotes({ tag, sha, previousTag: previous?.tag ?? null, subjects, repo });
const title = `Checkpoint ${tag.replace("checkpoint-", "")}: ${subject}`.slice(0, 120);

run("gh", ["release", "create", tag, "--repo", repo, "--verify-tag", "--title", title, "--notes-file", "-"], notes);
console.log(`Created ${tag} at ${sha.slice(0, 7)} (${subject})`);

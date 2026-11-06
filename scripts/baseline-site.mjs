#!/usr/bin/env node
// Builds the site exactly as it was at a checkpoint, for visual comparison and
// the wording baseline:
//
//   npm run baseline -- checkpoint-001 [--fresh]
//   → .tmp/baseline/checkpoint-001/out   (reused if it exists; --fresh rebuilds)
//
// The tag is checked out as a temporary, detached git worktree in
// .tmp/baseline/<tag>/src, built there (npm ci + npm run build), and its out/ is
// moved to .tmp/baseline/<tag>/out only after the build succeeds — so an
// existing out/ is always complete. The worktree is then removed; a leftover one
// from an interrupted run is cleaned up on the next run.
import { execFileSync, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const fresh = args.includes("--fresh");
const tag = args.find((arg) => !arg.startsWith("--"));

if (!tag || !/^[\w.-]+$/.test(tag)) {
  console.error("Usage: node scripts/baseline-site.mjs <tag> [--fresh]   e.g. checkpoint-001");
  process.exit(1);
}

const git = (...gitArgs) => execFileSync("git", gitArgs, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const base = path.join(root, ".tmp", "baseline", tag);
const out = path.join(base, "out");
const src = path.join(base, "src");
const rm = (dir) => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });

function removeWorktree() {
  try { git("worktree", "remove", "--force", src); } catch { /* not registered, or files still locked */ }
  rm(src);
  git("worktree", "prune");
}

let commit;
try {
  commit = git("rev-parse", "--verify", "--quiet", `${tag}^{commit}`);
} catch {
  console.error(`Unknown tag ${tag}. Fetch it first: git fetch origin tag ${tag}`);
  process.exit(1);
}

if (fs.existsSync(out) && !fresh) {
  console.log(`Reusing ${path.relative(root, out)} (pass --fresh to rebuild).`);
  process.exit(0);
}

rm(out);
removeWorktree();
console.log(`Building ${tag} (${commit.slice(0, 7)}) in ${path.relative(root, src)} …`);
git("worktree", "add", "--force", "--detach", src, commit);
try {
  // Fixed command strings: on Windows npm is npm.cmd, which needs a shell.
  execSync("npm ci --no-audit --no-fund", { cwd: src, stdio: "inherit" });
  execSync("npm run build", { cwd: src, stdio: "inherit" });
  fs.renameSync(path.join(src, "out"), out);
} finally {
  try {
    removeWorktree();
  } catch (error) {
    console.warn(`Could not remove the worktree ${src} (${error.message.split("\n")[0]}); the next run cleans it up.`);
  }
}
console.log(`Built ${tag} into ${path.relative(root, out)}`);

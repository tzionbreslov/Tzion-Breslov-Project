// Checkpoints: every change merged into main is tagged checkpoint-NNN (see
// ROLLBACK.md). Pure helpers + the one git operation the rollback needs, shared
// by scripts/checkpoint.mjs (CI) and scripts/rollback.mjs (owner/maintainer).
import { execFileSync } from "node:child_process";

const PATTERN = /^(?:refs\/tags\/)?checkpoint-(\d{3,})$/;

/** The number of a checkpoint tag ("checkpoint-007" → 7), or null for any other tag. */
export function checkpointNumber(tag) {
  const match = PATTERN.exec(tag);
  return match ? Number(match[1]) : null;
}

/** The tag that follows the highest existing checkpoint ("checkpoint-001" first). */
export function nextCheckpointTag(tags) {
  const highest = Math.max(0, ...tags.map(checkpointNumber).filter((n) => n !== null));
  return `checkpoint-${String(highest + 1).padStart(3, "0")}`;
}

/** Release notes: what changed since the previous checkpoint and how to come back here. */
export function checkpointNotes({ tag, sha, previousTag, subjects, repo }) {
  const lines = [`The site exactly as it was at commit ${sha.slice(0, 7)}.`, ""];
  if (previousTag) {
    lines.push(`Changes since ${previousTag}:`, ...subjects.map((s) => `- ${s}`), "");
  }
  lines.push(
    "To go back to this checkpoint:",
    `- Right away, on the preview: Actions → Deploy GitHub Pages → Run workflow → Use workflow from → Tags → ${tag}.`,
    `- For good: \`npm run rollback -- ${tag}\` opens a pull request that restores every file to this checkpoint.`,
    "",
    `Details: https://github.com/${repo}/blob/main/ROLLBACK.md`
  );
  return lines.join("\n");
}

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

/**
 * Make the index and working tree exactly the checkpoint's tree: changed files
 * are restored, files added since are removed, ignored files (secrets, builds)
 * are left alone. Returns whether anything differs from HEAD afterwards.
 */
export function restoreTree(tag, cwd = process.cwd()) {
  git(cwd, ["read-tree", "-u", "--reset", `${tag}^{tree}`]);
  try {
    git(cwd, ["diff", "--cached", "--quiet", "HEAD"]);
    return false;
  } catch {
    return true;
  }
}

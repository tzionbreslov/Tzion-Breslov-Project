import { strict as assert } from "node:assert";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { checkpointNotes, checkpointNumber, nextCheckpointTag, restoreTree } from "./lib/checkpoints.mjs";

test("checkpointNumber reads only checkpoint-NNN tags", () => {
  assert.equal(checkpointNumber("checkpoint-001"), 1);
  assert.equal(checkpointNumber("checkpoint-042"), 42);
  assert.equal(checkpointNumber("checkpoint-1234"), 1234);
  assert.equal(checkpointNumber("checkpoint-01a"), null);
  assert.equal(checkpointNumber("v1.0.0"), null);
  assert.equal(checkpointNumber("refs/tags/checkpoint-007"), 7);
});

test("nextCheckpointTag continues from the highest number, padded to 3 digits", () => {
  assert.equal(nextCheckpointTag([]), "checkpoint-001");
  assert.equal(nextCheckpointTag(["checkpoint-001"]), "checkpoint-002");
  assert.equal(nextCheckpointTag(["checkpoint-009", "checkpoint-010", "checkpoint-002", "v2"]), "checkpoint-011");
  assert.equal(nextCheckpointTag(["checkpoint-999"]), "checkpoint-1000");
});

test("checkpointNotes lists the changes and both ways back", () => {
  const notes = checkpointNotes({
    tag: "checkpoint-002",
    sha: "0123456789abcdef0123456789abcdef01234567",
    previousTag: "checkpoint-001",
    subjects: ["Add the Classes page (#13)", "Fix the menu (#12)"],
    repo: "tzionbreslov/Tzion-Breslov-Project"
  });
  assert.match(notes, /Changes since checkpoint-001:/);
  assert.match(notes, /- Add the Classes page \(#13\)\n- Fix the menu \(#12\)/);
  assert.match(notes, /commit 0123456/);
  assert.match(notes, /Use workflow from.*checkpoint-002/);
  assert.match(notes, /npm run rollback -- checkpoint-002/);
  assert.match(notes, /https:\/\/github\.com\/tzionbreslov\/Tzion-Breslov-Project\/blob\/main\/ROLLBACK\.md/);
  assert.doesNotMatch(checkpointNotes({ tag: "checkpoint-001", sha: "abc1234", previousTag: null, subjects: [], repo: "o/r" }), /Changes since/);
});

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

test("restoreTree makes the working tree and index exactly the checkpoint's, keeping ignored files", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tz-rollback-"));
  try {
    git(dir, "init", "-q", "-b", "main");
    git(dir, "config", "user.email", "test@example.invalid");
    git(dir, "config", "user.name", "Test");
    git(dir, "config", "core.autocrlf", "false");
    fs.writeFileSync(path.join(dir, ".gitignore"), "secret.env\n");
    fs.writeFileSync(path.join(dir, "kept.txt"), "original\n");
    fs.writeFileSync(path.join(dir, "deleted-later.txt"), "was here\n");
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "first");
    git(dir, "tag", "checkpoint-001");

    fs.writeFileSync(path.join(dir, "kept.txt"), "changed wording\n");
    fs.rmSync(path.join(dir, "deleted-later.txt"));
    fs.mkdirSync(path.join(dir, "new-dir"));
    fs.writeFileSync(path.join(dir, "new-dir", "added.txt"), "new page\n");
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "second");
    fs.writeFileSync(path.join(dir, "secret.env"), "KEY=never-touch\n");

    const changed = restoreTree("checkpoint-001", dir);

    assert.equal(changed, true);
    assert.equal(fs.readFileSync(path.join(dir, "kept.txt"), "utf8"), "original\n");
    assert.equal(fs.readFileSync(path.join(dir, "deleted-later.txt"), "utf8"), "was here\n");
    assert.equal(fs.existsSync(path.join(dir, "new-dir", "added.txt")), false);
    assert.equal(fs.readFileSync(path.join(dir, "secret.env"), "utf8"), "KEY=never-touch\n");
    assert.equal(git(dir, "diff", "--cached", "--quiet", "checkpoint-001") === "", true);
    git(dir, "commit", "-q", "-m", "Roll back to checkpoint-001");
    assert.equal(restoreTree("checkpoint-001", dir), false, "nothing left to restore once committed");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

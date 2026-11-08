import { strict as assert } from "node:assert";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// check-wording.mjs --write-baseline on a tiny baseline build: an out/ and, beside it, the
// routes.json that `npm run baseline` writes there (the checkpoint's own routes).
const script = fileURLToPath(new URL("./check-wording.mjs", import.meta.url));
const run = (...args) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });
const page = (title, body) => `<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`;

const made = [];
test.after(() => made.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

function baselineBuild(routes = ["/", "/old-page/"]) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "tz-wording-"));
  made.push(base);
  const out = path.join(base, "out");
  const write = (file, html) => {
    fs.mkdirSync(path.dirname(path.join(out, file)), { recursive: true });
    fs.writeFileSync(path.join(out, file), html);
  };
  write("index.html", page("Home", '<p>Welcome</p><input type="email" placeholder="Email address">'));
  // A page the current tree's content/routes.json doesn't have.
  write("old-page/index.html", page("Old page", '<p>Only in the baseline</p><textarea placeholder=" Your   message "></textarea>'));
  write("404.html", page("Not found", "<h1>Oops</h1>"));
  if (routes) fs.writeFileSync(path.join(base, "routes.json"), JSON.stringify({ routes: routes.map((route) => ({ path: route })) }));
  return { base, out, dest: path.join(base, "wording") };
}
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

test("--write-baseline takes the pages from the baseline's own routes.json, not the current tree's", () => {
  const { out, dest } = baselineBuild();
  const result = run("--write-baseline", out, dest);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(readJson(path.join(dest, "checkpoint-001.json")), {
    "/": ["title:Home", "Welcome"],
    "/old-page/": ["title:Old page", "Only in the baseline"],
    "/404/": ["title:Not found", "Oops"]
  });
});

test("--write-baseline also writes the placeholders baseline, page by page", () => {
  const { out, dest } = baselineBuild();
  assert.equal(run("--write-baseline", out, dest).status, 0);
  assert.deepEqual(readJson(path.join(dest, "checkpoint-001-placeholders.json")), {
    "/": ["Email address"],
    "/old-page/": ["Your message"],
    "/404/": []
  });
});

test("--write-baseline fails, writing nothing, without the baseline's routes.json", () => {
  const { out, dest } = baselineBuild(null);
  const result = run("--write-baseline", out, dest);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /routes\.json/);
  assert.equal(fs.existsSync(dest), false);
});

test("--write-baseline never overwrites a baseline that is already there", () => {
  const { out, dest } = baselineBuild();
  fs.mkdirSync(dest);
  fs.writeFileSync(path.join(dest, "checkpoint-001.json"), "kept\n");
  const result = run("--write-baseline", out, dest);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Refusing to overwrite/);
  assert.equal(fs.readFileSync(path.join(dest, "checkpoint-001.json"), "utf8"), "kept\n");
  assert.equal(fs.existsSync(path.join(dest, "checkpoint-001-placeholders.json")), false);
});

test("--write-baseline needs a destination (it never writes into tests/wording by itself)", () => {
  const { out } = baselineBuild();
  const result = run("--write-baseline", out);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Usage/);
});

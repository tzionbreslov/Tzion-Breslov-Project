#!/usr/bin/env node
// Owner rule: never change any wording that is on the site today. Every page in
// the checkpoint-001 baseline must still say everything it said then, in the
// same order (new text in between is fine); only removed pages may lose text.
//
//   npm run build && npm run check:wording
//
// The baseline (tests/wording/checkpoint-001.json) is generated once from the
// checkpoint-001 build:
//   npm run baseline -- checkpoint-001
//   node scripts/check-wording.mjs --write-baseline .tmp/baseline/checkpoint-001/out
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractWording, isOrderedSubsequence } from "./lib/wording.mjs";

// Task 2 replaces this with: import { isRemovedPath } from "../config/site-structure.mjs";
const isRemovedPath = (_route) => false;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE = path.join(root, "tests", "wording", "checkpoint-001.json");
const NOT_FOUND = "/404/";

// "/" -> index.html, "/about-us/" -> about-us/index.html, "/404/" -> 404.html
// (the file GitHub Pages serves for unknown URLs).
const htmlFile = (outDir, route) =>
  route === NOT_FOUND ? path.join(outDir, "404.html") : path.join(outDir, route, "index.html");
const readWording = (outDir, route) => extractWording(fs.readFileSync(htmlFile(outDir, route), "utf8"));
const relative = (file) => path.relative(root, file).split(path.sep).join("/");

const args = process.argv.slice(2);
if (args[0] === "--write-baseline") {
  if (!args[1]) {
    console.error("Usage: node scripts/check-wording.mjs --write-baseline <outDir>");
    process.exit(1);
  }
  const outDir = path.resolve(args[1]);
  const { routes } = JSON.parse(fs.readFileSync(path.join(root, "content", "routes.json"), "utf8"));
  const baseline = {};
  for (const route of [...routes.map((r) => r.path), NOT_FOUND]) {
    const file = htmlFile(outDir, route);
    if (!fs.existsSync(file)) {
      console.error(`Missing ${file} — is ${outDir} a complete build?`);
      process.exit(1);
    }
    baseline[route] = readWording(outDir, route);
  }
  fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
  fs.writeFileSync(BASELINE, `${JSON.stringify(baseline, null, 1)}\n`);
  console.log(`Wrote ${relative(BASELINE)}: ${Object.keys(baseline).length} pages from ${outDir}`);
  process.exit(0);
}

const outDir = path.join(root, "out");
if (!fs.existsSync(outDir)) {
  console.error("Missing out/. Run `npm run build` first.");
  process.exit(1);
}
const baseline = JSON.parse(fs.readFileSync(BASELINE, "utf8"));
const failures = [];
let checked = 0;
for (const [route, expected] of Object.entries(baseline)) {
  if (isRemovedPath(route)) continue;
  checked++;
  const file = htmlFile(outDir, route);
  if (!fs.existsSync(file)) {
    failures.push(`${route}\n    page missing: ${relative(file)}`);
    continue;
  }
  const result = isOrderedSubsequence(expected, readWording(outDir, route));
  if (!result.ok) {
    const context = result.context.length ? result.context.map((t) => `      ${JSON.stringify(t)}`).join("\n") : "      (end of page)";
    failures.push(`${route}\n    expected: ${JSON.stringify(result.expected)} (baseline entry ${result.index + 1} of ${expected.length})\n    page has instead:\n${context}`);
  }
}

if (failures.length) {
  console.error(`Wording check failed: ${failures.length} page(s) changed wording from checkpoint-001.\n  ${failures.join("\n  ")}`);
  process.exit(1);
}
console.log(`Wording OK: ${checked} pages still say everything they said at checkpoint-001.`);

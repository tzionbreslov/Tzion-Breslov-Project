#!/usr/bin/env node
// Owner rule: never change any wording that is on the site today. Every page in
// the checkpoint-001 baseline must still say everything it said then, in the
// same order (new text in between is fine); only removed pages may lose text.
// The form fields' placeholder text ("Email address") is checked the same way,
// against its own baseline.
//
//   npm run build && npm run check:wording
//
// The baselines (tests/wording/checkpoint-001.json and checkpoint-001-placeholders.json)
// were generated from the checkpoint-001 build and are never regenerated. To see what a
// build gives, write them to a new directory (an existing baseline is never overwritten):
//   npm run baseline -- checkpoint-001
//   node scripts/check-wording.mjs --write-baseline .tmp/baseline/checkpoint-001/out .tmp/wording
// The pages are the baseline's own: `npm run baseline` writes the checkpoint's
// content/routes.json beside its out/ (.tmp/baseline/checkpoint-001/routes.json).
//
// The only exceptions are the changes the owner asked for, each listed with the owner's
// words in tests/wording/owner-approved.json and applied to the wording baseline before it
// is compared (applyApprovedChanges in scripts/lib/wording.mjs): an entry that is no longer
// used, or that would reach more than its own text node, fails the check.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isRemovedPath } from "../config/site-structure.mjs";
import { applyApprovedChanges, extractPlaceholders, extractWording, isOrderedSubsequence } from "./lib/wording.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NOT_FOUND = "/404/";
const CHECKS = [
  {
    name: "Wording", file: path.join(root, "tests", "wording", "checkpoint-001.json"), extract: extractWording, what: "wording", ok: "still say everything they said",
    approved: path.join(root, "tests", "wording", "owner-approved.json")
  },
  { name: "Placeholders", file: path.join(root, "tests", "wording", "checkpoint-001-placeholders.json"), extract: extractPlaceholders, what: "placeholders", ok: "still have every placeholder they had" }
];

// "/" -> index.html, "/about-us/" -> about-us/index.html, "/404/" -> 404.html
// (the file GitHub Pages serves for unknown URLs).
const htmlFile = (outDir, route) =>
  route === NOT_FOUND ? path.join(outDir, "404.html") : path.join(outDir, route, "index.html");
const relative = (file) => path.relative(root, file).split(path.sep).join("/");

const args = process.argv.slice(2);
if (args[0] === "--write-baseline") {
  if (!args[1] || !args[2]) {
    console.error("Usage: node scripts/check-wording.mjs --write-baseline <outDir> <destDir>");
    process.exit(1);
  }
  const outDir = path.resolve(args[1]);
  const targets = CHECKS.map((check) => path.join(path.resolve(args[2]), path.basename(check.file)));
  // The committed baselines are never regenerated: this only ever writes new files.
  const existing = targets.filter((target) => fs.existsSync(target));
  if (existing.length) {
    console.error(`Refusing to overwrite ${existing.join(", ")}: write the baselines to a directory that has none.`);
    process.exit(1);
  }
  // The baseline's own imported pages (not siteRoutes): it records what the checkpoint-001
  // site said, and its build has none of the composed pages.
  const routesFile = path.join(outDir, "..", "routes.json");
  if (!fs.existsSync(routesFile)) {
    console.error(`Missing ${routesFile}, the baseline's routes: build it with \`npm run baseline -- <tag>\`, which writes them beside its out/.`);
    process.exit(1);
  }
  const { routes } = JSON.parse(fs.readFileSync(routesFile, "utf8"));
  const baselines = CHECKS.map(() => ({}));
  for (const route of [...routes.map((r) => r.path), NOT_FOUND]) {
    const file = htmlFile(outDir, route);
    if (!fs.existsSync(file)) {
      console.error(`Missing ${file} — is ${outDir} a complete build?`);
      process.exit(1);
    }
    const html = fs.readFileSync(file, "utf8");
    CHECKS.forEach((check, i) => { baselines[i][route] = check.extract(html); });
  }
  targets.forEach((target, i) => {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${JSON.stringify(baselines[i], null, 1)}\n`);
    console.log(`Wrote ${relative(target)}: ${Object.keys(baselines[i]).length} pages from ${outDir}`);
  });
  process.exit(0);
}

const outDir = path.join(root, "out");
if (!fs.existsSync(outDir)) {
  console.error("Missing out/. Run `npm run build` first.");
  process.exit(1);
}
let failed = false;
for (const check of CHECKS) {
  let baseline = JSON.parse(fs.readFileSync(check.file, "utf8"));
  let approvedNote = "";
  if (check.approved) {
    const { changes } = JSON.parse(fs.readFileSync(check.approved, "utf8"));
    const applied = applyApprovedChanges(baseline, changes, (route) => !isRemovedPath(route));
    if (applied.problems.length) {
      failed = true;
      console.error(`${check.name} check failed: ${relative(check.approved)} doesn't fit checkpoint-001.\n  ${applied.problems.join("\n  ")}`);
      continue;
    }
    baseline = applied.baseline;
    approvedNote = ` (with the ${changes.length} owner-approved changes in ${relative(check.approved)})`;
  }
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
    const result = isOrderedSubsequence(expected, check.extract(fs.readFileSync(file, "utf8")));
    if (!result.ok) {
      const context = result.context.length ? result.context.map((t) => `      ${JSON.stringify(t)}`).join("\n") : "      (end of page)";
      failures.push(`${route}\n    expected: ${JSON.stringify(result.expected)} (baseline entry ${result.index + 1} of ${expected.length})\n    page has instead:\n${context}`);
    }
  }
  if (failures.length) {
    failed = true;
    console.error(`${check.name} check failed: ${failures.length} page(s) changed ${check.what} from checkpoint-001.\n  ${failures.join("\n  ")}`);
  } else {
    console.log(`${check.name} OK: ${checked} pages ${check.ok} at checkpoint-001${approvedNote}.`);
  }
}
if (failed) process.exit(1);

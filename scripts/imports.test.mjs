import { strict as assert } from "node:assert";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// lib/content.ts imports the composed pages (lib/pages/registry.ts → lib/pages/*), so a page that reached
// lib/content.ts back, directly or through any module it imports, would make an import cycle (a TDZ error as soon
// as a page module runs code at load). The pages read the content folder through lib/content-files.ts, a leaf.
const root = fileURLToPath(new URL("../", import.meta.url));
const pagesDir = path.join(root, "lib", "pages");
const content = path.join(root, "lib", "content.ts");
const rel = (file) => path.relative(root, file).split(path.sep).join("/");

// Static `import … from "x"`, `export … from "x"` and bare `import "x"`. The clause before `from` has no
// quote, paren, `=` or `;`, so declarations such as `export const X = …` and `export function f(` never match.
const specifiers = (source) =>
  [...source.matchAll(/^\s*(?:import|export)\b(?:[^;"'`()=]*?\bfrom)?\s*"([^"]+)"/gm)].map((m) => m[1]);

const CODE = /\.(?:ts|tsx|mjs|js)$/;

/** The site file `specifier` names from `from`: "@/" is the repo root (tsconfig paths); packages and node: are null. */
function resolve(specifier, from) {
  const base = specifier.startsWith("@/") ? path.join(root, specifier.slice(2))
    : specifier.startsWith(".") ? path.resolve(path.dirname(from), specifier)
    : null;
  if (!base) return null;
  const file = [base, `${base}.ts`, `${base}.tsx`, `${base}.mjs`, path.join(base, "index.ts")]
    .find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
  assert.ok(file, `${rel(from)}: can't resolve ${specifier}`);
  return file;
}

/** Every site module reachable from `entries`, each mapped to the module that first imported it. */
function reachable(entries) {
  const parent = new Map(entries.map((file) => [file, null]));
  const queue = [...entries];
  while (queue.length) {
    const file = queue.shift();
    if (!CODE.test(file)) continue;
    for (const specifier of specifiers(fs.readFileSync(file, "utf8"))) {
      const target = resolve(specifier, file);
      if (target && !parent.has(target)) {
        parent.set(target, file);
        queue.push(target);
      }
    }
  }
  return parent;
}

const chain = (parent, file) => {
  const steps = [];
  for (let at = file; at; at = parent.get(at)) steps.unshift(rel(at));
  return steps.join(" → ");
};

test("nothing lib/pages imports, directly or through other modules, is lib/content.ts", () => {
  const pages = fs.readdirSync(pagesDir).filter((name) => CODE.test(name) && !name.endsWith(".d.mts"));
  assert.ok(pages.length >= 10);
  for (const name of pages) {
    const file = path.join(pagesDir, name);
    assert.ok(specifiers(fs.readFileSync(file, "utf8")).length > 0, name);
  }
  const parent = reachable(pages.map((name) => path.join(pagesDir, name)));
  assert.ok(!parent.has(content), `import cycle: ${chain(parent, content)}`);
  // The walk follows "@/", relative and .mjs imports past lib/pages.
  for (const file of ["lib/content-files.ts", "lib/html.mjs", "lib/events.mjs", "config/contact.mjs", "config/site-url.mjs"]) {
    assert.ok(parent.has(path.join(root, file)), `not reached: ${file}`);
  }
});

test("the import walk sees every form of import", () => {
  assert.deepEqual(specifiers([
    'import fs from "node:fs";',
    'import type { A } from "./a";',
    'import {\n  b,\n  c\n} from "@/lib/b";',
    'export { d } from "./d.mjs";',
    'export * from "./e";',
    'import "./f.css";',
    'import copy from "../g.json" with { type: "json" };',
    'export const h = "./not-an-import";',
    'export function i() { return "./nor-this"; }',
    ' * @param {import("./j.d.mts").J} j'
  ].join("\n")), ["node:fs", "./a", "@/lib/b", "./d.mjs", "./e", "./f.css", "../g.json"]);
});

test("lib/content-files.ts imports nothing from the site's own modules", () => {
  const imported = specifiers(fs.readFileSync(path.join(root, "lib", "content-files.ts"), "utf8"));
  assert.deepEqual(imported, ["node:fs", "node:path", "react"]);
});

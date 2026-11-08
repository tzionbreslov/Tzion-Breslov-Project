import { strict as assert } from "node:assert";
import fs from "node:fs";
import test from "node:test";

// lib/content.ts imports the composed pages (lib/pages/registry.ts → lib/pages/*), so a page that imported
// lib/content.ts back would make an import cycle (a TDZ error as soon as a page module runs code at load).
// The pages read the content folder through lib/content-files.ts, a leaf.
const dir = new URL("../lib/pages/", import.meta.url);
const specifiers = (source) => [...source.matchAll(/^\s*(?:import|export)\b[^;]*?\bfrom\s+"([^"]+)"/gm)].map((m) => m[1]);

test("no module in lib/pages imports lib/content.ts", () => {
  const files = fs.readdirSync(dir).filter((name) => /\.m?ts$|\.mjs$/.test(name));
  assert.ok(files.length >= 10);
  for (const name of files) {
    const imported = specifiers(fs.readFileSync(new URL(name, dir), "utf8"));
    assert.ok(imported.length > 0 || name.endsWith(".d.mts"), name);
    for (const specifier of imported) assert.ok(!/(?:^@\/lib|\.\.)\/content(?:\.ts)?$/.test(specifier), `${name} imports ${specifier}`);
  }
});

test("lib/content-files.ts imports nothing from the site's own modules", () => {
  const imported = specifiers(fs.readFileSync(new URL("../lib/content-files.ts", import.meta.url), "utf8"));
  assert.deepEqual(imported, ["node:fs", "node:path", "react"]);
});

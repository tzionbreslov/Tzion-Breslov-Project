import { strict as assert } from "node:assert";
import fs from "node:fs";
import test from "node:test";
import { THEME_STYLESHEET, stripThemeAuthor } from "./lib/theme-header.mjs";

// The theme's stylesheet header (scripts/import-wordpress.mjs copies it with stripThemeAuthor): the owner had the
// designer's credit removed (2026-11-08), and the header named her as the theme's author on every page's stylesheet.
const HEADER = "/*\nTheme Name: TzionBreslov\nDescription: Custom theme designed for Tzion Breslov\nAuthor: Esti Wolo\n" +
  "Author URI: https://estiwolo.com\nTemplate: genesis\nVersion: 1.0.0\n*/\n\n/* Table of Contents\n- Defaults\n*/\nbody { color: #000; }\n";
const STRIPPED = "/*\nTheme Name: TzionBreslov\nDescription: Custom theme designed for Tzion Breslov\n" +
  "Template: genesis\nVersion: 1.0.0\n*/\n\n/* Table of Contents\n- Defaults\n*/\nbody { color: #000; }\n";

test("stripThemeAuthor drops the theme header's Author and Author URI lines, and nothing else", () => {
  assert.equal(stripThemeAuthor(HEADER), STRIPPED);
  assert.equal(stripThemeAuthor(HEADER.replaceAll("\n", "\r\n")), STRIPPED.replaceAll("\n", "\r\n"));
});

test("stripThemeAuthor fails loudly when the theme header has moved: no header, or its Author lines missing or repeated", () => {
  assert.throws(() => stripThemeAuthor("body { color: #000; }\n"), /theme: marker not found: theme header/);
  assert.throws(() => stripThemeAuthor(STRIPPED), /theme: marker not found: Author/);
  assert.throws(() => stripThemeAuthor(HEADER.replace("Author URI: https://estiwolo.com\n", "")), /theme: marker not found: Author URI/);
  assert.throws(() => stripThemeAuthor(HEADER.replace("Author: Esti Wolo\n", "Author: Esti Wolo\nAuthor: Someone\n")), /theme: marker not unique: Author/);
  // Only the header counts: a later comment that happens to say "Author:" is left alone.
  const later = `${HEADER}/*\nAuthor: a note\n*/\n`;
  assert.equal(stripThemeAuthor(later), `${STRIPPED}/*\nAuthor: a note\n*/\n`);
});

test("the committed theme stylesheet is the stripped one: its header names no author", () => {
  const css = fs.readFileSync(new URL(`../public${THEME_STYLESHEET}`, import.meta.url), "utf8");
  assert.ok(css.startsWith("/*\nTheme Name: TzionBreslov\nDescription: Custom theme designed for Tzion Breslov\nTemplate: genesis\nVersion: 1.0.0\n*/\n"));
  for (const gone of ["Esti Wolo", "estiwolo", "Author:", "Author URI:"]) assert.ok(!css.includes(gone), gone);
  // It is exactly what the importer's edit makes of the header WordPress serves.
  const served = css.replace("Tzion Breslov\nTemplate:", "Tzion Breslov\nAuthor: Esti Wolo\nAuthor URI: https://estiwolo.com\nTemplate:");
  assert.equal(stripThemeAuthor(served), css);
});

test("the importer copies the theme stylesheet through stripThemeAuthor", () => {
  const importer = fs.readFileSync(new URL("./import-wordpress.mjs", import.meta.url), "utf8");
  assert.match(importer, /import \{ THEME_STYLESHEET, stripThemeAuthor \} from "\.\/lib\/theme-header\.mjs";/);
  assert.match(importer, /if \(rel === THEME_STYLESHEET\) fs\.writeFileSync\(dest, stripThemeAuthor\(fs\.readFileSync\(src, "utf8"\)\)\);\s*else fs\.copyFileSync\(src, dest\);/);
});

import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { THEME_STYLESHEET, copyAsset, stripThemeAuthor } from "./lib/theme-header.mjs";

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

// copyAsset is how scripts/import-wordpress.mjs copies every asset (copyAssets). The importer itself needs the
// WordPress export, so it isn't run here; a re-import that bypassed copyAsset would commit the Author lines again,
// and the test above fails on the committed file.
test("copyAsset copies the theme stylesheet through stripThemeAuthor, and every other file byte for byte", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tz-theme-header-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = (name, data) => {
    const at = path.join(dir, name);
    if (data !== undefined) fs.writeFileSync(at, data);
    return at;
  };

  copyAsset(THEME_STYLESHEET, file("style.css", HEADER), file("theme-out.css"));
  assert.equal(fs.readFileSync(file("theme-out.css"), "utf8"), STRIPPED);

  // Any other stylesheet with the same header (a child theme, a plugin's) is left as it is.
  copyAsset("/wp-content/themes/genesis/style.css", file("other.css", HEADER), file("other-out.css"));
  assert.equal(fs.readFileSync(file("other-out.css"), "utf8"), HEADER);

  // Binary files are copied unchanged, bytes that aren't UTF-8 included.
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0xff, 0xfe, 0x00, 0x80]);
  copyAsset("/wp-content/uploads/2023/06/footer-logo.png", file("logo.png", bytes), file("logo-out.png"));
  assert.deepEqual(fs.readFileSync(file("logo-out.png")), bytes);

  // A theme stylesheet whose header has moved fails the import, and nothing is written.
  assert.throws(() => copyAsset(THEME_STYLESHEET, file("moved.css", STRIPPED), file("moved-out.css")), /theme: marker not found: Author/);
  assert.ok(!fs.existsSync(file("moved-out.css")));
});

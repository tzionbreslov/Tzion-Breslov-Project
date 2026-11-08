// The theme's stylesheet header: the first comment of style.css, where WordPress reads "Theme Name:", "Author:"…
// one per line. The owner had the designer's credit removed from the site (2026-11-08), and this header named her
// as the theme's author in the stylesheet every page loads, so scripts/import-wordpress.mjs copies the stylesheet
// without its Author and Author URI lines (copyAsset; scripts/theme-header.test.mjs).
import fs from "node:fs";

/** The theme's stylesheet, as the pages link it (public/ holds the copy). */
export const THEME_STYLESHEET = "/wp-content/themes/tzionbreslov/style.css";

/**
 * Copies one imported asset, `rel` as the pages link it, from `src` to `dest`: the theme's stylesheet through
 * stripThemeAuthor (a theme header that has moved fails the import, and `dest` is not written), any other file byte
 * for byte.
 */
export function copyAsset(rel, src, dest) {
  if (rel === THEME_STYLESHEET) fs.writeFileSync(dest, stripThemeAuthor(fs.readFileSync(src, "utf8")));
  else fs.copyFileSync(src, dest);
}

const markerMissing = (name) => new Error(`theme: marker not found: ${name}`);
const markerRepeated = (name) => new Error(`theme: marker not unique: ${name}`);

/**
 * `css` without its theme header's "Author:" and "Author URI:" lines; everything else, the rest of the header
 * included, as it was. The header must be there with each line once, or a changed theme fails the import.
 */
export function stripThemeAuthor(css) {
  const header = /^\/\*[\s\S]*?\*\//.exec(css)?.[0];
  if (!header || !/^Theme Name:/m.test(header)) throw markerMissing("theme header");
  let stripped = header;
  for (const field of ["Author", "Author URI"]) {
    const line = new RegExp(`^${field}:[^\\r\\n]*\\r?\\n`, "gm");
    const count = stripped.match(line)?.length ?? 0;
    if (!count) throw markerMissing(field);
    if (count > 1) throw markerRepeated(field);
    stripped = stripped.replace(line, "");
  }
  return stripped + css.slice(header.length);
}

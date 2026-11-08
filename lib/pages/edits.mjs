// Plain string edits on the imported markup, with no file access, in .mjs so the unit tests
// (scripts/hero.test.mjs) can run them: the structure errors, replaceOnce, esc, and the swaps
// renderHero makes in the Resources hero. lib/pages/parts.ts re-exports what the pages use.

/** Escapes text for HTML content and double-quoted attributes. */
export const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The error every structure edit throws when its target isn't where it expects it (shared with compose.ts and contact-map.ts). */
export const markerMissing = (name) => new Error(`structure: marker not found: ${name}`);
export const markerRepeated = (name) => new Error(`structure: marker not unique: ${name}`);

/** Replaces the only match of `pattern`; `replace` gets the match and its groups. */
export function replaceOnce(html, pattern, replace, name) {
  const matches = [...html.matchAll(new RegExp(pattern.source, "g"))];
  if (!matches.length) throw markerMissing(name);
  if (matches.length > 1) throw markerRepeated(name);
  const [match] = matches;
  return html.slice(0, match.index) + replace(...match) + html.slice(match.index + match[0].length);
}

/** `hero` (the Resources hero) with another image (no srcset), heading and optional subheading (left out when not given). */
export function swapHero(hero, { image, heading, subheading }) {
  let html = hero;
  html = replaceOnce(html, /<img [^>]*class="wp-block-cover__image-background[^>]*>/, (img) =>
    img.replace(/ src="[^"]*"/, ` src="${esc(image)}"`).replace(/ (?:srcset|sizes)="[^"]*"/g, ""), "hero image");
  html = replaceOnce(html, /(<h2 class="wp-block-heading[^"]*"><strong>)[^<]*(<\/strong><\/h2>)/, (_, open, close) =>
    `${open}${esc(heading)}${close}`, "hero heading");
  // The small spacer and the uppercase line under the heading.
  const sub = /(<\/h2>)(\s*<div aria-hidden="true" class="wp-block-spacer spacer-small-height "><\/div>\s*<p class="has-text-align-center is-style-main[^>]*>)[^<]*(<\/p>)/;
  return replaceOnce(html, sub, (_, h2End, before, pEnd) =>
    subheading === undefined ? h2End : `${h2End}${before}${esc(subheading)}${pEnd}`, "hero subheading");
}

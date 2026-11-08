// Plain edits on the imported page, with no file access, in .mjs so the unit tests
// (scripts/hero.test.mjs, scripts/edits.test.mjs) can run them: the structure errors,
// replaceOnce, the swaps renderHero makes in the Resources hero, and the head swap
// composePage makes (lib/pages/compose.ts). lib/pages/parts.ts re-exports what the
// pages use, with esc (lib/html.mjs).
import { esc } from "../html.mjs";

export { esc };

/** The error every structure edit throws when its target isn't where it expects it (shared with compose.ts and contact-map.ts). */
export const markerMissing = (name) => new Error(`structure: marker not found: ${name}`);
export const markerRepeated = (name) => new Error(`structure: marker not unique: ${name}`);

/**
 * Replaces the only match of `pattern` (under its own flags, i or s included; sticky is dropped, so the match may be
 * anywhere); `replace` gets the match and its groups.
 */
export function replaceOnce(html, pattern, replace, name) {
  const matches = [...html.matchAll(new RegExp(pattern.source, `${pattern.flags.replace(/[gy]/g, "")}g`))];
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

/** The Resources page's own title, description, social and article:* tags, canonical/short links, oEmbed links and JSON-LD. */
function isResourcesOwn(item) {
  switch (item.t) {
    case "title":
    case "jsonld":
      return true;
    case "meta": {
      const key = item.attrs.name ?? item.attrs.property ?? "";
      return key === "description" || key.startsWith("og:") || key.startsWith("twitter:") || key.startsWith("article:");
    }
    case "link": {
      const { rel = "", type = "" } = item.attrs;
      return rel === "canonical" || rel === "shortlink" || (rel === "alternate" && type.includes("oembed"));
    }
    default:
      return false;
  }
}

/**
 * `head` (the Resources page's) with its own tags swapped for `own`, where they began: at its title, after robots and
 * before the stylesheets. The title must be there and open them, or a re-import has moved the head.
 */
export function swapHead(head, own) {
  const at = head.findIndex(isResourcesOwn);
  if (at < 0 || head[at].t !== "title") throw markerMissing("Resources head title");
  const swapped = head.filter((item) => !isResourcesOwn(item));
  swapped.splice(at, 0, ...own);
  return swapped;
}

// Plain edits on the imported page, with no file access, in .mjs so the unit tests
// (scripts/hero.test.mjs, scripts/edits.test.mjs, scripts/owner-edits.test.mjs) can run them:
// the structure errors, replaceOnce, the swaps renderHero makes in the Resources hero, the head
// swap composePage makes (lib/pages/compose.ts), and the owner's edits of 2026-11-08 that
// components/site-document.tsx makes to every page. lib/pages/parts.ts re-exports what the
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

/**
 * `hero` (the Resources hero) with another image (no srcset), heading and optional subheading (left out when not
 * given). With headingTag "h1" its heading becomes the page's h1 (the theme styles its h1 and h2 alike).
 */
export function swapHero(hero, { image, heading, subheading, headingTag = "h2" }) {
  let html = hero;
  html = replaceOnce(html, /<img [^>]*class="wp-block-cover__image-background[^>]*>/, (img) =>
    img.replace(/ src="[^"]*"/, ` src="${esc(image)}"`).replace(/ (?:srcset|sizes)="[^"]*"/g, ""), "hero image");
  html = replaceOnce(html, /(<h2 class="wp-block-heading[^"]*"><strong>)[^<]*(<\/strong><\/h2>)/, (_, open, close) =>
    `${open}${esc(heading)}${close}`, "hero heading");
  // The small spacer and the uppercase line under the heading.
  const sub = /(<\/h2>)(\s*<div aria-hidden="true" class="wp-block-spacer spacer-small-height "><\/div>\s*<p class="has-text-align-center is-style-main[^>]*>)[^<]*(<\/p>)/;
  html = replaceOnce(html, sub, (_, h2End, before, pEnd) =>
    subheading === undefined ? h2End : `${h2End}${before}${esc(subheading)}${pEnd}`, "hero subheading");
  if (headingTag === "h2") return html;
  return replaceOnce(html, /<h2( class="wp-block-heading[^"]*"><strong>[^<]*<\/strong>)<\/h2>/, (_, inner) =>
    `<${headingTag}${inner}</${headingTag}>`, "hero heading");
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

// ------------------------------------------------------------------ The owner's edits (2026-11-08)
// "remove 'site by esti wolo'", the "Tzion Beslov" typo fixed, and Tzion Breslov as the articles' author. Made
// where each page is rendered (components/site-document.tsx), on the imported footer and head, so a re-import
// can't undo them; each fails the build if what it changes isn't there exactly once, so a changed import is
// noticed.

/** The footer's last line, "© 2026 Tzion Beslov | Site by Esti Wolo", her name a link to her site. */
const FOOTER_CREDIT = /(<p class="has-text-align-center [^"]*"[^>]*>)© 2026 Tzion Beslov \| Site by <a [^>]*href="http:\/\/estiwolo\.com"[^>]*>Esti Wolo<\/a>(<\/p>)/;

/**
 * An imported footer (content/fragments, every variant) whose last line reads "© 2026 Tzion Breslov": the typo
 * fixed, " | Site by" and the linked name gone, in the same paragraph (its classes and style as they were).
 */
export function editFooterCredit(html) {
  return replaceOnce(html, FOOTER_CREDIT, (_, open, close) => `${open}© 2026 Tzion Breslov${close}`, "footer credit line");
}

const OLD_AUTHOR = "Esti Wolo";
const AUTHOR = "Tzion Breslov";

/** The one item of `items` that `pick` selects. */
function onlyOne(items, pick, name) {
  const found = items.filter(pick);
  if (!found.length) throw markerMissing(name);
  if (found.length > 1) throw markerRepeated(name);
  return found[0];
}

const metaIs = (name, content) => (item) => item.t === "meta" && item.attrs?.name === name && (content === undefined || item.attrs.content === content);
/** A JSON-LD item's @graph (Yoast's shape), or none. */
const graphOf = (item) => {
  const graph = item.t === "jsonld" ? JSON.parse(item.json)["@graph"] : undefined;
  return Array.isArray(graph) ? graph : [];
};
const isArticle = (node) => node["@type"] === "Article";

/**
 * `head` (an imported page's) with Tzion Breslov as the author of an article (the 18 Parasha articles): its
 * <meta name="author">, its twitter:data1 (under twitter:label1 "Written by") and, in the JSON-LD, the Article's
 * author and the Person node that author points at, which also loses its image (her gravatar, captioned with her
 * name). Any sign of an article author (an author meta, a "Written by" label, an Article node, her name anywhere)
 * makes every one of those places required, once each, naming her; afterwards the head must not name her anywhere.
 * A head with no such sign is returned as it is. The edited items are new: the imported head is shared (the page
 * cache) and never changed.
 */
export function editArticleAuthor(head) {
  const signed = head.some(metaIs("author")) || head.some(metaIs("twitter:label1", "Written by")) ||
    head.some((item) => graphOf(item).some(isArticle)) || JSON.stringify(head).includes(OLD_AUTHOR);
  if (!signed) return head;
  const authorMeta = onlyOne(head, metaIs("author", OLD_AUTHOR), "author meta");
  onlyOne(head, metaIs("twitter:label1", "Written by"), 'twitter:label1 "Written by"');
  const twitterMeta = onlyOne(head, metaIs("twitter:data1", OLD_AUTHOR), "twitter:data1 author");
  const jsonLd = onlyOne(head, (item) => graphOf(item).some(isArticle), "article JSON-LD");
  const data = JSON.parse(jsonLd.json);
  const nodes = data["@graph"];
  const article = onlyOne(nodes, (node) => isArticle(node) && node.author?.name === OLD_AUTHOR, "JSON-LD Article author");
  const person = onlyOne(nodes, (node) => node["@type"] === "Person" && node["@id"] === article.author["@id"] && node.name === OLD_AUTHOR,
    "JSON-LD Person");
  if (person.image?.caption !== OLD_AUTHOR) throw markerMissing("JSON-LD Person image");
  const graph = nodes.map((node) => {
    if (node === article) return { ...node, author: { ...node.author, name: AUTHOR } };
    if (node !== person) return node;
    // Her gravatar goes, and with it its caption, her name.
    const { image, ...rest } = node;
    void image;
    return { ...rest, name: AUTHOR };
  });
  // Written back with every slash escaped, as Yoast writes it, so no string in it can close its <script>.
  const json = JSON.stringify({ ...data, "@graph": graph }, null, "\t").replaceAll("/", "\\/");
  const named = (item) => ({ ...item, attrs: { ...item.attrs, content: AUTHOR } });
  const edited = head.map((item) =>
    item === authorMeta || item === twitterMeta ? named(item) : item === jsonLd ? { ...item, json } : item);
  if (JSON.stringify(edited).includes(OLD_AUTHOR)) throw new Error(`structure: the article head still names ${OLD_AUTHOR} after the author edit`);
  return edited;
}

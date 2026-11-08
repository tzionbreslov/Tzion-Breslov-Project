// The page checks of scripts/check-static-export.mjs that read only a page's
// text: links to removed pages, tzionbreslov.com after the site-URL switch,
// plain YouTube embeds, the importer's leftovers and the canonical link. They
// never read process.env or out/, so scripts/export-guard.test.mjs can prove
// each one on a few lines of HTML.
import { isRemovedPath, originUrlRegExp } from "../../config/site-structure.mjs";
import { IMPORTED_ORIGIN } from "../../config/site-url.mjs";

// The Events page's cards hold calendar text (titles, places, descriptions) that
// lib/events.mjs escapes and never links (card()). Whatever the events manager
// types there may name a removed page, tzionbreslov.com or a YouTube embed
// address, and must not fail the deploy, so the text checks read each page
// without its cards. The page holds them twice: as HTML, and as an escaped
// string in Next's flight data (`<article class=\"tz-event\"…`). Escaped
// calendar text can't close a card early in either form (an odd one only leaves
// text in, which fails safe). Every href/src check still reads the whole page.
const EVENT_CARDS = [
  /<article class="tz-event"[^>]*>[\s\S]*?<\/article>/g,
  /\\u003carticle class=\\+"tz-event\\+"[\s\S]*?\\u003c\/article\\u003e/g
];
export const withoutEventCards = (html) => EVENT_CARDS.reduce((text, cards) => text.replace(cards, ""), html);

/**
 * The values of a page's href and src attributes.
 * - Double-quoted ones are read from the whole page (`html`): calendar text can't
 *   spell one, since lib/events.mjs escapes its `"`.
 * - Single-quoted ones are read from the page without its Events cards (`text`):
 *   lib/events.mjs leaves the calendar's `'` as it is, and card() writes only
 *   double-quoted attributes.
 */
export function attributeValues(html, text = html) {
  return [
    ...[...html.matchAll(/\b(?:href|src)="([^"]*)"/g)].map((m) => m[1]),
    ...[...text.matchAll(/\b(?:href|src)='([^']*)'/g)].map((m) => m[1])
  ];
}

/**
 * The checks for an export built for `production` (the resolved site URL,
 * config/site-url.mjs) under the base path `base` ("" or "/Name").
 */
export function exportGuard({ production, base = "" }) {
  const switched = production !== IMPORTED_ORIGIN;
  // After a site-URL switch nothing may still point at the imported domain
  // (plain or JSON-escaped) — canonicals, social tags, JSON-LD, sitemaps, robots.
  const OLD_DOMAIN = /\/\/tzionbreslov\.com|\\\/\\\/tzionbreslov\.com/;

  // Nothing may point at a removed page (config/site-structure.mjs): no root-relative
  // or site-origin href/src, no sitemap <loc> and no absolute URL on the site's
  // origin anywhere in the text, plain or JSON-escaped (JSON-LD included).
  const ORIGIN_URL = originUrlRegExp([production], ["/", "\\/"]);
  /** `ref` (a path as written) when it names a removed page, else null. */
  const removedPath = (ref) => {
    // A URL found in the text ends at a single quote too (a single-quoted attribute).
    const urlPath = ref.replaceAll("\\/", "/").replace(/['?#].*$/s, "");
    // A page linked without its trailing slash ("/about", "/resources") is the same page;
    // a file ("/about.html") isn't, and a longer name ("/about-us") never matches.
    const page = /\/[^/.]+$/.test(urlPath) ? `${urlPath}/` : urlPath;
    return isRemovedPath(page) ? urlPath : null;
  };
  /** An href/src value's path on this site: root-relative (base path taken off) or absolute on the site's origin. */
  const attributePath = (value) => {
    if (value.startsWith("/")) return base && value.startsWith(`${base}/`) ? value.slice(base.length) : value;
    return value.startsWith(`${production}/`) ? value.slice(production.length) : null;
  };

  /** Removed pages named by `html`'s href/src attributes, or by a site-origin URL anywhere in `text`. */
  function removedRefs(html, text = html) {
    const found = new Set();
    for (const value of attributeValues(html, text)) {
      const ref = attributePath(value);
      if (ref) found.add(removedPath(ref));
    }
    for (const m of text.matchAll(ORIGIN_URL)) found.add(removedPath(m[1]));
    found.delete(null);
    return [...found];
  }

  /** Whether `text` (a sitemap, robots.txt) still names tzionbreslov.com after a site-URL switch. */
  const mentionsOldDomain = (text) => switched && OLD_DOMAIN.test(text);

  /** What is wrong with one exported HTML page, each problem as the words that follow its file name. */
  function pageProblems(html) {
    const problems = [];
    const text = withoutEventCards(html);
    if (html.includes("localhost:8088")) problems.push("still references localhost:8088");
    if (html.includes("estiwolo.com/wp-content")) problems.push("still references the dead staging host");
    if (mentionsOldDomain(text)) problems.push("still references tzionbreslov.com after the site-URL switch");
    // The text check skips the Events cards (calendar text); a link is never calendar text, so
    // every href/src on the page is read, cards included.
    for (const value of new Set(attributeValues(html, text))) {
      if (mentionsOldDomain(value)) problems.push(`links to ${value} after the site-URL switch`);
    }
    if (/\/wp-admin\/admin-ajax\.php/.test(html.replace(/var uagb_data[^;]*;/g, ""))) problems.push("references admin-ajax");
    // Videos play only in the Classes page's own player (youtube-nocookie, on click).
    if (text.includes("youtube.com/embed") || /\bsrc="[^"]*youtube\.com\/embed/.test(html)) problems.push("still embeds a plain YouTube player");
    for (const ref of removedRefs(html, text)) problems.push(`links to the removed page ${ref}`);
    // The broken-reference check never sees a bare "/" (the Home links); with a base path it must carry it.
    if (base && /\b(?:href|src)="\/"/.test(html)) problems.push(`links to "/" without the base path ${base}`);
    const canonical = html.match(/<link rel="canonical" href="([^"]+)"/)?.[1];
    if (canonical && !canonical.startsWith(production)) problems.push(`canonical is ${canonical}`);
    return problems;
  }

  return { switched, removedRefs, mentionsOldDomain, pageProblems };
}

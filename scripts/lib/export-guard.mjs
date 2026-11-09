// The page checks of scripts/check-static-export.mjs that read only a page's
// text: links to removed pages, tzionbreslov.com after the site-URL switch,
// plain YouTube embeds, the importer's leftovers and the canonical link. They
// never read process.env or out/, so scripts/export-guard.test.mjs can prove
// each one on a few lines of HTML.
import { escapeRegExp, isRemovedPath, originUrlRegExp } from "../../config/site-structure.mjs";
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
 * - Double-quoted ones are read from the whole page (`html`), plain and as Next's
 *   flight data escapes them (`href=\"…\"`, or `href=\\\"…\\\"` in a JSON row):
 *   calendar text can't spell either, since lib/events.mjs escapes its `"`.
 * - Single-quoted ones are read from the page without its Events cards (`text`):
 *   lib/events.mjs leaves the calendar's `'` as it is, and card() writes only
 *   double-quoted attributes.
 */
export function attributeValues(html, text = html) {
  return [
    ...[...html.matchAll(/\b(?:href|src)=(\\*)"([^"]*?)\1"/g)].map((m) => m[2]),
    ...[...text.matchAll(/\b(?:href|src)='([^']*)'/g)].map((m) => m[1])
  ];
}

/** How a link may spell `origin`'s host: over any scheme or none (`//host`), bare or with www. */
export function hostForms(origin) {
  const host = new URL(origin).host.replace(/^www\./, "");
  return [`//${host}`, `//www.${host}`];
}

// ------------------------------------------------------------ The covered contact details
// The site shows the phone number and the email address covered (lib/contact-details.mjs): a bot reading the pages
// gets nothing usable. So no exported page, nor any of the RSC payloads (.txt) Next writes beside it, may hold the
// old number, the email address, or a link to call, write or chat, in the HTML or in Next's flight data, in any case.
const CONTACT_DETAILS = [
  ["the old phone number", /54-671-3013/gi],
  ["the email address", /tzionbreslovproject@gmail\.com/gi],
  ["a mailto: link", /mailto:/gi],
  // "hotel:" is no link.
  ["a tel: link", /\btel:/gi],
  ["a wa.me link", /\bwa\.me\b/gi],
  ["an api.whatsapp.com link", /\bapi\.whatsapp\.com\b/gi]
];

/**
 * The Contact page's link-preview text (og:description, content/pages/contact.json), kept as it is (owner, 2026-11-09:
 * "leave as is"): the old number and the address, then a space and a no-break space before "Beit".
 */
export const CONTACT_OG_DESCRIPTION = "Questions? Comments? Try Us! (+972) 54-671-3013 tzionbreslovproject@gmail.com \u00a0Beit Shemesh, Israel";
// That text as the og:description's value only: `<meta property="og:description" content="…"` in the head, and
// `"property":"og:description","content":"…"` in the RSC payloads and (its quotes escaped) in the flight data.
const OG_DESCRIPTION = new RegExp(`og:description(?:" content="|(\\\\*)",\\1"content\\1":\\1")${escapeRegExp(CONTACT_OG_DESCRIPTION)}`, "g");
// The Events page's "Get event announcements" no-JavaScript line (lib/events.mjs), plain and in the flight data.
const ANNOUNCEMENTS_NO_SCRIPT = [
  /<noscript><p class="tz-announce__noscript">[\s\S]*?<\/p><\/noscript>/g,
  /\\u003cnoscript\\u003e\\u003cp class=\\+"tz-announce__noscript\\+"\\u003e[\s\S]*?\\u003c\/p\\u003e\\u003c\/noscript\\u003e/g
];

/**
 * What `text` (an exported page of `route`, or one of its RSC payloads) still holds of the contact details, each as
 * the words that follow its file name. Allowed, because the owner kept them written out:
 * - on /contact/, its link-preview text, exactly (CONTACT_OG_DESCRIPTION);
 * - on /events/, the Events cards and the no-JavaScript lines (withoutEventCards, and the announcements line);
 * - the scripts (_next/static), which hold the email through the sentences the owner kept (content/copy/en.json) and
 *   the forms' "temporarily unavailable" message (config/contact.mjs): they are not pages, and are not read.
 * @param {string} route the page's path ("/", "/contact/", "/404/")
 * @param {string} text
 * @returns {string[]}
 */
export function contactDetailsProblems(route, text) {
  let rest = text;
  if (route === "/contact/") rest = rest.replace(OG_DESCRIPTION, "og:description");
  if (route === "/events/") rest = ANNOUNCEMENTS_NO_SCRIPT.reduce((page, line) => page.replace(line, ""), withoutEventCards(rest));
  return CONTACT_DETAILS.flatMap(([what, pattern]) => {
    const found = rest.match(pattern)?.length ?? 0;
    return found ? [`holds ${what} (${found}×)`] : [];
  });
}

/** Plain, or with JSON's escaped slashes (`https:\/\/…`, as in JSON-LD). */
const SLASHES = ["/", "\\/"];

/**
 * The checks for an export built for `production` (the resolved site URL,
 * config/site-url.mjs) under the base path `base` ("" or "/Name").
 */
export function exportGuard({ production, base = "" }) {
  const siteForms = hostForms(production);
  // A switch means another host: www.tzionbreslov.com is still the imported domain.
  const switched = siteForms[0] !== hostForms(IMPORTED_ORIGIN)[0];
  // After a site-URL switch nothing may still point at the imported domain, over
  // http or https, bare or www, plain or JSON-escaped — canonicals, social tags,
  // JSON-LD, sitemaps, robots, links. (An email address on it is fine: no "//".)
  const oldForms = hostForms(IMPORTED_ORIGIN).flatMap((form) => SLASHES.map((slash) => form.replaceAll("/", slash)));
  const OLD_DOMAIN = new RegExp(oldForms.map(escapeRegExp).join("|"));

  // Nothing may point at a removed page (config/site-structure.mjs): no root-relative
  // or site-origin href/src, no sitemap <loc> and no absolute URL on the site's
  // origin anywhere in the text, plain or JSON-escaped (JSON-LD included).
  const ORIGIN_URL = originUrlRegExp(siteForms, SLASHES);
  const SITE_ORIGIN = new RegExp(`^(?:https?:)?(?:${siteForms.map(escapeRegExp).join("|")})(?=[/?#]|$)`);
  /** `urlPath` (a path as written, without its query or fragment) when it names a removed page, else null. */
  const removedPath = (urlPath) => {
    // A page linked without its trailing slash ("/about", "/resources") is the same page;
    // a file ("/about.html") isn't, and a longer name ("/about-us") never matches.
    const page = /\/[^/.]+$/.test(urlPath) ? `${urlPath}/` : urlPath;
    return isRemovedPath(page) ? urlPath : null;
  };
  /** An href/src value's path ends at its query or fragment: its own quote already ended the value. */
  const attributeUrlPath = (ref) => ref.replaceAll("\\/", "/").replace(/[?#].*$/s, "");
  // A URL found in the text ends at a single quote too (a single-quoted attribute), and
  // at a backslash once JSON's "\/" is undone: the end of a JSON string (`\"` in the
  // flight data) or another JSON escape (Next writes & < > as \u escapes there).
  const textUrlPath = (ref) => ref.replaceAll("\\/", "/").replace(/['?#\\].*$/s, "");
  /** An href/src value's path on this site: root-relative (base path taken off) or absolute on the site's origin. */
  const attributePath = (value) => {
    if (value.startsWith("/") && !value.startsWith("//")) return base && value.startsWith(`${base}/`) ? value.slice(base.length) : value;
    const origin = value.match(SITE_ORIGIN)?.[0];
    return origin ? value.slice(origin.length) || "/" : null;
  };

  /** Removed pages named by `html`'s href/src attributes, or by a site-origin URL anywhere in `text`. */
  function removedRefs(html, text = html) {
    const found = new Set();
    for (const value of attributeValues(html, text)) {
      const ref = attributePath(value);
      if (ref) found.add(removedPath(attributeUrlPath(ref)));
    }
    for (const m of text.matchAll(ORIGIN_URL)) found.add(removedPath(textUrlPath(m[1])));
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

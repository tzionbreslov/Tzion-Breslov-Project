import { loadPage } from "@/lib/content";

/**
 * Pieces of the imported Resources page (content/pages/resources.json and
 * resources__page__2.json), cut verbatim from its HTML so new pages are built
 * from Tzion's own markup and wording. Every cut is located by exact markers;
 * if a re-import moves one, the build fails here instead of shipping a broken page.
 */

const ENTRY_OPEN = '<div class="entry-content">';
const ENTRY_CLOSE = "</div></article></main></div></div></div>";
const ARTICLE_TAG = '<article class="post-28 page type-page status-publish entry" aria-label="Resources">';
const HERO = '<div class="wp-block-cover alignfull hero"';
const ARROW = '<div class="svg-img arrow-svg';
const SMALL_SPACER = '<div aria-hidden="true" class="wp-block-spacer spacer-small-height "></div>';
const LARGE_SPACER = '<div aria-hidden="true" class="wp-block-spacer spacer-large-height "></div>';
const ARTICLES_GRID = "uagb-block-1908e9b6";
const GRID_OPEN = '<div class="wp-block-uagb-post-grid ';

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const missing = (name: string) => new Error(`structure: marker not found: ${name}`);

function find(html: string, marker: string, name: string, from = 0) {
  const at = html.indexOf(marker, from);
  if (at < 0) throw missing(name);
  return at;
}

/** Replaces the first match of `pattern`; `replace` gets the match and its groups. */
function replaceOnce(html: string, pattern: RegExp, replace: (...match: string[]) => string, name: string) {
  const match = pattern.exec(html);
  if (!match) throw missing(name);
  return html.slice(0, match.index) + replace(...match) + html.slice(match.index + match[0].length);
}

/** The whole `<div …>…</div>` element starting at `start` (nested divs balanced). */
function divAt(html: string, start: number, name: string) {
  const tags = /<div\b|<\/div>/g;
  tags.lastIndex = start;
  let depth = 0;
  for (let tag = tags.exec(html); tag; tag = tags.exec(html)) {
    depth += tag[0] === "</div>" ? -1 : 1;
    if (depth === 0) return html.slice(start, tags.lastIndex);
  }
  throw missing(`${name} end`);
}

const resourcesMain = (page: 1 | 2 = 1) => loadPage(page === 1 ? "resources" : "resources__page__2").main;

/** Where `.entry-content` closes (followed by the article, main and wrapper closes). */
function entryEnd(main: string) {
  const end = main.lastIndexOf(ENTRY_CLOSE);
  if (end < 0) throw missing("entry-content end");
  return end;
}

/** The Resources hero cover, the arrow divider under it and the small spacer after (entry-content children 0–2). */
export function resourcesHero(): string {
  const main = resourcesMain();
  const start = find(main, HERO, "hero");
  const spacer = find(main, SMALL_SPACER, "hero spacer", find(main, ARROW, "arrow divider", start));
  return main.slice(start, spacer + SMALL_SPACER.length);
}

/** The Resources hero with another image (no srcset), heading and optional subheading (left out when not given). */
export function renderHero({ image, heading, subheading }: { image: string; heading: string; subheading?: string }): string {
  let html = resourcesHero();
  html = replaceOnce(html, /<img [^>]*class="wp-block-cover__image-background[^>]*>/, (img) =>
    img.replace(/ src="[^"]*"/, ` src="${esc(image)}"`).replace(/ (?:srcset|sizes)="[^"]*"/g, ""), "hero image");
  html = replaceOnce(html, /(<h2 class="wp-block-heading[^"]*"><strong>)[^<]*(<\/strong><\/h2>)/, (_, open, close) =>
    `${open}${esc(heading)}${close}`, "hero heading");
  // The small spacer and the uppercase line under the heading.
  const sub = /(<\/h2>)(\s*<div aria-hidden="true" class="wp-block-spacer spacer-small-height "><\/div>\s*<p class="has-text-align-center is-style-main[^>]*>)[^<]*(<\/p>)/;
  return replaceOnce(html, sub, (_, h2End, before, pEnd) =>
    subheading === undefined ? h2End : `${h2End}${before}${esc(subheading)}${pEnd}`, "hero subheading");
}

/** From the large spacer to the end of the Resources entry content: "Live Speaking Engagements", the quote and the donate prompt. */
export function closingSections(): string {
  const main = resourcesMain();
  return main.slice(find(main, LARGE_SPACER, "large spacer"), entryEnd(main));
}

/** The Resources "Articles" tab grid for page 1 or 2, its pagination pointing at /articles/. */
export function articlesGrid(page: 1 | 2): string {
  const main = resourcesMain(page);
  const start = main.lastIndexOf(GRID_OPEN, find(main, ARTICLES_GRID, "articles grid"));
  if (start < 0) throw missing("articles grid");
  return divAt(main, start, "articles grid")
    .replaceAll('href="/resources/"', 'href="/articles/"')
    .replaceAll('href="/resources/page/2/"', 'href="/articles/page/2/"');
}

/** The Genesis page wrapper (site-inner › wrap › content-sidebar-wrap › main › article › entry-content) around `inner`. */
export function wrapEntry(ariaLabel: string, inner: string): string {
  const main = resourcesMain();
  const open = find(main, ENTRY_OPEN, "entry-content") + ENTRY_OPEN.length;
  const head = main.slice(0, open);
  if (!head.includes(ARTICLE_TAG)) throw missing("page article");
  // The article loses "post-28" (the Resources page's WordPress id) and gets its own label.
  const article = `<article class="page type-page status-publish entry" aria-label="${esc(ariaLabel)}">`;
  return `${head.replace(ARTICLE_TAG, () => article)}\n${inner}${main.slice(entryEnd(main))}`;
}

/** A centred page heading in Tzion's section style. */
export function sectionHeading(text: string): string {
  return `<h1 class="wp-block-heading has-text-align-center has-dark-blue-color has-text-color is-style-secondary has-60-font-size tz-page-heading">${esc(text)}</h1>`;
}

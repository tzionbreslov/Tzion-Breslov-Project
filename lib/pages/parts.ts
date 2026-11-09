import { loadImportedPage } from "@/lib/content-files";
import { esc, markerMissing, markerRepeated, swapHero, type HeroOptions } from "@/lib/pages/edits.mjs";
import { editSpeakingEmail } from "@/lib/contact-details.mjs";
import { formsEnabled } from "@/lib/client/config";

export { esc, markerMissing };

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
/** The theme's large spacer block (it ends the Gallery page, and starts the Resources closing sections). */
export const LARGE_SPACER = '<div aria-hidden="true" class="wp-block-spacer spacer-large-height "></div>';
const ARTICLES_GRID = "uagb-block-1908e9b6";
const GRID_OPEN = '<div class="wp-block-uagb-post-grid ';

/** Where `marker` occurs; it must occur exactly once, so a re-import can't make a cut pick the wrong copy. */
export function findOnce(html: string, marker: string, name: string) {
  const at = html.indexOf(marker);
  if (at < 0) throw markerMissing(name);
  if (html.includes(marker, at + 1)) throw markerRepeated(name);
  return at;
}

/** Where the next sibling after `from` starts (only whitespace in between); it must start with `marker`. */
function nextSibling(html: string, from: number, marker: string, name: string) {
  const space = /\s*/y;
  space.lastIndex = from;
  space.exec(html);
  if (!html.startsWith(marker, space.lastIndex)) throw markerMissing(name);
  return space.lastIndex;
}

/** The whole `<div …>…</div>` element starting at `start` (nested divs balanced). */
export function divAt(html: string, start: number, name: string) {
  const tags = /<div\b|<\/div>/g;
  tags.lastIndex = start;
  let depth = 0;
  for (let tag = tags.exec(html); tag; tag = tags.exec(html)) {
    depth += tag[0] === "</div>" ? -1 : 1;
    if (depth === 0) return html.slice(start, tags.lastIndex);
  }
  throw markerMissing(`${name} end`);
}

const resourcesMain = (page: 1 | 2 = 1) => loadImportedPage(page === 1 ? "resources" : "resources__page__2").main;

/** Where `.entry-content` closes (followed by the article, main and wrapper closes). */
const entryEnd = (main: string) => findOnce(main, ENTRY_CLOSE, "entry-content end");

/** The Resources hero cover, the arrow divider under it and the small spacer after (entry-content children 0–2). */
export function resourcesHero(): string {
  const main = resourcesMain();
  const start = nextSibling(main, findOnce(main, ENTRY_OPEN, "entry-content") + ENTRY_OPEN.length, HERO, "hero");
  const arrow = nextSibling(main, start + divAt(main, start, "hero").length, ARROW, "arrow divider");
  const spacer = nextSibling(main, arrow + divAt(main, arrow, "arrow divider").length, SMALL_SPACER, "hero spacer");
  return main.slice(start, spacer + SMALL_SPACER.length);
}

/** The Resources hero with another image (no srcset), heading (optionally the page's h1) and optional subheading (left out when not given): lib/pages/edits.mjs. */
export function renderHero(options: HeroOptions): string {
  return swapHero(resourcesHero(), options);
}

/**
 * From the large spacer to the end of the Resources entry content: "Live Speaking Engagements", the quote and the
 * donate prompt. The speaking paragraph's email address is covered, with "Show email" when the forms are on (owner,
 * 2026-11-09: lib/contact-details.mjs).
 */
export function closingSections(): string {
  const main = resourcesMain();
  return editSpeakingEmail(main.slice(findOnce(main, LARGE_SPACER, "large spacer"), entryEnd(main)), { formsOn: formsEnabled() });
}

/** The Resources "Articles" tab grid for page 1 or 2, its pagination pointing at /articles/. */
export function articlesGrid(page: 1 | 2): string {
  const main = resourcesMain(page);
  const id = findOnce(main, ARTICLES_GRID, "articles grid");
  // The id must be a class of the grid's own opening tag, not of something inside it.
  const start = main.lastIndexOf("<div", id);
  if (start < 0 || !main.startsWith(GRID_OPEN, start) || main.indexOf(">", start) < id) throw markerMissing("articles grid");
  const grid = divAt(main, start, "articles grid")
    .replaceAll('href="/resources/"', 'href="/articles/"')
    .replaceAll('href="/resources/page/2/"', 'href="/articles/page/2/"');
  if (grid.includes('href="/resources/')) throw new Error("structure: articles grid still links to /resources/");
  return grid;
}

/** The Genesis page wrapper (site-inner › wrap › content-sidebar-wrap › main › article › entry-content) around `inner`. */
export function wrapEntry(ariaLabel: string, inner: string): string {
  const main = resourcesMain();
  const open = findOnce(main, ENTRY_OPEN, "entry-content") + ENTRY_OPEN.length;
  const head = main.slice(0, open);
  findOnce(head, ARTICLE_TAG, "page article");
  // The article loses "post-28" (the Resources page's WordPress id) and gets its own label.
  const article = `<article class="page type-page status-publish entry" aria-label="${esc(ariaLabel)}">`;
  return `${head.replace(ARTICLE_TAG, () => article)}\n${inner}${main.slice(entryEnd(main))}`;
}

/** A centred page heading in Tzion's section style. */
export function sectionHeading(text: string): string {
  return `<h1 class="wp-block-heading has-text-align-center has-dark-blue-color has-text-color is-style-secondary has-60-font-size tz-page-heading">${esc(text)}</h1>`;
}

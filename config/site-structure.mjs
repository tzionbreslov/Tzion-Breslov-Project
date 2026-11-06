// The site's structure on top of the WordPress import: which pages are added in
// code, which imported pages are removed, and how links to removed pages are
// rewritten. Next (lib/content.ts), the sitemaps (scripts/write-site-files.mjs)
// and every check script read it, so a re-import can't bring old pages back.
import { IMPORTED_ORIGINS } from "./site-url.mjs";

/** Pages composed in code (lib/pages/registry.ts); their keys start with "tz:". */
export const NEW_ROUTES = [
  { path: "/articles/", key: "tz:articles" },
  { path: "/articles/page/2/", key: "tz:articles__page__2" },
  { path: "/classes/", key: "tz:classes" }
];

/**
 * Imported pages (and redirect pages) that no longer exist on the site (owner,
 * 2026-11-06). Old addresses are redirected at the edge after launch, never by
 * pages on the site.
 */
export const REMOVED_PATHS = [
  "/resources/",
  "/resources/page/2/",
  "/resources/page/3/",
  ...Array.from({ length: 27 }, (_, i) => `/video/video-${i + 1}/`),
  "/category/uncategorized/",
  "/category/uncategorized/page/2/",
  "/author/esti-wolo/",
  "/author/esti-wolo/page/2/",
  "/about/"
];

/** Whole sections that are gone: every path under them is removed too. */
export const REMOVED_SECTIONS = ["/video/", "/category/", "/author/", "/resources/"];

/** Exact `href` rewrites for links that pointed at a removed page. */
export const LINK_REWRITES = {
  "/resources/": "/classes/",
  "/about/": "/about-us/"
};

/** Yoast sitemaps that are no longer published. */
export const REMOVED_SITEMAPS = ["video-sitemap.xml", "category-sitemap.xml", "author-sitemap.xml"];

/** Imported page JSONs kept as sources for composed pages, even after their routes are removed. */
export const TEMPLATE_KEYS = ["resources", "resources__page__2"];

/** The Resources page's Instagram tab: off, its code kept dormant (docs/instagram-setup.md). */
export const INSTAGRAM_ENABLED = false;

export function isRemovedPath(path, removed = REMOVED_PATHS, sections = REMOVED_SECTIONS) {
  return removed.includes(path) || sections.some((section) => path.startsWith(section));
}

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Points every absolute URL of a removed page inside JSON (JSON-LD), on the
 * imported origin, plain or with escaped slashes (`https:\/\/…`), at the site
 * root instead. Runs before the origin is rewritten to the configured site URL.
 */
export function stripRemovedUrls(json) {
  let out = json;
  for (const origin of IMPORTED_ORIGINS) {
    for (const slash of ["/", "\\/"]) {
      const base = origin.replaceAll("/", slash);
      const url = new RegExp(`${escapeRegExp(base)}(${escapeRegExp(slash)}[^"\\s<>]*)`, "g");
      out = out.replace(url, (match, rest) => {
        const path = rest.replaceAll("\\/", "/").replace(/[?#].*$/, "");
        return isRemovedPath(path) ? `${base}${slash}` : match;
      });
    }
  }
  return out;
}

/**
 * The routes the site actually serves: content/routes.json minus the removed
 * paths, plus NEW_ROUTES, with no path twice (the first entry wins, so an
 * imported page is never silently replaced). Redirects from a removed path are
 * dropped. `opts` replaces the module's lists (tests). Never mutates `index`.
 */
export function siteRoutes(index, { removed = REMOVED_PATHS, sections = REMOVED_SECTIONS, newRoutes = NEW_ROUTES } = {}) {
  const seen = new Set();
  const routes = [];
  for (const route of [...index.routes, ...newRoutes]) {
    if (isRemovedPath(route.path, removed, sections) || seen.has(route.path)) continue;
    seen.add(route.path);
    routes.push({ path: route.path, key: route.key });
  }
  const redirects = Object.fromEntries(Object.entries(index.redirects).filter(([from]) => !isRemovedPath(from, removed, sections)));
  return { site: index.site, routes, redirects };
}

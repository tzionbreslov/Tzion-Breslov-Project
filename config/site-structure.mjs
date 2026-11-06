// The site's structure on top of the WordPress import: which pages are added in
// code, which imported pages are removed, and how links to removed pages are
// rewritten. Next (lib/content.ts), the sitemaps (scripts/write-site-files.mjs)
// and every check script read it, so a re-import can't bring old pages back.

/** Pages composed in code (lib/pages/registry.ts); their keys start with "tz:". */
export const NEW_ROUTES = [
  { path: "/articles/", key: "tz:articles" },
  { path: "/articles/page/2/", key: "tz:articles__page__2" }
];

/** Imported pages (and redirect pages) that no longer exist on the site. */
export const REMOVED_PATHS = [];

/** Exact `href` rewrites for links that pointed at a removed page. */
export const LINK_REWRITES = {};

/** Yoast sitemaps that are no longer published. */
export const REMOVED_SITEMAPS = [];

/** Imported page JSONs kept as sources for composed pages, even after their routes are removed. */
export const TEMPLATE_KEYS = ["resources", "resources__page__2"];

/** The Resources page's Instagram tab. */
export const INSTAGRAM_ENABLED = true;

export function isRemovedPath(path, removed = REMOVED_PATHS) {
  return removed.includes(path);
}

/**
 * The routes the site actually serves: content/routes.json minus the removed
 * paths, plus NEW_ROUTES, with no path twice (the first entry wins, so an
 * imported page is never silently replaced). Redirects from a removed path are
 * dropped. `opts` replaces the module's lists (tests). Never mutates `index`.
 */
export function siteRoutes(index, { removed = REMOVED_PATHS, newRoutes = NEW_ROUTES } = {}) {
  const seen = new Set();
  const routes = [];
  for (const route of [...index.routes, ...newRoutes]) {
    if (isRemovedPath(route.path, removed) || seen.has(route.path)) continue;
    seen.add(route.path);
    routes.push({ path: route.path, key: route.key });
  }
  const redirects = Object.fromEntries(Object.entries(index.redirects).filter(([from]) => !isRemovedPath(from, removed)));
  return { site: index.site, routes, redirects };
}

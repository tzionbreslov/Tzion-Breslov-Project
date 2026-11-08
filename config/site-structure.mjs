// The site's structure on top of the WordPress import: which pages are added in
// code, which imported pages are removed, and how links to removed pages are
// rewritten. Next (lib/content.ts), the sitemaps (scripts/write-site-files.mjs)
// and every check script read it, so a re-import can't bring old pages back.
import { IMPORTED_ORIGINS } from "./site-url.mjs";

/** The privacy notice: the footer Quick Links and the forms' consent lines link to it. */
export const PRIVACY_PATH = "/privacy/";

/** Pages composed in code (lib/pages/registry.ts); their keys start with "tz:". */
export const NEW_ROUTES = [
  { path: "/articles/", key: "tz:articles" },
  { path: "/articles/page/2/", key: "tz:articles__page__2" },
  { path: "/classes/", key: "tz:classes" },
  { path: "/gallery/", key: "tz:gallery" },
  { path: "/events/", key: "tz:events" },
  { path: PRIVACY_PATH, key: "tz:privacy" }
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

/** `s` with every RegExp metacharacter escaped, to match it literally. */
export const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Matches an absolute URL on any of `origins` whose slashes are written as any
 * of `slashes`: "/", or JSON's escaped "\/" (`https:\/\/…`, as in JSON-LD).
 * Group 1 is the URL's path, from its first slash up to a quote, a space or an
 * angle bracket. Shared by stripRemovedUrls and the static-export check
 * (scripts/lib/export-guard.mjs).
 */
export function originUrlRegExp(origins, slashes = ["/"]) {
  const spelled = origins.flatMap((origin) => slashes.map((slash) => escapeRegExp(origin.replaceAll("/", slash))));
  return new RegExp(`(?:${spelled.join("|")})((?:${slashes.map(escapeRegExp).join("|")})[^"\\s<>]*)`, "g");
}

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
      const url = originUrlRegExp([origin], [slash]);
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
 * paths, plus NEW_ROUTES, with no path twice. A new page on a removed path
 * (REMOVED_PATHS or under REMOVED_SECTIONS), on a path that routes.json still
 * serves (as a page or a redirect), or listed twice in NEW_ROUTES, throws: an
 * imported page is never silently replaced, and a new page never silently
 * dropped. Redirects from a removed path are dropped. `opts` replaces the
 * module's lists (tests). Never mutates `index`.
 */
export function siteRoutes(index, { removed = REMOVED_PATHS, sections = REMOVED_SECTIONS, newRoutes = NEW_ROUTES } = {}) {
  const kept = (path) => !isRemovedPath(path, removed, sections);
  const redirects = Object.fromEntries(Object.entries(index.redirects).filter(([from]) => kept(from)));
  const imported = new Map();
  const added = new Map();
  for (const route of index.routes) if (kept(route.path) && !imported.has(route.path)) imported.set(route.path, route);
  for (const route of newRoutes) {
    const section = sections.find((prefix) => route.path.startsWith(prefix));
    const clash = removed.includes(route.path) ? "is a removed path (REMOVED_PATHS)"
      : section ? `is under the removed section ${section} (REMOVED_SECTIONS)`
      : imported.has(route.path) ? `is already a page in content/routes.json (key ${imported.get(route.path).key})`
      : Object.hasOwn(redirects, route.path) ? `is already a redirect in content/routes.json (to ${redirects[route.path]})`
      : added.has(route.path) ? `is listed twice in NEW_ROUTES (key ${added.get(route.path).key})`
      : null;
    if (clash) throw new Error(`structure: NEW_ROUTES path ${route.path} (${route.key}) ${clash}`);
    added.set(route.path, route);
  }
  const routes = [...imported.values(), ...added.values()].map(({ path, key }) => ({ path, key }));
  return { site: index.site, routes, redirects };
}

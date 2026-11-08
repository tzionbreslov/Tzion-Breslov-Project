import { cache } from "react";
import { siteRoutes, type RouteIndex } from "@/config/site-structure.mjs";
import { loadImportedPage, readShared, type PageContent } from "@/lib/content-files";
import { buildPage } from "@/lib/pages/registry";

/**
 * Build-time access to the content imported from WordPress
 * (see scripts/import-wordpress.mjs), plus the pages composed in code
 * (lib/pages, keys starting with "tz:"). Which routes exist is decided by
 * config/site-structure.mjs. Server-only. The files and the page shape are
 * lib/content-files.ts, which lib/pages imports instead of this module.
 */

export { readShared };
export type { Attrs, HeadItem, Island, PageContent, ScriptItem } from "@/lib/content-files";

export const routeIndex = cache((): RouteIndex => siteRoutes(JSON.parse(readShared("routes.json"))));

export const loadPage = cache((key: string): PageContent =>
  key.startsWith("tz:") ? buildPage(key) : loadImportedPage(key));

/** "/articles/page/2/" <-> ["articles", "page", "2"] */
export function slugToPath(slug: string[] | undefined) {
  return slug?.length ? `/${slug.map(decodeURIComponent).join("/")}/` : "/";
}

export function pathToSlug(routePath: string) {
  return routePath.split("/").filter(Boolean);
}

export type ResolvedRoute =
  | { kind: "page"; page: PageContent }
  | { kind: "redirect"; to: string };

export function resolveRoute(slug: string[] | undefined): ResolvedRoute | null {
  const routePath = slugToPath(slug);
  const index = routeIndex();
  const match = index.routes.find((route) => route.path === routePath);
  if (match) return { kind: "page", page: loadPage(match.key) };
  const to = index.redirects[routePath];
  return to ? { kind: "redirect", to } : null;
}

export function allSlugs() {
  const index = routeIndex();
  return [...index.routes.map((r) => r.path), ...Object.keys(index.redirects)].map(pathToSlug);
}

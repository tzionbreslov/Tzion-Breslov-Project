import fs from "node:fs";
import path from "node:path";
import { cache } from "react";

/**
 * Build-time access to the content imported from WordPress
 * (see scripts/import-wordpress.mjs). Server-only.
 */

export type Attrs = Record<string, string>;

export type ScriptItem = { attrs: Attrs; ref?: string };

export type HeadItem =
  | { t: "title"; text: string }
  | { t: "meta"; attrs: Attrs }
  | { t: "link"; attrs: Attrs }
  | { t: "style"; id: string | null; ref: string }
  | { t: "jsonld"; json: string }
  | ({ t: "script" } & ScriptItem);

export type Island = "signup" | "contact" | "donate" | "youtube-feed" | "post-grid" | "instagram-feed";

export type PageContent = {
  path: string | null;
  htmlAttrs: Attrs;
  bodyClass: string;
  siteContainerClass: string;
  head: HeadItem[];
  skipLinks: string | null;
  header: string | null;
  main: string;
  footer: string | null;
  footerExtra: string;
  bodyScripts: ScriptItem[];
  islands: Island[];
};

type RouteIndex = {
  site: string;
  routes: Array<{ path: string; key: string }>;
  redirects: Record<string, string>;
};

const contentDir = path.join(process.cwd(), "content");

export const readShared = cache((ref: string) => fs.readFileSync(path.join(contentDir, ref), "utf8"));

export const routeIndex = cache((): RouteIndex => JSON.parse(readShared("routes.json")));

export const loadPage = cache((key: string): PageContent => JSON.parse(readShared(`pages/${key}.json`)));

/** "/video/video-1/" <-> ["video", "video-1"] */
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

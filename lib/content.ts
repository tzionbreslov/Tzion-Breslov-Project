import fs from "node:fs";
import path from "node:path";
import { cache } from "react";
import { siteRoutes, type RouteIndex } from "@/config/site-structure.mjs";
import { buildPage } from "@/lib/pages/registry";

/**
 * Build-time access to the content imported from WordPress
 * (see scripts/import-wordpress.mjs), plus the pages composed in code
 * (lib/pages, keys starting with "tz:"). Which routes exist is decided by
 * config/site-structure.mjs. Server-only.
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

export type Island = "signup" | "contact" | "donate" | "youtube-feed" | "post-grid" | "instagram-feed" | "video-library";

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

const contentDir = path.join(process.cwd(), "content");

export const readShared = cache((ref: string) => fs.readFileSync(path.join(contentDir, ref), "utf8"));

export const routeIndex = cache((): RouteIndex => siteRoutes(JSON.parse(readShared("routes.json"))));

export const loadPage = cache((key: string): PageContent =>
  key.startsWith("tz:") ? buildPage(key) : JSON.parse(readShared(`pages/${key}.json`)));

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

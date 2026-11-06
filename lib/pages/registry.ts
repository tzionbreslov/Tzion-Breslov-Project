import { NEW_ROUTES } from "@/config/site-structure.mjs";
import type { PageContent } from "@/lib/content";
import { articlesPage } from "@/lib/pages/articles";
import { classesPage } from "@/lib/pages/classes";
import { galleryPage } from "@/lib/pages/gallery";

/** Builders for the pages composed in code, by route key (NEW_ROUTES in config/site-structure.mjs). */
const BUILDERS: Record<string, (path: string) => PageContent> = {
  "tz:articles": (path) => articlesPage(path, 1),
  "tz:articles__page__2": (path) => articlesPage(path, 2),
  "tz:classes": classesPage,
  "tz:gallery": galleryPage
};

export function buildPage(key: string): PageContent {
  const route = NEW_ROUTES.find((r) => r.key === key);
  const build = BUILDERS[key];
  if (!route || !build) throw new Error(`structure: no composed page for ${key}`);
  return build(route.path);
}

import copy from "@/content/copy/en.json";
import type { PageContent } from "@/lib/content-files";
import { composePage } from "@/lib/pages/compose";
import { articlesGrid, closingSections, resourcesHero, sectionHeading, wrapEntry } from "@/lib/pages/parts";

/**
 * The Articles page: the Resources header, then the 18 weekly Parasha articles
 * exactly as the Resources "Articles" tab lists them (same cards, same in-place
 * pagination, page 2 at /articles/page/2/), then the Resources closing sections.
 */
export function articlesPage(path: string, page: 1 | 2): PageContent {
  const text = copy.articles;
  return composePage({
    path,
    title: text.title,
    description: text.description,
    slug: "articles",
    main: wrapEntry(text.title, resourcesHero() + sectionHeading(text.heading) + articlesGrid(page) + closingSections()),
    islands: ["signup", "post-grid"]
  });
}

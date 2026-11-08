import { loadPage, type HeadItem, type Island, type PageContent } from "@/lib/content";
import { markerMissing } from "@/lib/pages/parts";
import { SITE_URL } from "@/lib/site-url";

/**
 * A page composed in code (lib/pages/registry.ts) gets everything around its
 * main HTML from the imported Resources page: the stylesheets, theme scripts,
 * header, footer and skip links. Only its own title, description, URL and
 * share image replace the Resources page's.
 */

export type ComposedPageDef = {
  path: string;
  title: string;
  description: string;
  /** Body class `page-id-tz-{slug}` (instead of the Resources page's `page-id-28`). */
  slug: string;
  main: string;
  islands: Island[];
  /** The page's hero image (root-relative), shared as its og:image like the imported pages' heroes. Default: the Resources hero. */
  image?: string;
};

const SITE_NAME = "Tzion Breslov";
/** The Resources page's hero, which Classes and Articles open with (lib/pages/parts.ts resourcesHero). */
const RESOURCES_HERO_IMAGE = "/wp-content/uploads/2023/06/resources.png";
/** The Resources page's tabs initialiser (uag-js-28.js): new pages have no tabs. */
const TABS_SCRIPT_ID = "uag-script-28-js";
const PAGE_ID_CLASS = /\bpage-id-28\b/;

/** The Resources page's own title, description, social and article:* tags, canonical/short links, oEmbed links and JSON-LD. */
function isResourcesOwn(item: HeadItem) {
  switch (item.t) {
    case "title":
    case "jsonld":
      return true;
    case "meta": {
      const key = item.attrs.name ?? item.attrs.property ?? "";
      return key === "description" || key.startsWith("og:") || key.startsWith("twitter:") || key.startsWith("article:");
    }
    case "link": {
      const { rel = "", type = "" } = item.attrs;
      return rel === "canonical" || rel === "shortlink" || (rel === "alternate" && type.includes("oembed"));
    }
    default:
      return false;
  }
}

export function composePage(def: ComposedPageDef): PageContent {
  const template = loadPage("resources");
  const title = `${def.title} - ${SITE_NAME}`;
  const url = `${SITE_URL}${def.path}`;
  const own: HeadItem[] = [
    { t: "title", text: title },
    { t: "meta", attrs: { name: "description", content: def.description } },
    { t: "link", attrs: { rel: "canonical", href: url } },
    { t: "meta", attrs: { property: "og:type", content: "website" } },
    { t: "meta", attrs: { property: "og:title", content: title } },
    { t: "meta", attrs: { property: "og:description", content: def.description } },
    { t: "meta", attrs: { property: "og:url", content: url } },
    { t: "meta", attrs: { property: "og:site_name", content: SITE_NAME } },
    // As every imported page has them (Yoast): its hero as the share image, a large-image card, the site's handle.
    { t: "meta", attrs: { property: "og:image", content: `${SITE_URL}${def.image ?? RESOURCES_HERO_IMAGE}` } },
    { t: "meta", attrs: { name: "twitter:card", content: "summary_large_image" } },
    { t: "meta", attrs: { name: "twitter:site", content: "@tzionbreslov" } }
  ];
  // The new tags go where the Resources page's own ones began: its title, after robots, before the stylesheets.
  const at = template.head.findIndex(isResourcesOwn);
  if (at < 0) throw markerMissing("Resources head title");
  const head = template.head.filter((item) => !isResourcesOwn(item));
  head.splice(at, 0, ...own);
  if (!PAGE_ID_CLASS.test(template.bodyClass)) throw markerMissing("page-id-28 body class");
  const bodyScripts = template.bodyScripts.filter((item) => item.attrs.id !== TABS_SCRIPT_ID);
  if (bodyScripts.length !== template.bodyScripts.length - 1) throw markerMissing(TABS_SCRIPT_ID);
  return {
    // htmlAttrs, siteContainerClass, skipLinks, header, footer and footerExtra stay as they are.
    ...template,
    path: def.path,
    head,
    bodyClass: template.bodyClass.replace(PAGE_ID_CLASS, `page-id-tz-${def.slug}`),
    main: def.main,
    bodyScripts,
    islands: def.islands
  };
}

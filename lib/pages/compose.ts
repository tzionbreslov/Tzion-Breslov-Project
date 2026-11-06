import { loadPage, type HeadItem, type Island, type PageContent } from "@/lib/content";
import { SITE_URL } from "@/lib/site-url";

/**
 * A page composed in code (lib/pages/registry.ts) gets everything around its
 * main HTML from the imported Resources page: the stylesheets, theme scripts,
 * header, footer and skip links. Only its own title, description and URL
 * replace the Resources page's.
 */

export type ComposedPageDef = {
  path: string;
  title: string;
  description: string;
  /** Body class `page-id-tz-{slug}` (instead of the Resources page's `page-id-28`). */
  slug: string;
  main: string;
  islands: Island[];
};

const SITE_NAME = "Tzion Breslov";
/** The Resources page's tabs initialiser (uag-js-28.js): new pages have no tabs. */
const TABS_SCRIPT_ID = "uag-script-28-js";

/** The Resources page's own title, description, social tags, canonical/short links, oEmbed links and JSON-LD. */
function isResourcesOwn(item: HeadItem) {
  switch (item.t) {
    case "title":
    case "jsonld":
      return true;
    case "meta": {
      const key = item.attrs.name ?? item.attrs.property ?? "";
      return key === "description" || key.startsWith("og:") || key.startsWith("twitter:");
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
    { t: "meta", attrs: { property: "og:site_name", content: SITE_NAME } }
  ];
  // The new tags go where the Resources title was (after robots, before the stylesheets).
  const at = template.head.findIndex(isResourcesOwn);
  const head = template.head.filter((item) => !isResourcesOwn(item));
  head.splice(at < 0 ? 0 : at, 0, ...own);
  return {
    // htmlAttrs, siteContainerClass, skipLinks, header, footer and footerExtra stay as they are.
    ...template,
    path: def.path,
    head,
    bodyClass: template.bodyClass.replace(/\bpage-id-28\b/, `page-id-tz-${def.slug}`),
    main: def.main,
    bodyScripts: template.bodyScripts.filter((item) => item.attrs.id !== TABS_SCRIPT_ID),
    islands: def.islands
  };
}

/**
 * The site's public origin, used for canonical links, Open Graph/Twitter tags,
 * structured data, sitemaps and robots.txt. Content is imported with the
 * WordPress origin (https://tzionbreslov.com); set NEXT_PUBLIC_SITE_URL (e.g.
 * https://tzionbreslov.org) to publish under another domain.
 */
export const IMPORTED_ORIGIN = "https://tzionbreslov.com";

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL?.trim() || IMPORTED_ORIGIN).replace(/\/+$/, "");

// JSON-LD from Yoast escapes slashes: https:\/\/tzionbreslov.com
const ESCAPED_IMPORTED = IMPORTED_ORIGIN.replaceAll("/", "\\/");
const ESCAPED_SITE = SITE_URL.replaceAll("/", "\\/");

/** Rewrites the imported origin (plain and JSON-escaped) to SITE_URL. */
export function toSiteUrl(text: string) {
  if (SITE_URL === IMPORTED_ORIGIN) return text;
  return text.replaceAll(IMPORTED_ORIGIN, SITE_URL).replaceAll(ESCAPED_IMPORTED, ESCAPED_SITE);
}

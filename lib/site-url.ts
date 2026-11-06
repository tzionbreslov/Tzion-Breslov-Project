/**
 * The site's public origin, used for canonical links, Open Graph/Twitter tags,
 * structured data, sitemaps and robots.txt. Content is imported with the
 * WordPress origin (https://tzionbreslov.com); set NEXT_PUBLIC_SITE_URL (e.g.
 * https://tzionbreslov.org) to publish under another domain. Validation and
 * rewriting live in config/site-url.mjs, shared with the build scripts.
 */
import { IMPORTED_ORIGIN, resolveSiteUrl, rewriteOrigin } from "@/config/site-url.mjs";

export { IMPORTED_ORIGIN };

export const SITE_URL: string = resolveSiteUrl(process.env.NEXT_PUBLIC_SITE_URL);

/** Rewrites the imported origin (plain and JSON-escaped, http and https) to SITE_URL. */
export function toSiteUrl(text: string): string {
  return rewriteOrigin(text, SITE_URL);
}

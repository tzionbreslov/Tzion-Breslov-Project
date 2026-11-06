// The site's public origin (NEXT_PUBLIC_SITE_URL), shared by the Next.js
// renderer (lib/site-url.ts), scripts/write-site-files.mjs and
// scripts/check-static-export.mjs so they can never disagree.

/** Origin the WordPress content was imported with. */
export const IMPORTED_ORIGIN = "https://tzionbreslov.com";

/** Every spelling of the imported origin that appears in imported content. */
export const IMPORTED_ORIGINS = ["https://tzionbreslov.com", "http://tzionbreslov.com"];

/**
 * Returns the validated public origin (no trailing slash). Unset → the
 * imported origin. Anything but a bare https origin throws, so a typo can't
 * silently produce relative canonicals or a broken robots.txt.
 */
export function resolveSiteUrl(raw) {
  const value = raw?.trim().replace(/\/+$/, "");
  if (!value) return IMPORTED_ORIGIN;
  let url;
  try { url = new URL(value); } catch { url = null; }
  if (!url || url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`NEXT_PUBLIC_SITE_URL must be a bare https origin such as https://tzionbreslov.org (got ${JSON.stringify(raw)})`);
  }
  return url.origin;
}

/** Rewrites the imported origin (plain and JSON-escaped, http and https) to `site`. */
export function rewriteOrigin(text, site) {
  if (site === IMPORTED_ORIGIN) return text;
  const escapedSite = site.replaceAll("/", "\\/");
  let out = text;
  for (const origin of IMPORTED_ORIGINS) {
    out = out.replaceAll(origin, site).replaceAll(origin.replaceAll("/", "\\/"), escapedSite);
  }
  return out;
}

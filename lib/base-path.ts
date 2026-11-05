/**
 * The imported WordPress HTML uses root-relative URLs (/about-us/,
 * /wp-content/…). When the site is served from a sub-path — e.g. the GitHub
 * Pages project URL before the custom domain is live — prefix them at build
 * time. With no NEXT_PUBLIC_BASE_PATH this is a no-op.
 */

const raw = process.env.NEXT_PUBLIC_BASE_PATH?.trim() ?? "";
export const BASE_PATH = raw ? `/${raw.replace(/^\/+|\/+$/g, "")}` : "";

/** Prefix one root-relative URL ("/x" but not "//host"). */
export function withBase(url: string) {
  return BASE_PATH && url.startsWith("/") && !url.startsWith("//") ? BASE_PATH + url : url;
}

/** Prefix root-relative URLs inside HTML attributes and inline CSS. */
export function rebaseHtml(html: string) {
  if (!BASE_PATH) return html;
  return html
    .replace(/\b(href|src|action|poster|data-src|data-full-res)=(["'])\/(?!\/)/g, `$1=$2${BASE_PATH}/`)
    .replace(/\bsrcset=(["'])([^"']*)\1/g, (_, q: string, set: string) =>
      `srcset=${q}${set.replace(/(^|,\s*)\/(?!\/)/g, `$1${BASE_PATH}/`)}${q}`)
    .replace(/url\((["']?)\/(?!\/)/g, `url($1${BASE_PATH}/`);
}

/** Prefix root-relative url(...) references in CSS. */
export function rebaseCss(css: string) {
  return BASE_PATH ? css.replace(/url\((["']?)\/(?!\/)/g, `url($1${BASE_PATH}/`) : css;
}

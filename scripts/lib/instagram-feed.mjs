// Pure helpers for scripts/sync-instagram.mjs (Meta's official Instagram API,
// read at build time). No network or file access here, so it is unit-tested
// in scripts/instagram-feed.test.mjs.
//
// Docs: IG User /media edge + IG Media fields. Notes from the 2026-11-06 research:
// - media_product_type is "Facebook Login only" → derive "reel" from media_type.
// - permalink cannot be requested on carousel children.
// - the API returns no image dimensions → measured from the downloaded file.
// - media_url may be omitted for videos (licensed audio) → use thumbnail_url.

export const MEDIA_FIELDS =
  "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,alt_text,children{id,media_type,media_url,thumbnail_url}";

const ID = /^\d{5,30}$/;
const PERMALINK = /^https:\/\/www\.instagram\.com\/(p|reel|tv)\/[A-Za-z0-9_-]+\/?(\?.*)?$/;

/** First page URL. The token is passed separately so it is never part of a logged string. */
export function mediaUrl({ host = "graph.facebook.com", version, userId, limit = 50 }) {
  if (!/^v\d+\.\d+$/.test(version ?? "")) throw new Error("INSTAGRAM_API_VERSION must look like v27.0");
  if (!ID.test(userId ?? "")) throw new Error("INSTAGRAM_USER_ID must be the numeric Instagram account id");
  if (!/^graph\.(facebook|instagram)\.com$/.test(host)) throw new Error("INSTAGRAM_API_HOST must be graph.facebook.com or graph.instagram.com");
  const url = new URL(`https://${host}/${version}/${userId}/media`);
  url.searchParams.set("fields", MEDIA_FIELDS);
  url.searchParams.set("limit", String(limit));
  return url.toString();
}

/**
 * Classifies a Graph API failure so an outage never breaks a deploy while a
 * dead token is loudly reported. https://developers.facebook.com/docs/graph-api/guides/error-handling
 * @returns {"token" | "outage" | "malformed"}
 */
export function classifyGraphError(status, body) {
  const code = body?.error?.code;
  if (code === 190 || code === 10 || code === 200 || (code >= 200 && code <= 299) || status === 401 || status === 403) return "token";
  if ([1, 2, 4, 17, 32, 341, 368, 613, 80002].includes(code) || status === 429 || status >= 500) return "outage";
  return "malformed";
}

/** Validates one /media page and returns { items, next }. Throws on anything unexpected. */
export function parseMediaPage(json) {
  if (!json || typeof json !== "object" || !Array.isArray(json.data)) throw new Error("Instagram API returned an unexpected payload (no data array).");
  const next = json.paging?.next;
  if (next !== undefined && (typeof next !== "string" || !/^https:\/\/graph\.(facebook|instagram)\.com\//.test(next))) {
    throw new Error("Instagram API returned an unexpected paging.next URL.");
  }
  return { items: json.data, next: next ?? null };
}

const imageOf = (m) => (m?.media_type === "VIDEO" ? m.thumbnail_url : m?.media_url ?? m?.thumbnail_url);
const isHttps = (u) => typeof u === "string" && u.startsWith("https://");

/**
 * Maps one IG Media object to the site's post shape, with remote image URLs
 * still to be downloaded: { post, remote: [{ key, url }] } or { skip: reason }.
 */
export function mapMedia(item) {
  if (!item || !ID.test(String(item.id ?? ""))) throw new Error("Instagram API returned a media item without a valid id.");
  if (!PERMALINK.test(item.permalink ?? "")) return { skip: `post ${item.id}: unexpected permalink` };
  if (Number.isNaN(Date.parse(item.timestamp ?? ""))) return { skip: `post ${item.id}: invalid timestamp` };

  const type = item.media_type === "CAROUSEL_ALBUM" ? "carousel" : item.media_type === "VIDEO" || /\/reel\//.test(item.permalink) ? "reel" : "image";
  const sources = type === "carousel" ? (item.children?.data ?? []) : [item];
  const remote = sources
    .map((m) => ({ key: String(m.id ?? item.id), url: imageOf(m) }))
    .filter((r) => ID.test(r.key) && isHttps(r.url));
  if (!remote.length) return { skip: `post ${item.id}: no usable image` };

  const caption = typeof item.caption === "string" ? item.caption.slice(0, 2200) : "";
  const alt = typeof item.alt_text === "string" ? item.alt_text.slice(0, 500) : "";
  return {
    post: { id: String(item.id), permalink: item.permalink.replace(/\?.*$/, ""), type, caption, timestamp: new Date(item.timestamp).toISOString(), alt },
    remote
  };
}

/** Files we write for a media key (WebP, keyed by Instagram id, so re-runs skip existing ones). */
export const localImagePath = (key) => `/media/instagram/${key}.webp`;

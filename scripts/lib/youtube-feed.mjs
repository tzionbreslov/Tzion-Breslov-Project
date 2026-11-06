// Parsing + merging for the channel's public RSS feed (adapted from the Ruach
// Breslov project). Strict on content, so a malformed or wrong-channel feed can
// never overwrite content/youtube.json.

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const CHANNEL_ID_PATTERN = /^UC[A-Za-z0-9_-]{22}$/;

export const feedUrl = (channelId) => `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;

function decodeXml(value) {
  const named = { amp: "&", apos: "'", gt: ">", lt: "<", quot: '"' };
  return value
    .replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/i, "$1")
    .replace(/&#(x[\da-f]+|\d+);|&([a-z]+);/gi, (match, numeric, name) => {
      if (numeric) {
        const hex = numeric[0].toLowerCase() === "x";
        const code = Number.parseInt(hex ? numeric.slice(1) : numeric, hex ? 16 : 10);
        const scalar = Number.isInteger(code) && code >= 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff);
        return scalar ? String.fromCodePoint(code) : match;
      }
      return named[name.toLowerCase()] ?? match;
    });
}

function extractText(xml, tag) {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = xml.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)</${escaped}>`, "i"));
  if (!match) return "";
  return [...decodeXml(match[1])]
    .map((ch) => ((ch.codePointAt(0) ?? 0) < 32 || ch.codePointAt(0) === 127 ? " " : ch))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

/** The upload's public view count (`<media:statistics views="N">`), or undefined when the feed has none. */
function extractViews(entry) {
  // Number(undefined) is NaN: no statistics, or a count that isn't digits, means no count.
  const views = Number(entry.match(/<media:statistics\b[^>]*\bviews="(\d+)"/i)?.[1]);
  return Number.isSafeInteger(views) ? views : undefined;
}

/**
 * @returns {Array<{id: string, title: string, published: string, views?: number}>} newest first, as YouTube
 * lists them; `views` only when the feed gives a count
 */
export function parseYouTubeFeed(xml, expectedChannelId) {
  if (typeof xml !== "string" || !xml.trim()) throw new Error("YouTube returned an empty channel feed.");
  if (!CHANNEL_ID_PATTERN.test(expectedChannelId)) throw new Error("The configured YouTube channel ID is invalid.");

  const entries = [...xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)].map((m) => m[0]);
  if (!entries.length) throw new Error("YouTube returned no public uploads; content/youtube.json was not changed.");
  if (entries.length > 50) throw new Error("YouTube returned an unexpectedly large channel feed.");

  const videos = entries.map((entry) => {
    const id = extractText(entry, "yt:videoId");
    const channelId = extractText(entry, "yt:channelId");
    const title = extractText(entry, "title");
    const published = extractText(entry, "published");
    if (channelId !== expectedChannelId) throw new Error(`Feed entry ${id || "<unknown>"} belongs to an unexpected channel.`);
    if (!VIDEO_ID_PATTERN.test(id)) throw new Error("The channel feed contained an invalid video ID.");
    if (!title || title.length > 300) throw new Error(`Feed entry ${id} has an invalid title.`);
    if (!published || Number.isNaN(Date.parse(published))) throw new Error(`Feed entry ${id} has an invalid publication date.`);
    const views = extractViews(entry);
    return { id, title, published: new Date(published).toISOString(), ...(views === undefined ? {} : { views }) };
  });

  if (new Set(videos.map((v) => v.id)).size !== videos.length) throw new Error("The channel feed contained duplicate video IDs.");
  return videos;
}

/**
 * Adds unseen uploads, refreshes the fields of known ones (titles, view counts:
 * the feed is newer), and keeps everything that has scrolled out of the feed's
 * 15-entry window, with its last known count.
 */
export function mergeYouTubeVideos(current, incoming) {
  if (!Array.isArray(current)) throw new Error("content/youtube.json videos must be an array.");
  const byId = new Map();
  for (const video of current) {
    if (!VIDEO_ID_PATTERN.test(video?.id) || byId.has(video.id)) throw new Error("content/youtube.json contains an invalid or duplicate video ID.");
    byId.set(video.id, video);
  }
  const added = [];
  for (const video of incoming) {
    if (!byId.has(video.id)) added.push(video.id);
    byId.set(video.id, { ...byId.get(video.id), ...video });
  }
  const videos = [...byId.values()].sort((a, b) => Date.parse(b.published) - Date.parse(a.published));
  return { videos, added };
}

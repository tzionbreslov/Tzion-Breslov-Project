import fs from "node:fs";
import path from "node:path";
import { withBase } from "./base-path";

/**
 * Resources page "Instagram" tab (an addition the owner asked for; the WordPress
 * site never had it). Rendered at build time from content/instagram.json —
 * refreshed by scripts/sync-instagram.mjs — so the grid is plain HTML that works
 * without JavaScript. lib/client/instagram.ts adds the in-site preview.
 */

export type InstagramMedia = { src: string; width: number; height: number };
export type InstagramPost = {
  id: string;
  permalink: string;
  type: "image" | "carousel" | "reel";
  caption: string;
  timestamp: string;
  media: InstagramMedia[];
};
export type InstagramFeed = {
  username: string;
  name: string;
  profileUrl: string;
  avatar: string;
  perPage: number;
  syncedAt: string | null;
  posts: InstagramPost[];
};

/** Payload the client preview reads (URLs already include any base path). */
export type InstagramClientPost = Omit<InstagramPost, "media"> & { date: string; media: InstagramMedia[] };
export type InstagramClientData = { name: string; avatar: string; profileUrl: string; posts: InstagramClientPost[] };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// Keep "</script>" (and friends) out of the inline JSON.
const safeJson = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");

const formatDate = (iso: string) =>
  new Intl.DateTimeFormat("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(iso));

/** First sentence-ish of a caption, for alt text and the hover wash. */
export function excerpt(caption: string, max = 140) {
  const flat = caption.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).replace(/\s+\S*$/, "")}…` : flat;
}

const ICONS = {
  carousel: `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 3h11a2 2 0 0 1 2 2v11h-2V5H8z"/><rect x="3" y="7" width="13" height="14" rx="2"/></svg>`,
  reel: `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="3" y="3" width="18" height="18" rx="5"/><path d="M10 8.5v7l6-3.5z" fill="#fff"/></svg>`
};

function readFeed(): InstagramFeed {
  // INSTAGRAM_DATA lets local development render a fixture (scripts/fixtures).
  const file = process.env.INSTAGRAM_DATA ?? path.join(process.cwd(), "content", "instagram.json");
  return JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
}

function tile(post: InstagramPost, index: number, hidden: boolean) {
  const cover = post.media[0];
  const label = `${post.type === "reel" ? "Reel" : post.type === "carousel" ? `${post.media.length} photos` : "Photo"} from ${formatDate(post.timestamp)}${post.caption ? `: ${excerpt(post.caption, 100)}` : ""}`;
  const badge = post.type === "image" ? "" : `<span class="tz-ig__badge tz-ig__badge--${post.type}">${ICONS[post.type]}</span>`;
  return `<li class="tz-ig__item${hidden ? " tz-more" : ""}"><a class="tz-ig__tile" href="${esc(post.permalink)}" target="_blank" rel="noopener" data-ig-index="${index}" aria-label="${esc(label)}"><img src="${esc(cover.src)}" width="${cover.width}" height="${cover.height}" alt="" loading="lazy" decoding="async">${badge}<span class="tz-ig__wash" aria-hidden="true"><span class="tz-ig__excerpt">${esc(excerpt(post.caption, 120))}</span></span></a></li>`;
}

export function renderInstagramFeed() {
  const feed = readFeed();
  const profile = `<div class="tz-ig__profile"><img class="tz-ig__avatar" src="${esc(feed.avatar)}" width="56" height="56" alt=""><div class="tz-ig__who"><span class="tz-ig__name">${esc(feed.name)}</span><a class="tz-ig__handle" href="${esc(feed.profileUrl)}" target="_blank" rel="noopener">@${esc(feed.username)}</a></div><a class="tz-ig__follow" href="${esc(feed.profileUrl)}" target="_blank" rel="noopener">Follow on Instagram</a></div>`;

  if (!feed.posts.length) {
    return `<div class="tz-ig tz-ig--empty">${profile}<p class="tz-ig__empty">See the latest posts and reels on <a href="${esc(feed.profileUrl)}" target="_blank" rel="noopener">Instagram</a>.</p></div>`;
  }

  const items = feed.posts.map((post, i) => tile(post, i, i >= feed.perPage)).join("");
  const more = feed.posts.length > feed.perPage
    ? `<div class="tz-ig__more"><button type="button" class="tz-ig__load">Show more posts</button><span class="tz-ig__status" role="status" aria-live="polite"></span></div>`
    : "";
  const data: InstagramClientData = {
    name: feed.name,
    avatar: withBase(feed.avatar),
    profileUrl: feed.profileUrl,
    posts: feed.posts.map((p) => ({ ...p, date: formatDate(p.timestamp), media: p.media.map((m) => ({ ...m, src: withBase(m.src) })) }))
  };
  return `<div class="tz-ig" data-tz-instagram-feed data-per-page="${feed.perPage}">${profile}<ul class="tz-ig__grid" role="list">${items}</ul>${more}<script type="application/json" class="tz-ig__data">${safeJson(data)}</script></div>`;
}

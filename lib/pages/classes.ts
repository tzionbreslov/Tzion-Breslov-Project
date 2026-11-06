import copy from "@/content/copy/en.json";
import { readShared, type PageContent } from "@/lib/content";
import { composePage } from "@/lib/pages/compose";
import { closingSections, resourcesHero, wrapEntry } from "@/lib/pages/parts";
import { formatMonthYear, sortVideos, type LibraryVideo } from "@/lib/video-library.mjs";

/**
 * The Classes page: Ruach Breslov's video library (channel header, Videos and
 * Shorts tabs, search, sort, an on-site player) in Tzion's look, between the
 * Resources header and the Resources closing sections. Videos are the channel's
 * latest uploads (content/youtube.json, refreshed at build time), Shorts the
 * old site's bite-size clips (content/shorts.json). Every card is a link to the
 * video on YouTube; lib/client/video-library.ts plays it on the page instead.
 */

const CHANNEL_URL = "https://youtube.com/@tzionbreslovproject";
const LOGO = "/wp-content/uploads/2023/06/footer-logo.png";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const views = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

// Icons (decorative; the controls carry their own labels).
const svg = (body: string, className = "") =>
  `<svg${className ? ` class="${className}"` : ""} viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;
const SEARCH = svg('<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>');
const CLEAR = svg('<path d="M6 6l12 12M18 6 6 18"/>');
const EXTERNAL = svg('<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>');
const PLAY = svg('<path d="M8 5.5v13l10.5-6.5z"/>');

type Kind = "video" | "short";

function card(video: LibraryVideo, kind: Kind) {
  const text = copy.classes;
  const id = esc(video.id);
  const title = esc(video.title);
  const counted = typeof video.views === "number";
  const meta = kind === "video"
    ? `<span>${counted ? `${views.format(video.views!)} ${esc(text.views)} · ` : ""}${formatMonthYear(video.published)}</span>`
    : "";
  return `<article class="tz-vl__card" data-id="${id}" data-title="${title}" data-published="${esc(video.published)}"${counted ? ` data-views="${video.views}"` : ""}>` +
    `<a class="tz-vl__trigger" href="https://www.youtube.com/watch?v=${id}" target="_blank" rel="noopener noreferrer" aria-label="${esc(text.playVideo)}: ${title}">` +
    `<span class="tz-vl__thumb"><img src="https://i.ytimg.com/vi/${id}/hqdefault.jpg" alt="" width="480" height="360" loading="lazy" decoding="async"><span class="tz-vl__play">${PLAY}</span></span>` +
    `<span class="tz-vl__details"><strong>${title}</strong>${meta}</span>` +
    `</a></article>`;
}

/** A tab's cards, under its name (the name shows only without JS, where the tabs are hidden). */
function grid(videos: LibraryVideo[], kind: Kind, name: string) {
  const cards = sortVideos(videos, "latest").map((video) => card(video, kind)).join("");
  return `<h2 class="tz-vl__kind" hidden>${esc(name)}</h2>` +
    `<div class="tz-vl__grid" data-kind="${kind}"${kind === "short" ? " hidden" : ""}>${cards}</div>`;
}

// Without JS the tabs, search and sort would do nothing: they're taken out, and
// both tabs' cards are listed one after the other under their tab names, so
// every video and clip is still a link to YouTube.
const NO_SCRIPT = "<noscript><style>" +
  ".tz-vl .tz-vl__bar{display:none}" +
  ".tz-vl .tz-vl__grid[hidden]{display:grid!important}" +
  ".tz-vl .tz-vl__kind[hidden]{display:block!important}" +
  "</style></noscript>";

function library(videos: LibraryVideo[], shorts: LibraryVideo[]) {
  const text = copy.classes;
  const count = esc(text.videoCount.replace("{count}", String(videos.length + shorts.length)));
  const sort = (["latest", "popular", "oldest"] as const).map((order) =>
    `<button type="button" data-order="${order}" aria-pressed="${order === "latest"}">${esc(text[order])}</button>`).join("");
  return `<section class="tz-vl" data-tz-video-library data-close-label="${esc(text.closePlayer)}" aria-labelledby="tz-vl-title">${NO_SCRIPT}` +
    `<div class="tz-vl__profile">` +
    `<span class="tz-vl__avatar"><img src="${LOGO}" alt="" width="215" height="216"></span>` +
    `<div class="tz-vl__intro">` +
    `<h1 id="tz-vl-title" class="tz-vl__title">${esc(text.heading)}</h1>` +
    // The "·" stays with the handle (no-break space), so a wrapped line starts with the count.
    `<p class="tz-vl__meta"><strong>${esc(text.handle)}</strong>&nbsp;· <span class="tz-vl__count">${count}</span></p>` +
    `<a class="tz-vl__channel" href="${CHANNEL_URL}" target="_blank" rel="noopener noreferrer">${esc(text.channel)}${EXTERNAL}</a>` +
    `</div></div>` +
    `<div class="tz-vl__bar">` +
    `<div class="tz-vl__tabs" role="group" aria-label="${esc(text.kindLabel)}">` +
    `<button type="button" data-kind="video" aria-pressed="true">${esc(text.videosTab)}</button>` +
    `<button type="button" data-kind="short" aria-pressed="false">${esc(text.shortsTab)}</button>` +
    `</div>` +
    `<div class="tz-vl__search">` +
    `<button type="button" class="tz-vl__search-open" aria-label="${esc(text.searchLabel)}" aria-expanded="false" aria-controls="tz-vl-search-field">${SEARCH}</button>` +
    `<div class="tz-vl__search-field" id="tz-vl-search-field" hidden>${SEARCH}` +
    `<label class="tz-vl__sr-only" for="tz-vl-search">${esc(text.searchLabel)}</label>` +
    `<input class="tz-vl__input" id="tz-vl-search" type="search" placeholder="${esc(text.searchLabel)}" autocomplete="off" spellcheck="false">` +
    `<button type="button" class="tz-vl__search-clear" aria-label="${esc(text.clearSearch)}">${CLEAR}</button>` +
    `</div></div>` +
    `<div class="tz-vl__sort" role="group" aria-label="${esc(text.sortLabel)}">${sort}</div>` +
    `</div>` +
    grid(videos, "video", text.videosTab) +
    grid(shorts, "short", text.shortsTab) +
    `<p class="tz-vl__empty" role="status" hidden>${esc(text.noResults)}</p>` +
    `</section>`;
}

export function classesPage(path: string): PageContent {
  const text = copy.classes;
  const { videos } = JSON.parse(readShared("youtube.json")) as { videos: LibraryVideo[] };
  const { shorts } = JSON.parse(readShared("shorts.json")) as { shorts: LibraryVideo[] };
  return composePage({
    path,
    title: text.title,
    description: text.description,
    slug: "classes",
    // closingSections() starts with the Resources page's large spacer.
    main: wrapEntry(text.title, resourcesHero() + library(videos, shorts) + closingSections()),
    islands: ["signup", "video-library"]
  });
}

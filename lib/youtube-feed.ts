import { readShared } from "./content";
import { renderInstagramFeed } from "./instagram-feed";

/**
 * Renders the Resources page YouTube grid with the same markup the
 * "Feeds for YouTube" (Smash Balloon) plugin produced on the live site, from
 * content/youtube.json (refresh with `npm run sync:youtube`). Playback and
 * "Load More" are handled client-side by components/enhancers.
 */

type Video = { id: string; title: string; published: string };
type Feed = { channelId: string; channelUrl: string; perPage: number; videos: Video[] };

const YOUTUBE_PATH =
  "M549.655 124.083c-6.281-23.65-24.787-42.276-48.284-48.597C458.781 64 288 64 288 64S117.22 64 74.629 75.486c-23.497 6.322-42.003 24.947-48.284 48.597-11.412 42.867-11.412 132.305-11.412 132.305s0 89.438 11.412 132.305c6.281 23.65 24.787 41.5 48.284 47.821C117.22 448 288 448 288 448s170.78 0 213.371-11.486c23.497-6.321 42.003-24.171 48.284-47.821 11.412-42.867 11.412-132.305 11.412-132.305s0-89.438-11.412-132.305zm-317.51 213.508V175.185l142.739 81.205-142.739 81.201z";
const ICON = `<svg aria-hidden="true" focusable="false" data-prefix="fab" data-icon="youtube" role="img" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 576 512" class="svg-inline--fa fa-youtube fa-w-18"><path fill="currentColor" d="${YOUTUBE_PATH}" class=""></path></svg>`;

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function item(video: Video, hidden: boolean) {
  const id = esc(video.id);
  const title = esc(video.title);
  const date = Math.floor(new Date(video.published).getTime() / 1000);
  return `<div class="sby_item${hidden ? " tz-more" : ""}" role="listitem" data-date="${date}" data-video-id="${id}">
    <div class="sby_inner_item">
        <div class="sby_video_thumbnail_wrap sby_item_video_thumbnail_wrap">
            <a class="sby_video_thumbnail sby_item_video_thumbnail sby_imgLiquid_bgSize sby_imgLiquid_ready" href="https://www.youtube.com/watch?v=${id}" target="_blank" rel="noopener" data-full-res="https://i.ytimg.com/vi/${id}/maxresdefault.jpg" data-video-id="${id}" data-video-title="${title}" style="background-image: url(&quot;https://i.ytimg.com/vi/${id}/hqdefault.jpg&quot;); background-size: cover; background-position: center center; background-repeat: no-repeat; overflow: hidden;">
                <img decoding="async" loading="lazy" style="display: none;" src="https://i.ytimg.com/vi/${id}/hqdefault.jpg" alt="${title}">
                <div class="sby_thumbnail_hover sby_item_video_thumbnail_hover">
                    <div class="sby_thumbnail_hover_inner">
                        <span class="sby_video_title" role="heading" aria-level="3">${title}</span>
                    </div>
                </div>
                <div class="sby_play_btn">
                    <span class="sby_play_btn_bg"></span>
                    ${ICON}
                </div>
            </a>
        </div>
    </div>
</div>`;
}

export function renderYoutubeFeed() {
  const feed: Feed = JSON.parse(readShared("youtube.json"));
  // No whitespace between items: they are 33.33%-wide inline-blocks.
  const items = feed.videos.map((video, i) => item(video, i >= feed.perPage).trim()).join("");
  const more = feed.videos.length > feed.perPage;
  const id = `sb_youtube_sby${esc(feed.channelId)}${feed.perPage}`;
  return `<div id="${id}" role="region" aria-label="YouTube videos" class="sb_youtube sby_layout_grid sby_col_3 sby_mob_col_1 sby_palette_inherit  sby_width_resp" data-tz-youtube-feed data-num="${feed.perPage}" data-cols="3" data-colsmobile="1">
    <div class="sby_items_wrap" role="list" style="padding: 8px;">${items}</div>
    <div class="sby_footer">
        <div class="sby-screenreader" role="status" aria-live="polite" aria-atomic="true" data-sby-feed-status=""></div>
        ${more ? `<button type="button" aria-label="Load more content" class="sby_load_btn"><span class="sby_btn_text">Load More...</span></button>` : ""}
        <span class="sby_follow_btn">
            <a href="${esc(feed.channelUrl)}" target="_blank" rel="noopener">
                ${ICON}
                <span>Subscribe</span>
            </a>
        </span>
    </div>
</div>`;
}

/** Expands build-time tokens left in imported HTML. */
export function expandTokens(html: string) {
  let out = html;
  if (out.includes("<!--tz:youtube-feed-->")) out = out.replace("<!--tz:youtube-feed-->", renderYoutubeFeed());
  if (out.includes("<!--tz:instagram-feed-->")) out = out.replace("<!--tz:instagram-feed-->", renderInstagramFeed());
  return out;
}

#!/usr/bin/env node
// Refreshes content/youtube.json from the channel's public RSS feed
// (https://www.youtube.com/feeds/videos.xml?channel_id=UC69mDA498p7l9GGBdaUdkkA),
// keeping older videos that have left the feed's 15-entry window.
//
//   npm run sync:youtube            # outage-tolerant: keeps current data, exit 0
//   npm run sync:youtube -- --strict  # treat an unreachable feed as a failure
//
// YouTube's RSS endpoint is intermittently unavailable (404/5xx for hours). That
// must never break a deploy, so an unreachable feed only warns. A feed that
// answers with bad data (wrong channel, invalid IDs) always fails.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { feedUrl, mergeYouTubeVideos, parseYouTubeFeed } from "./lib/youtube-feed.mjs";

const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "content", "youtube.json");
const strict = process.argv.includes("--strict");
const feed = JSON.parse(fs.readFileSync(file, "utf8"));
const url = feedUrl(feed.channelId);

const warn = (message) => {
  console.warn(process.env.GITHUB_ACTIONS ? `::warning title=YouTube feed::${message}` : `warning: ${message}`);
};

async function fetchFeed() {
  let last = "";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: { accept: "application/atom+xml, application/xml;q=0.9, text/xml;q=0.8", "user-agent": "Tzion-Breslov-video-sync/1.0" },
        signal: AbortSignal.timeout(30_000)
      });
      if (res.ok && /xml/i.test(res.headers.get("content-type") ?? "")) return await res.text();
      last = `HTTP ${res.status} ${res.headers.get("content-type") ?? ""}`.trim();
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 5_000));
  }
  return { unavailable: last };
}

const body = await fetchFeed();
if (typeof body !== "string") {
  const message = `feed unavailable (${body.unavailable}); kept the ${feed.videos.length} videos already in content/youtube.json`;
  if (strict) throw new Error(message);
  warn(message);
  process.exit(0);
}

const { videos, added } = mergeYouTubeVideos(feed.videos, parseYouTubeFeed(body, feed.channelId));
fs.writeFileSync(file, `${JSON.stringify({ ...feed, syncedAt: new Date().toISOString(), videos }, null, 2)}\n`);
console.log(`youtube.json: ${videos.length} videos${added.length ? `, new: ${added.join(", ")}` : ", no new uploads"}`);

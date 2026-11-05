#!/usr/bin/env node
// Refreshes content/youtube.json from the channel's public RSS feed (latest 15
// uploads, no API key). Keeps older videos already in the file, newest first.
//
//   npm run sync:youtube
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const file = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "content", "youtube.json");
const feed = JSON.parse(fs.readFileSync(file, "utf8"));

const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${feed.channelId}`);
if (!res.ok) throw new Error(`YouTube RSS returned ${res.status}`);
const xml = await res.text();

const decode = (s) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const latest = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map(([, entry]) => ({
  id: entry.match(/<yt:videoId>([^<]+)/)?.[1],
  title: decode(entry.match(/<title>([^<]*)/)?.[1] ?? ""),
  published: entry.match(/<published>([^<]+)/)?.[1],
  shorts: /\/shorts\//.test(entry.match(/<link[^>]+href="([^"]+)"/)?.[1] ?? "")
})).filter((v) => v.id && v.published && !v.shorts).map(({ shorts: _s, ...v }) => v);

const byId = new Map(feed.videos.map((v) => [v.id, v]));
for (const v of latest) byId.set(v.id, v);
const videos = [...byId.values()].sort((a, b) => b.published.localeCompare(a.published));
const added = videos.length - feed.videos.length;

fs.writeFileSync(file, `${JSON.stringify({ ...feed, syncedAt: new Date().toISOString(), videos }, null, 2)}\n`);
console.log(`youtube.json: ${videos.length} videos (${added >= 0 ? "+" : ""}${added})`);

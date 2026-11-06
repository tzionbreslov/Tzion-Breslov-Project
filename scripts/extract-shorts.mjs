#!/usr/bin/env node
// ONE-TIME script (2026-11-06, structure task 3). It wrote content/shorts.json, the
// Classes page's "Shorts" tab: the 27 bite-size clips of the old /video/video-N/
// pages. It reads each page's YouTube iframe (content/pages/video__video-N.json)
// and its WordPress time in content/site-files/video-sitemap.xml. Task 4 deletes
// those pages, so it cannot run again after that: edit content/shorts.json by hand.
//
//   node scripts/extract-shorts.mjs
//
// Newest first by that time; a clip on two pages (video-3 and video-5 are both
// __-cuW-FZHA) is listed once, with the newer page's time. Titles are the iframe
// titles exactly (entities decoded), so the clips keep their existing wording.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const content = path.join(root, "content");
const SITEMAP = "content/site-files/video-sitemap.xml";
const PAGES = 27;

const decode = (text) => text.replace(/&(?:#(\d+)|#x([\da-f]+)|(quot|amp|apos|lt|gt|#039));/gi, (match, dec, hex, name) => {
  if (dec || hex) return String.fromCodePoint(Number.parseInt(dec ?? hex, dec ? 10 : 16));
  return { quot: '"', amp: "&", apos: "'", lt: "<", gt: ">" }[name.toLowerCase()] ?? match;
});

// WordPress time of each /video/video-N/ page.
const sitemap = fs.readFileSync(path.join(root, SITEMAP), "utf8");
const times = new Map(
  [...sitemap.matchAll(/<loc>[^<]*\/video\/(video-\d+)\/<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/g)]
    .map(([, slug, lastmod]) => [slug, new Date(lastmod).toISOString().replace(".000Z", "Z")])
);

const clips = [];
for (let n = 1; n <= PAGES; n++) {
  const slug = `video-${n}`;
  const { main } = JSON.parse(fs.readFileSync(path.join(content, "pages", `video__${slug}.json`), "utf8"));
  const iframes = [...main.matchAll(/<iframe\b[^>]*>/g)].map(([tag]) => tag);
  if (iframes.length !== 1) throw new Error(`${slug}: expected one iframe, found ${iframes.length}`);
  const id = iframes[0].match(/\ssrc="https:\/\/www\.youtube\.com\/embed\/([A-Za-z0-9_-]{11})[?"]/)?.[1];
  const title = iframes[0].match(/\stitle="([^"]*)"/)?.[1];
  const published = times.get(slug);
  if (!id || !title || !published) throw new Error(`${slug}: missing ${!id ? "video ID" : !title ? "title" : "sitemap time"}`);
  clips.push({ id, title: decode(title), published });
}

clips.sort((a, b) => Date.parse(b.published) - Date.parse(a.published));
const seen = new Set();
const shorts = clips.filter((clip) => !seen.has(clip.id) && seen.add(clip.id));

const file = path.join(content, "shorts.json");
const source = `iframes of content/pages/video__video-1..${PAGES}.json, times from ${SITEMAP} (scripts/extract-shorts.mjs, one-time)`;
fs.writeFileSync(file, `${JSON.stringify({ source, shorts }, null, 2)}\n`);
console.log(`content/shorts.json: ${shorts.length} clips (${clips.length - shorts.length} duplicate dropped), first ${shorts[0].id}`);

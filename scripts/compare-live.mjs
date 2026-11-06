#!/usr/bin/env node
// Compares visible text + image/link targets of the local WordPress reference with the live site.
//   node scripts/compare-live.mjs [refBase] [liveBase]
import { load } from "cheerio";
import { isRemovedPath } from "../config/site-structure.mjs";
const REF = process.argv[2] ?? "http://localhost:8088";
const LIVE = process.argv[3] ?? "https://tzionbreslov.com";
const sitemap = async (base) => {
  const idx = await (await fetch(`${base}/sitemap_index.xml`)).text();
  const maps = [...idx.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const urls = [];
  for (const m of maps) urls.push(...[...(await (await fetch(m)).text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map((x) => new URL(x[1]).pathname).filter((p) => !p.startsWith("/wp-content")));
  return urls;
};
const digest = (html, base) => {
  const $ = load(html);
  const c = $(".site-container");
  c.find("script,style,noscript,.gform_wrapper,.sb_youtube,iframe").remove();
  const tokens = c.text().replace(/\s+/g, " ").trim().split(" ");
  c.find("img").each((_, el) => tokens.push(`[img:${($(el).attr("src") ?? "").replace(base, "").replace(/\?.*/, "")}]`));
  c.find("a").each((_, el) => tokens.push(`[a:${($(el).attr("href") ?? "").replace(base, "")}]`));
  return tokens;
};
// Only the pages this site still copies (the removed ones: config/site-structure.mjs).
const paths = [...new Set([...(await sitemap(LIVE)), "/articles/", "/no-such-page/"])].filter((p) => !isRemovedPath(p));
let bad = 0;
for (const p of paths) {
  const get = async (b) => (await fetch(b + p, { headers: { "user-agent": "Mozilla/5.0" } })).text();
  const [a, b] = [digest(await get(REF), REF), digest(await get(LIVE), LIVE)];
  const sa = new Set(a), sb = new Set(b);
  const onlyRef = a.filter((t) => !sb.has(t)), onlyLive = b.filter((t) => !sa.has(t));
  if (onlyRef.length || onlyLive.length || a.length !== b.length) {
    bad++;
    console.log(`DIFF ${p} (ref ${a.length} / live ${b.length} tokens)\n   only ref:  ${onlyRef.slice(0, 8).join(" ")}\n   only live: ${onlyLive.slice(0, 8).join(" ")}`);
  }
}
console.log(`${paths.length} pages compared, ${bad} differ`);

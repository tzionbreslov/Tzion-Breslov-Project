#!/usr/bin/env node
// Snapshots the local WordPress reference (tools/wordpress-reference) into
// ../golden so scripts/import-wordpress.mjs can convert it.
//
//   node scripts/crawl-wordpress.mjs [--base http://localhost:8088] [--out ../golden]
//
// Saves: pages/<path>/index.html (incl. pages/404), site/<asset path>,
// sitemaps/*.xml + robots.txt, live/resources.html (YouTube feed seed, from
// the live site because the local feed cache is stale).
import fs from "node:fs";
import path from "node:path";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const BASE = arg("--base", "http://localhost:8088");
const OUT = path.resolve(arg("--out", "../golden"));
const LIVE = "https://tzionbreslov.com";
const CONCURRENCY = 6;

const norm = (u) => {
  try {
    const x = new URL(u.replace(/&amp;/g, "&").split("\\/").join("/"), BASE);
    if (x.origin !== BASE) return null;
    x.hash = "";
    return x.href;
  } catch {
    return null;
  }
};
const isPage = (u) => {
  const x = new URL(u);
  return !/\/(wp-admin|wp-json|wp-login|xmlrpc|feed|comments)\b/.test(x.pathname) && !/\.[a-z0-9]{2,5}$/i.test(x.pathname) && !x.search;
};
const write = (rel, data) => {
  const file = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
};

async function pool(items, worker) {
  const queue = [...items];
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) await worker(queue.shift());
  }));
}

function collect(html, pagesOut, assetsOut) {
  for (const m of html.matchAll(/href=["']([^"']+)["']/g)) {
    const n = norm(m[1]);
    if (n) (isPage(n) ? pagesOut : assetsOut).add(n);
  }
  for (const m of html.matchAll(/(?:src|data-src|poster)=["']([^"']+)["']/g)) { const n = norm(m[1]); if (n) assetsOut.add(n); }
  for (const m of html.matchAll(/srcset=["']([^"']+)["']/g)) for (const part of m[1].split(",")) { const n = norm(part.trim().split(/\s+/)[0]); if (n) assetsOut.add(n); }
  for (const m of html.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) { const n = norm(m[1]); if (n) assetsOut.add(n); }
  for (const m of html.split("\\/").join("/").matchAll(/https?:\/\/localhost:8088[^"'\s<>)\\]+/g)) { const n = norm(m[0]); if (n && !isPage(n)) assetsOut.add(n); }
}

fs.rmSync(OUT, { recursive: true, force: true });

// Sitemaps + robots seed the crawl and are republished by the importer.
const index = await (await fetch(`${BASE}/sitemap_index.xml`)).text();
write("sitemaps/sitemap_index.xml", index);
write("sitemaps/robots.txt", await (await fetch(`${BASE}/robots.txt`)).text());
const seeds = new Set([`${BASE}/`]);
for (const loc of [...index.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1])) {
  const xml = await (await fetch(loc)).text();
  write(`sitemaps/${path.basename(new URL(loc).pathname)}`, xml);
  for (const m of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) { const n = norm(m[1]); if (n && isPage(n)) seeds.add(n); }
}

const seen = new Set();
const assets = new Set();
let frontier = [...seeds];
while (frontier.length) {
  const found = new Set();
  await pool(frontier.filter((u) => !seen.has(u) && seen.add(u)), async (u) => {
    const res = await fetch(u, { redirect: "manual" });
    if (res.status !== 200) {
      console.log(res.status, u, res.headers.get("location") ?? "");
      return;
    }
    const html = await res.text();
    write(path.join("pages", new URL(u).pathname, "index.html"), html);
    collect(html, found, assets);
  });
  frontier = [...found].filter((u) => !seen.has(u));
}

const notFound = await (await fetch(`${BASE}/this-page-does-not-exist/`)).text();
write("pages/404/index.html", notFound);
collect(notFound, new Set(), assets);

const done = new Set();
let assetQueue = [...assets];
while (assetQueue.length) {
  const next = new Set();
  await pool(assetQueue.filter((u) => !done.has(u) && done.add(u)), async (u) => {
    const x = new URL(u);
    if (x.pathname.endsWith("/") || /\/(wp-json|xmlrpc|wp-admin\/admin-ajax|feed)/.test(x.pathname)) return;
    const res = await fetch(u);
    if (!res.ok) {
      console.log("asset", res.status, u);
      return;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    write(path.join("site", decodeURIComponent(x.pathname)), buf);
    if (x.pathname.endsWith(".css")) {
      for (const m of buf.toString().matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) {
        if (m[1].startsWith("data:")) continue;
        const n = norm(new URL(m[1], u).href);
        if (n) next.add(n);
      }
    }
  });
  assetQueue = [...next];
}

const live = await fetch(`${LIVE}/resources/`, { headers: { "user-agent": "Mozilla/5.0" } });
if (live.ok) write("live/resources.html", await live.text());

console.log(`pages ${seen.size} | assets ${done.size} | sitemaps ${fs.readdirSync(path.join(OUT, "sitemaps")).length}`);

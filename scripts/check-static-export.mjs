#!/usr/bin/env node
// Verifies the static export in ./out before it is published.
//   npm run build && npm run check:static-export
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { siteRoutes } from "../config/site-structure.mjs";
import { IMPORTED_ORIGIN, resolveSiteUrl } from "../config/site-url.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "out");
const rawBase = process.env.NEXT_PUBLIC_BASE_PATH?.trim() ?? "";
const base = rawBase ? `/${rawBase.replace(/^\/+|\/+$/g, "")}` : "";
const PRODUCTION = resolveSiteUrl(process.env.NEXT_PUBLIC_SITE_URL);
const SWITCHED = PRODUCTION !== IMPORTED_ORIGIN;
// After a site-URL switch nothing may still point at the imported domain
// (plain or JSON-escaped) — canonicals, social tags, JSON-LD, sitemaps, robots.
const OLD_DOMAIN = /\/\/tzionbreslov\.com|\\\/\\\/tzionbreslov\.com/;
const errors = [];
const fail = (msg) => errors.push(msg);

if (!fs.existsSync(out)) {
  console.error("Missing out/. Run `npm run build` first.");
  process.exit(1);
}

const { routes, redirects } = siteRoutes(JSON.parse(fs.readFileSync(path.join(root, "content", "routes.json"), "utf8")));
const htmlFor = (route) => path.join(out, route, "index.html");

for (const file of ["404.html", ".nojekyll", "robots.txt", "sitemap_index.xml", "page-sitemap.xml", "post-sitemap.xml", "video-sitemap.xml"]) {
  if (!fs.existsSync(path.join(out, file))) fail(`missing ${file}`);
}
for (const file of ["robots.txt", "sitemap_index.xml", "page-sitemap.xml", "post-sitemap.xml", "video-sitemap.xml", "category-sitemap.xml", "author-sitemap.xml"]) {
  const text = fs.existsSync(path.join(out, file)) ? fs.readFileSync(path.join(out, file), "utf8") : "";
  if (!text.includes(PRODUCTION)) fail(`${file} does not reference ${PRODUCTION}`);
  if (SWITCHED && OLD_DOMAIN.test(text)) fail(`${file} still references tzionbreslov.com after the site-URL switch`);
}
for (const { path: route } of routes) if (!fs.existsSync(htmlFor(route))) fail(`route not exported: ${route}`);
for (const [from, to] of Object.entries(redirects)) {
  const file = htmlFor(from);
  if (!fs.existsSync(file)) fail(`redirect page missing: ${from}`);
  else if (!fs.readFileSync(file, "utf8").includes(`url=${base}${to}`)) fail(`redirect ${from} does not point to ${to}`);
}

const exists = (urlPath) => {
  if (base && !urlPath.startsWith(`${base}/`)) return false;
  const rel = decodeURIComponent(urlPath.slice(base.length).replace(/[?#].*$/, ""));
  const file = path.join(out, rel);
  return fs.existsSync(file) && (fs.statSync(file).isFile() || fs.existsSync(path.join(file, "index.html")));
};

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const full = path.join(dir, e.name);
  return e.isDirectory() ? walk(full) : full.endsWith(".html") ? [full] : [];
});

const broken = new Map();
for (const file of walk(out)) {
  const html = fs.readFileSync(file, "utf8");
  const rel = path.relative(out, file);
  if (html.includes("localhost:8088")) fail(`${rel} still references localhost:8088`);
  if (html.includes("estiwolo.com/wp-content")) fail(`${rel} still references the dead staging host`);
  if (SWITCHED && OLD_DOMAIN.test(html)) fail(`${rel} still references tzionbreslov.com after the site-URL switch`);
  if (/\/wp-admin\/admin-ajax\.php/.test(html.replace(/var uagb_data[^;]*;/g, ""))) fail(`${rel} references admin-ajax`);
  const canonical = html.match(/<link rel="canonical" href="([^"]+)"/)?.[1];
  if (canonical && !canonical.startsWith(PRODUCTION)) fail(`${rel} canonical is ${canonical}`);
  const refs = [...html.matchAll(/\b(?:href|src)="(\/[^"/][^"]*)"/g)].map((m) => m[1].replace(/&amp;/g, "&"));
  for (const m of html.matchAll(/\bsrcset="([^"]+)"/g)) for (const part of m[1].split(",")) refs.push(part.trim().split(/\s+/)[0]);
  for (const ref of refs) {
    if (!ref.startsWith("/") || ref.startsWith("//") || ref.startsWith(`${base}/_next/`)) continue;
    if (!exists(ref)) broken.set(ref, rel);
  }
}
for (const [ref, from] of broken) fail(`broken local reference ${ref} (first seen in ${from})`);

for (const forbidden of [".dev.vars", ".env"]) if (fs.existsSync(path.join(out, forbidden))) fail(`secret-looking file exported: ${forbidden}`);

if (errors.length) {
  console.error(`Static export check failed (${errors.length}):\n  ${errors.slice(0, 50).join("\n  ")}`);
  process.exit(1);
}
console.log(`Static export OK: ${routes.length} routes, ${Object.keys(redirects).length} redirects, all local references resolve.`);

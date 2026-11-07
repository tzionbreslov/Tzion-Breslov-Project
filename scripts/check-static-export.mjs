#!/usr/bin/env node
// Verifies the static export in ./out before it is published.
//   npm run build && npm run check:static-export
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isRemovedPath, REMOVED_SITEMAPS, siteRoutes } from "../config/site-structure.mjs";
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

// Nothing may point at a removed page (config/site-structure.mjs): no root-relative
// or site-origin href/src, no sitemap <loc> and no absolute URL on the site's
// origin anywhere in the text, plain or JSON-escaped (JSON-LD included).
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const SITE_ORIGIN = [PRODUCTION, PRODUCTION.replaceAll("/", "\\/")].map(escapeRegExp).join("|");
const ORIGIN_URL = new RegExp(`(?:${SITE_ORIGIN})(\\\\?/[^"\\s<>]*)`, "g");
const removedPath = (ref) => {
  const urlPath = ref.replaceAll("\\/", "/").replace(/[?#].*$/, "");
  return isRemovedPath(urlPath) ? urlPath : null;
};
/** An href/src value's path on this site: root-relative (base path taken off) or absolute on the site's origin. */
const attributePath = (value) => {
  if (value.startsWith("/")) return base && value.startsWith(`${base}/`) ? value.slice(base.length) : value;
  return value.startsWith(`${PRODUCTION}/`) ? value.slice(PRODUCTION.length) : null;
};
/** Removed pages named by `html`'s href/src attributes, or by a site-origin URL anywhere in `text`. */
function removedRefs(html, text = html) {
  const found = new Set();
  for (const m of html.matchAll(/\b(?:href|src)="([^"]*)"/g)) {
    const ref = attributePath(m[1]);
    if (ref) found.add(removedPath(ref));
  }
  for (const m of text.matchAll(ORIGIN_URL)) found.add(removedPath(m[1]));
  found.delete(null);
  return [...found];
}

// The Events page's cards hold calendar text (titles, places, descriptions) that
// lib/events.mjs escapes and never links (card()). Whatever the events manager
// types there may name a removed page, tzionbreslov.com or a YouTube embed
// address, and must not fail the deploy, so the text checks read each page
// without its cards. The page holds them twice: as HTML, and as an escaped
// string in Next's flight data (`<article class=\"tz-event\"…`). Escaped
// calendar text can't close a card early in either form (an odd one only leaves
// text in, which fails safe). Every href/src check still reads the whole page.
const EVENT_CARDS = [
  /<article class="tz-event"[^>]*>[\s\S]*?<\/article>/g,
  /\\u003carticle class=\\+"tz-event\\+"[\s\S]*?\\u003c\/article\\u003e/g
];
const withoutEventCards = (html) => EVENT_CARDS.reduce((text, cards) => text.replace(cards, ""), html);

if (!fs.existsSync(out)) {
  console.error("Missing out/. Run `npm run build` first.");
  process.exit(1);
}

const { routes, redirects } = siteRoutes(JSON.parse(fs.readFileSync(path.join(root, "content", "routes.json"), "utf8")));
const htmlFor = (route) => path.join(out, route, "index.html");

const SITE_FILES = ["robots.txt", "sitemap_index.xml", "page-sitemap.xml", "post-sitemap.xml"];
for (const file of ["404.html", ".nojekyll", ...SITE_FILES]) {
  if (!fs.existsSync(path.join(out, file))) fail(`missing ${file}`);
}
// The Events page's list for the forms Worker (scripts/write-site-files.mjs), served next to the pages.
const eventsFile = path.join(out, "events.json");
if (!fs.existsSync(eventsFile)) fail("missing events.json");
else {
  try {
    if (!Array.isArray(JSON.parse(fs.readFileSync(eventsFile, "utf8")).events)) fail("events.json has no events list");
  } catch (error) {
    fail(`events.json is not JSON: ${error.message}`);
  }
}
for (const file of SITE_FILES) {
  const text = fs.existsSync(path.join(out, file)) ? fs.readFileSync(path.join(out, file), "utf8") : "";
  if (!text.includes(PRODUCTION)) fail(`${file} does not reference ${PRODUCTION}`);
  if (SWITCHED && OLD_DOMAIN.test(text)) fail(`${file} still references tzionbreslov.com after the site-URL switch`);
  for (const name of REMOVED_SITEMAPS) if (text.includes(name)) fail(`${file} still lists ${name}`);
}
for (const name of REMOVED_SITEMAPS) if (fs.existsSync(path.join(out, name))) fail(`removed sitemap exported: ${name}`);
for (const file of fs.readdirSync(out).filter((name) => name.endsWith(".xml"))) {
  for (const ref of removedRefs(fs.readFileSync(path.join(out, file), "utf8"))) fail(`${file} lists the removed page ${ref}`);
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
  const text = withoutEventCards(html);
  const rel = path.relative(out, file);
  if (html.includes("localhost:8088")) fail(`${rel} still references localhost:8088`);
  if (html.includes("estiwolo.com/wp-content")) fail(`${rel} still references the dead staging host`);
  if (SWITCHED && OLD_DOMAIN.test(text)) fail(`${rel} still references tzionbreslov.com after the site-URL switch`);
  if (/\/wp-admin\/admin-ajax\.php/.test(html.replace(/var uagb_data[^;]*;/g, ""))) fail(`${rel} references admin-ajax`);
  // Videos play only in the Classes page's own player (youtube-nocookie, on click).
  if (text.includes("youtube.com/embed") || /\bsrc="[^"]*youtube\.com\/embed/.test(html)) fail(`${rel} still embeds a plain YouTube player`);
  for (const ref of removedRefs(html, text)) fail(`${rel} links to the removed page ${ref}`);
  // The broken-reference check below never sees a bare "/" (the Home links); with a base path it must carry it.
  if (base && /\b(?:href|src)="\/"/.test(html)) fail(`${rel} links to "/" without the base path ${base}`);
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

// The Contact page's map (lib/pages/contact-map.ts): one section, after the "Beit Shemesh, Israel" card, embedding
// Google Maps pinned on Bet Shemesh (its origin is in config/security-headers.mjs). The card is found by its own
// markup: the words alone also appear earlier, in the page's description meta tags.
const contactFile = htmlFor("/contact/");
const BEIT_SHEMESH_CARD = "<strong>&nbsp;Beit Shemesh, Israel</strong>";
if (fs.existsSync(contactFile)) {
  const contact = fs.readFileSync(contactFile, "utf8");
  const sections = contact.split('<section class="tz-map"').length - 1;
  const map = contact.indexOf('<section class="tz-map"');
  const cards = contact.split(BEIT_SHEMESH_CARD).length - 1;
  const card = contact.indexOf(BEIT_SHEMESH_CARD);
  if (sections !== 1) fail(`/contact/ has ${sections} map sections, expected 1`);
  else if (!/<iframe [^>]*src="https:\/\/www\.google\.com\/maps\?q=Bet%20Shemesh%2C%20Israel&amp;[^"]*output=embed"/.test(contact.slice(map))) fail("/contact/ map does not embed Google Maps pinned on Bet Shemesh, Israel");
  else if (cards !== 1) fail(`/contact/ has ${cards} "Beit Shemesh, Israel" cards (${BEIT_SHEMESH_CARD}), expected 1`);
  else if (card > map) fail("/contact/ map is not after the \"Beit Shemesh, Israel\" card");
}

for (const forbidden of [".dev.vars", ".env"]) if (fs.existsSync(path.join(out, forbidden))) fail(`secret-looking file exported: ${forbidden}`);

if (errors.length) {
  console.error(`Static export check failed (${errors.length}):\n  ${errors.slice(0, 50).join("\n  ")}`);
  process.exit(1);
}
console.log(`Static export OK: ${routes.length} routes, ${Object.keys(redirects).length} redirects, all local references resolve.`);

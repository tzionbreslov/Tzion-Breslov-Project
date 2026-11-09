#!/usr/bin/env node
// Verifies the static export in ./out before it is published.
//   npm run build && npm run check:static-export
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { REMOVED_SITEMAPS, siteRoutes } from "../config/site-structure.mjs";
import { resolveSiteUrl } from "../config/site-url.mjs";
import { contactDetailsProblems, exportGuard } from "./lib/export-guard.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(root, "out");
const rawBase = process.env.NEXT_PUBLIC_BASE_PATH?.trim() ?? "";
const base = rawBase ? `/${rawBase.replace(/^\/+|\/+$/g, "")}` : "";
const PRODUCTION = resolveSiteUrl(process.env.NEXT_PUBLIC_SITE_URL);
// The text checks: removed pages, tzionbreslov.com after the switch, YouTube embeds,
// importer leftovers, canonicals. They live in scripts/lib/export-guard.mjs (unit-tested).
const guard = exportGuard({ production: PRODUCTION, base });
const errors = [];
const fail = (msg) => errors.push(msg);

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
  if (guard.mentionsOldDomain(text)) fail(`${file} still references tzionbreslov.com after the site-URL switch`);
  for (const name of REMOVED_SITEMAPS) if (text.includes(name)) fail(`${file} still lists ${name}`);
}
for (const name of REMOVED_SITEMAPS) if (fs.existsSync(path.join(out, name))) fail(`removed sitemap exported: ${name}`);
for (const file of fs.readdirSync(out).filter((name) => name.endsWith(".xml"))) {
  for (const ref of guard.removedRefs(fs.readFileSync(path.join(out, file), "utf8"))) fail(`${file} lists the removed page ${ref}`);
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
  for (const problem of guard.pageProblems(html)) fail(`${rel} ${problem}`);
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

// The covered contact details (lib/contact-details.mjs): no page, and none of the RSC payloads (.txt) Next writes
// beside it, holds the old number, the email address or a mailto:/tel:/wa.me link, except what the owner kept
// written out (scripts/lib/export-guard.mjs, contactDetailsProblems). Each file is read as its route's: a page's
// folder, without Next's __next.* folders; the 404 page is root 404.html, 404/ and _not-found/. The scripts in
// _next/ are not pages and keep the email through the kept sentences.
const pageFiles = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const full = path.join(dir, e.name);
  if (e.isDirectory()) return dir === out && e.name === "_next" ? [] : pageFiles(full);
  return /\.(?:html|txt)$/.test(e.name) ? [full] : [];
});
const routeOf = (file) => {
  const parts = path.relative(out, file).split(path.sep).slice(0, -1).filter((part) => !part.startsWith("__next."));
  if (path.relative(out, file) === "404.html" || ["404", "_not-found"].includes(parts[0])) return "/404/";
  return parts.length ? `/${parts.join("/")}/` : "/";
};
let detailFiles = 0;
for (const file of pageFiles(out)) {
  detailFiles++;
  for (const problem of contactDetailsProblems(routeOf(file), fs.readFileSync(file, "utf8"))) fail(`${path.relative(out, file)} ${problem}`);
}
if (detailFiles < routes.length * 2) fail(`only ${detailFiles} pages and payloads read for the contact details`);

for (const forbidden of [".dev.vars", ".env"]) if (fs.existsSync(path.join(out, forbidden))) fail(`secret-looking file exported: ${forbidden}`);

if (errors.length) {
  console.error(`Static export check failed (${errors.length}):\n  ${errors.slice(0, 50).join("\n  ")}`);
  process.exit(1);
}
console.log(`Static export OK: ${routes.length} routes, ${Object.keys(redirects).length} redirects, all local references resolve.`);

#!/usr/bin/env node
// Renders content/site-files (Yoast sitemaps + robots.txt) into public/ with the
// configured site URL, listing the pages composed in code (NEW_ROUTES) in
// page-sitemap.xml. Removed pages (config/site-structure.mjs) leave the sitemaps:
// their sitemaps aren't published and their <url> entries are dropped. Also lists
// the Gallery's photos (public/media/gallery) in content/gallery.generated.json
// (git-ignored), which the Gallery page renders. Runs automatically before
// `next dev` and `next build`.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isRemovedPath, NEW_ROUTES, REMOVED_SITEMAPS } from "../config/site-structure.mjs";
import { resolveSiteUrl, rewriteOrigin } from "../config/site-url.mjs";
import { readGallery } from "./lib/gallery.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const site = resolveSiteUrl(process.env.NEXT_PUBLIC_SITE_URL);
const src = path.join(root, "content", "site-files");
const publicDir = path.join(root, "public");

const newPages = NEW_ROUTES.map(({ path: route }) => `\t<url>\n\t\t<loc>${site}${route}</loc>\n\t</url>\n`).join("");

const locPath = (block) => {
  const loc = block.match(/<loc>([^<]+)<\/loc>/)?.[1];
  return loc ? new URL(loc).pathname : "";
};
/** Drops each `<tag>…</tag>` block (with its indentation and line break) whose <loc> path `drop` matches. */
const dropBlocks = (text, tag, drop) =>
  text.replace(new RegExp(`[\\t ]*<${tag}>[\\s\\S]*?</${tag}>\\n?`, "g"), (block) => (drop(locPath(block)) ? "" : block));

// Sitemaps written by an earlier build stay in public/ (git-ignored) and would be exported.
for (const name of REMOVED_SITEMAPS) fs.rmSync(path.join(publicDir, name), { force: true });

for (const name of fs.readdirSync(src)) {
  if (REMOVED_SITEMAPS.includes(name)) continue;
  let text = rewriteOrigin(fs.readFileSync(path.join(src, name), "utf8"), site)
    .replaceAll("//tzionbreslov.com", site.replace(/^https?:/, ""));
  if (name === "sitemap_index.xml") {
    text = dropBlocks(text, "sitemap", (loc) => REMOVED_SITEMAPS.includes(loc.slice(1)));
  } else if (name.endsWith(".xml")) {
    text = dropBlocks(text, "url", isRemovedPath);
  }
  if (name === "page-sitemap.xml") {
    if (!text.includes("</urlset>")) throw new Error("page-sitemap.xml has no </urlset>");
    text = text.replace("</urlset>", () => `${newPages}</urlset>`);
  }
  fs.writeFileSync(path.join(publicDir, name), text);
}
console.log(`site files written for ${site}`);

const gallery = await readGallery(path.join(publicDir, "media", "gallery"));
fs.writeFileSync(path.join(root, "content", "gallery.generated.json"), `${JSON.stringify({ images: gallery }, null, 2)}\n`);
console.log(`gallery: ${gallery.length} photos`);

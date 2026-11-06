#!/usr/bin/env node
// Renders content/site-files (Yoast sitemaps + robots.txt) into public/ with the
// configured site URL, listing the pages composed in code (NEW_ROUTES) in
// page-sitemap.xml. Runs automatically before `next dev` and `next build`.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NEW_ROUTES } from "../config/site-structure.mjs";
import { resolveSiteUrl, rewriteOrigin } from "../config/site-url.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const site = resolveSiteUrl(process.env.NEXT_PUBLIC_SITE_URL);
const src = path.join(root, "content", "site-files");

const newPages = NEW_ROUTES.map(({ path: route }) => `\t<url>\n\t\t<loc>${site}${route}</loc>\n\t</url>\n`).join("");

for (const name of fs.readdirSync(src)) {
  let text = rewriteOrigin(fs.readFileSync(path.join(src, name), "utf8"), site)
    .replaceAll("//tzionbreslov.com", site.replace(/^https?:/, ""));
  if (name === "page-sitemap.xml") {
    if (!text.includes("</urlset>")) throw new Error("page-sitemap.xml has no </urlset>");
    text = text.replace("</urlset>", () => `${newPages}</urlset>`);
  }
  fs.writeFileSync(path.join(root, "public", name), text);
}
console.log(`site files written for ${site}`);

#!/usr/bin/env node
// Renders content/site-files (Yoast sitemaps + robots.txt) into public/ with the
// configured site URL. Runs automatically before `next dev` and `next build`.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveSiteUrl, rewriteOrigin } from "../config/site-url.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const site = resolveSiteUrl(process.env.NEXT_PUBLIC_SITE_URL);
const src = path.join(root, "content", "site-files");

for (const name of fs.readdirSync(src)) {
  const text = rewriteOrigin(fs.readFileSync(path.join(src, name), "utf8"), site)
    .replaceAll("//tzionbreslov.com", site.replace(/^https?:/, ""));
  fs.writeFileSync(path.join(root, "public", name), text);
}
console.log(`site files written for ${site}`);

#!/usr/bin/env node
// Renders content/site-files (Yoast sitemaps + robots.txt) into public/ with the
// configured site URL. Runs automatically before `next dev` and `next build`.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IMPORTED_ORIGIN = "https://tzionbreslov.com";
const site = (process.env.NEXT_PUBLIC_SITE_URL?.trim() || IMPORTED_ORIGIN).replace(/\/+$/, "");
const src = path.join(root, "content", "site-files");

for (const name of fs.readdirSync(src)) {
  const text = fs.readFileSync(path.join(src, name), "utf8").replaceAll(IMPORTED_ORIGIN, site).replaceAll("//tzionbreslov.com", site.replace(/^https?:/, ""));
  fs.writeFileSync(path.join(root, "public", name), text);
}
console.log(`site files written for ${site}`);

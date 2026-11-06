#!/usr/bin/env node
// ONE-TIME SCRIPT, already run (site-structure Task 5, 2026-11-06); kept as the
// record of where the Gallery's placeholder photos came from. Do not run it
// again: it would overwrite public/media/gallery/gallery.json, and once the
// owner's real photos are in that folder the placeholders are meant to go.
//
// The placeholders are the four real photos already on the site and its three
// collages, as they are (their rounded corners and collage gutters are
// transparency), converted to WebP at quality 88 with the alpha kept.
//
//   node scripts/convert-gallery-placeholders.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const uploads = path.join(root, "public", "wp-content", "uploads");
const out = path.join(root, "public", "media", "gallery");

const COLLAGE = "Collage of photos from Tzion Breslov classes";
const PHOTOS = [
  { name: "01-class-gathering", from: "2023/06/Mask-Group-11.png", alt: "Rabbi Kalmus teaching a class around a table" },
  { name: "02-group-selfie", from: "2023/06/PHOTO-2021-02-26-22-51-46-2.png", alt: "A group photo from a Tzion Breslov gathering" },
  { name: "03-rabbi-lecturing", from: "2023/06/R_Kalmus_lecture_screen_1_1.png", alt: "Rabbi Kalmus lecturing at a podium" },
  { name: "04-rabbi-portrait", from: "2023/07/PHOTO-2023-06-27-19-08-13-1.png", alt: "Portrait of Rabbi David Yisrael Kalmus" },
  { name: "05-collage", from: "2023/06/Group-200.png", alt: `${COLLAGE} (1)` },
  { name: "06-collage", from: "2023/06/Group-215.png", alt: `${COLLAGE} (2)` },
  { name: "07-collage", from: "2023/06/Group-277.png", alt: `${COLLAGE} (3)` }
];

fs.mkdirSync(out, { recursive: true });
const files = {};
for (const [i, { name, from, alt }] of PHOTOS.entries()) {
  const file = `${name}.webp`;
  const info = await sharp(path.join(uploads, from)).webp({ quality: 88 }).toFile(path.join(out, file));
  files[file] = { alt, order: i + 1 };
  console.log(`${file}: ${info.width}×${info.height}, ${(info.size / 1024).toFixed(1)} KiB (from ${from})`);
}
fs.writeFileSync(path.join(out, "gallery.json"), `${JSON.stringify({ files }, null, 2)}\n`);
console.log(`wrote ${PHOTOS.length} photos and gallery.json to ${path.relative(root, out)}`);

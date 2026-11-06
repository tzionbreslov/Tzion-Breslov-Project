import { strict as assert } from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import sharp from "sharp";
import copy from "../content/copy/en.json" with { type: "json" };
import { readGallery } from "./lib/gallery.mjs";

const DEFAULT_ALT = copy.gallery.defaultAlt;
// sharp keeps recently read files open (Windows then refuses to delete them).
sharp.cache(false);
const dirs = [];
after(() => dirs.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

/** A temp folder with three small images (one per format) and a few files that aren't photos. */
async function folder(manifest) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tz-gallery-"));
  dirs.push(dir);
  const image = (width, height) => sharp({ create: { width, height, channels: 4, background: "#1e61a1" } });
  await image(30, 20).png().toFile(path.join(dir, "b-hall.png"));
  await image(12, 40).webp().toFile(path.join(dir, "a-portrait.webp"));
  await image(25, 25).jpeg().toFile(path.join(dir, "c-class.jpg"));
  fs.writeFileSync(path.join(dir, "notes.txt"), "not a photo");
  fs.writeFileSync(path.join(dir, "README.md"), "# not a photo");
  fs.mkdirSync(path.join(dir, "thumbs.png"));
  if (manifest) fs.writeFileSync(path.join(dir, "gallery.json"), JSON.stringify(manifest));
  return dir;
}

const names = (images) => images.map((image) => image.src.replace("/media/gallery/", ""));

test("the order follows gallery.json (lower first), then the filename", async () => {
  const dir = await folder({
    files: {
      "c-class.jpg": { alt: "A class", order: 1 },
      "b-hall.png": { alt: "The hall", order: 2 },
      "a-portrait.webp": { alt: "A portrait", order: 3 }
    }
  });
  assert.deepEqual(names(await readGallery(dir)), ["c-class.jpg", "b-hall.png", "a-portrait.webp"]);

  // The same order: the filename decides.
  const tied = await folder({ files: { "c-class.jpg": { alt: "A class", order: 1 }, "b-hall.png": { alt: "The hall", order: 1 } } });
  assert.deepEqual(names(await readGallery(tied)), ["b-hall.png", "c-class.jpg", "a-portrait.webp"]);

  // No gallery.json at all: by filename, numbers in names counted as numbers.
  const plain = await folder();
  await sharp({ create: { width: 4, height: 4, channels: 3, background: "#fff" } }).png().toFile(path.join(plain, "b-hall-10.png"));
  await sharp({ create: { width: 4, height: 4, channels: 3, background: "#fff" } }).png().toFile(path.join(plain, "b-hall-9.png"));
  assert.deepEqual(names(await readGallery(plain)), ["a-portrait.webp", "b-hall-9.png", "b-hall-10.png", "b-hall.png", "c-class.jpg"]);
});

test("a new file with no entry comes after the listed ones, with the default alt text", async () => {
  const dir = await folder({ files: { "c-class.jpg": { alt: "A class", order: 1 }, "b-hall.png": { alt: "The hall", order: 2 } } });
  const images = await readGallery(dir);
  assert.deepEqual(images.map((image) => image.alt), ["A class", "The hall", DEFAULT_ALT]);
  assert.equal(DEFAULT_ALT, "Photo from Tzion Breslov");
  // An entry with alt text but no order sorts with the unlisted files; an entry without alt text gets the default.
  const partial = await folder({ files: { "a-portrait.webp": { alt: "A portrait" }, "b-hall.png": { order: 1 }, "gone.jpg": { alt: "Deleted", order: 0 } } });
  assert.deepEqual((await readGallery(partial)).map(({ src, alt }) => [src, alt]), [
    ["/media/gallery/b-hall.png", DEFAULT_ALT],
    ["/media/gallery/a-portrait.webp", "A portrait"],
    ["/media/gallery/c-class.jpg", DEFAULT_ALT]
  ]);
});

test("width and height are the image's own, and src is /media/gallery/<name>", async () => {
  const dir = await folder({ files: {} });
  assert.deepEqual(await readGallery(dir), [
    { src: "/media/gallery/a-portrait.webp", width: 12, height: 40, alt: DEFAULT_ALT },
    { src: "/media/gallery/b-hall.png", width: 30, height: 20, alt: DEFAULT_ALT },
    { src: "/media/gallery/c-class.jpg", width: 25, height: 25, alt: DEFAULT_ALT }
  ]);
});

test("a phone photo turned by its EXIF orientation reports its upright size; a name with spaces is URL-encoded", async () => {
  const dir = await folder();
  // Stored 40×20, shown 20×40 (orientation 6 = turn 90° clockwise).
  await sharp({ create: { width: 40, height: 20, channels: 3, background: "#70b9bc" } })
    .jpeg().withMetadata({ orientation: 6 }).toFile(path.join(dir, "IMG 0001.JPG"));
  const photo = (await readGallery(dir)).find((image) => image.src.includes("IMG"));
  assert.deepEqual(photo, { src: "/media/gallery/IMG%200001.JPG", width: 20, height: 40, alt: DEFAULT_ALT });
});

test("files that aren't photos are ignored", async () => {
  const dir = await folder({ files: {} });
  fs.writeFileSync(path.join(dir, ".hidden.png"), "");
  fs.writeFileSync(path.join(dir, "photo.gif"), "GIF89a");
  fs.writeFileSync(path.join(dir, "photo.svg"), "<svg/>");
  assert.deepEqual(names(await readGallery(dir)), ["a-portrait.webp", "b-hall.png", "c-class.jpg"]);
});

test("a gallery.json that can't be read fails loudly, naming the problem", async () => {
  const dir = await folder();
  fs.writeFileSync(path.join(dir, "gallery.json"), "{ not json");
  await assert.rejects(readGallery(dir), /gallery\.json/);
  fs.writeFileSync(path.join(dir, "gallery.json"), JSON.stringify({ files: { "b-hall.png": { order: "first" } } }));
  await assert.rejects(readGallery(dir), /gallery\.json: "b-hall\.png" order must be a number/);
  fs.writeFileSync(path.join(dir, "gallery.json"), JSON.stringify({ files: { "b-hall.png": { alt: 3 } } }));
  await assert.rejects(readGallery(dir), /gallery\.json: "b-hall\.png" alt must be text/);
});

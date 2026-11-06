// The Gallery page's photos come from the files in public/media/gallery: adding
// a photo means adding a file, nothing else. scripts/write-site-files.mjs runs
// readGallery() before every build and writes the result to
// content/gallery.generated.json, which lib/pages/gallery.ts renders.
//
// gallery.json in the same folder can give a photo its alt text and position:
//   { "files": { "<file name>": { "alt": "…", "order": 1 } } }
// Lower orders come first; photos with no order follow, by file name. A photo
// with no alt text gets copy.gallery.defaultAlt.
import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import copy from "../../content/copy/en.json" with { type: "json" };

const PHOTO = /\.(?:webp|jpe?g|png)$/i;
const MANIFEST = "gallery.json";
/** By file name, numbers counted as numbers ("photo-9" before "photo-10"). */
const byName = new Intl.Collator("en", { numeric: true }).compare;

/** gallery.json's `files`, checked: a typo there fails the build instead of showing a wrong page. */
async function readManifest(dir) {
  let text;
  try {
    text = await fs.readFile(path.join(dir, MANIFEST), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
  let files;
  try {
    ({ files = {} } = JSON.parse(text));
  } catch (error) {
    throw new Error(`${MANIFEST}: ${error.message}`, { cause: error });
  }
  if (!files || typeof files !== "object") throw new Error(`${MANIFEST}: "files" must be an object`);
  for (const [name, entry] of Object.entries(files)) {
    if (!entry || typeof entry !== "object") throw new Error(`${MANIFEST}: "${name}" must be an object`);
    if (entry.order !== undefined && !Number.isFinite(entry.order)) throw new Error(`${MANIFEST}: "${name}" order must be a number`);
    if (entry.alt !== undefined && typeof entry.alt !== "string") throw new Error(`${MANIFEST}: "${name}" alt must be text`);
  }
  return files;
}

/**
 * Every .webp, .jpg, .jpeg or .png in `dir`, in display order, with its upright
 * size (a phone photo's EXIF orientation applied) and its alt text.
 * @param {string} dir
 * @returns {Promise<{ src: string; width: number; height: number; alt: string }[]>}
 */
export async function readGallery(dir) {
  const manifest = await readManifest(dir);
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const order = (name) => manifest[name]?.order ?? Infinity;
  const names = entries
    .filter((entry) => entry.isFile() && !entry.name.startsWith(".") && PHOTO.test(entry.name))
    .map((entry) => entry.name)
    // Infinity − Infinity is NaN, which falls through to the name, as a tie does.
    .sort((a, b) => order(a) - order(b) || byName(a, b));
  return Promise.all(names.map(async (name) => {
    const { autoOrient } = await sharp(path.join(dir, name)).metadata();
    return {
      src: `/media/gallery/${encodeURIComponent(name)}`,
      width: autoOrient.width,
      height: autoOrient.height,
      alt: manifest[name]?.alt?.trim() || copy.gallery.defaultAlt
    };
  }));
}

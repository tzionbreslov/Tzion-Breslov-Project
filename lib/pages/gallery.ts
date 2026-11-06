import copy from "@/content/copy/en.json";
import { readShared, type PageContent } from "@/lib/content";
import { composePage } from "@/lib/pages/compose";
import { LARGE_SPACER, renderHero, wrapEntry } from "@/lib/pages/parts";

/**
 * The Gallery page: the Resources header with its own image and heading, then
 * every photo in public/media/gallery, shown whole at its own ratio. The photo
 * list (order, size, alt text) is content/gallery.generated.json, written from
 * the folder before every build (scripts/write-site-files.mjs →
 * scripts/lib/gallery.mjs), so adding a photo means adding a file.
 *
 * Each photo is a link to its own file, so it opens without JS;
 * lib/client/gallery.ts opens it in the on-page viewer instead.
 */

type GalleryImage = { src: string; width: number; height: number; alt: string };

const HERO_IMAGE = "/wp-content/uploads/2023/06/hero2.png";
const GENERATED = "gallery.generated.json";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function readImages(): GalleryImage[] {
  let json: string;
  try {
    json = readShared(GENERATED);
  } catch (error) {
    throw new Error(`content/${GENERATED} is missing: it is written by scripts/write-site-files.mjs, which runs before \`next build\` and \`next dev\``, { cause: error });
  }
  return (JSON.parse(json) as { images: GalleryImage[] }).images;
}

function grid(images: GalleryImage[]) {
  const text = copy.gallery;
  const items = images.map(({ src, width, height, alt }) =>
    `<li class="tz-gallery__cell"><a class="tz-gallery__item" href="${esc(src)}">` +
    `<img src="${esc(src)}" width="${width}" height="${height}" alt="${esc(alt)}" loading="lazy" decoding="async">` +
    `</a></li>`).join("");
  // The viewer's labels, for lib/client/gallery.ts.
  const labels = `data-label="${esc(text.heading)}" data-previous-label="${esc(text.previous)}" data-next-label="${esc(text.next)}"` +
    ` data-close-label="${esc(text.close)}" data-counter="${esc(text.counter)}"`;
  return `<div class="tz-gallery" data-tz-gallery ${labels}><ul class="tz-gallery__grid" role="list">${items}</ul></div>`;
}

export function galleryPage(path: string): PageContent {
  const text = copy.gallery;
  return composePage({
    path,
    title: text.title,
    description: text.description,
    slug: "gallery",
    main: wrapEntry(text.title, renderHero({ image: HERO_IMAGE, heading: text.heading }) + grid(readImages()) + LARGE_SPACER),
    islands: ["signup", "gallery"]
  });
}

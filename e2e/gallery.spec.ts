import fs from "node:fs";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { expectClean, trackPageErrors } from "./helpers";

// The photos the page renders, in gallery order: the list the build makes from
// public/media/gallery (scripts/write-site-files.mjs), so adding or removing a
// photo there never breaks these tests.
type Photo = { src: string; width: number; height: number; alt: string };
const GALLERY_DIR = path.join(__dirname, "..", "public", "media", "gallery");
const GENERATED = path.join(__dirname, "..", "content", "gallery.generated.json");
if (!fs.existsSync(GENERATED)) throw new Error("content/gallery.generated.json is missing: run `npm run build` first");
const PHOTOS = (JSON.parse(fs.readFileSync(GENERATED, "utf8")) as { images: Photo[] }).images;
const N = PHOTOS.length;
// The tallest and the widest photo (1-based), by shape.
const byRatio = [...PHOTOS.keys()].sort((a, b) => PHOTOS[a].width / PHOTOS[a].height - PHOTOS[b].width / PHOTOS[b].height);
const TALLEST_AND_WIDEST = [...new Set([byRatio[0], byRatio[byRatio.length - 1]])].map((i) => i + 1);

const items = (page: Page) => page.locator("a.tz-gallery__item");
const viewer = (page: Page) => page.getByRole("dialog");
const shownImage = (page: Page) => viewer(page).locator("img.tz-gallery-viewer__img.is-current");
const counter = (page: Page) => viewer(page).locator(".tz-gallery-viewer__counter");
const button = (page: Page, name: string) => viewer(page).getByRole("button", { name, exact: true });

async function openGallery(page: Page) {
  const response = await page.goto("/gallery/");
  expect(response?.status()).toBe(200);
  // Clicks only open the viewer once the island is live.
  await expect(page.locator("[data-tz-gallery]")).toHaveAttribute("data-tz-gallery", "ready");
}

/** The viewer shows photo `n` (1-based): its image, its caption and the counter. */
async function expectPhoto(page: Page, n: number) {
  const photo = PHOTOS[n - 1];
  await expect(counter(page)).toHaveText(`${n} of ${N}`);
  await expect(shownImage(page)).toHaveAttribute("alt", photo.alt);
  await expect(shownImage(page)).toHaveAttribute("src", photo.src);
  await expect(viewer(page).locator(".tz-gallery-viewer__caption")).toHaveText(photo.alt);
}

/** A horizontal drag across the viewer's photo with the mouse (pointer events). */
async function drag(page: Page, dx: number) {
  const box = (await viewer(page).locator(".tz-gallery-viewer__stage").boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x - dx / 2, y);
  await page.mouse.down();
  await page.mouse.move(x + dx / 2, y, { steps: 8 });
  await page.mouse.up();
}

const decoded = (image: Locator) => image.evaluate((img: HTMLImageElement) => img.decode().then(() => img.naturalWidth));

test("/gallery/ opens with its own hero (hero2.png, \"Gallery\", no Resources subtitle), then every photo in the folder", async ({ page }) => {
  const errors = trackPageErrors(page);
  await openGallery(page);
  await expect(page).toHaveTitle("Gallery - Tzion Breslov");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", "Photos from Tzion Breslov classes and gatherings.");

  // renderHero: another image (no srcset/sizes left from resources.png), heading swapped, subtitle and its spacer gone.
  const hero = page.locator(".hero");
  await expect(hero).toHaveCount(1);
  const heroImage = hero.locator("img.wp-block-cover__image-background");
  await expect(heroImage).toHaveAttribute("src", "/wp-content/uploads/2023/06/hero2.png");
  expect(await heroImage.getAttribute("srcset")).toBeNull();
  expect(await heroImage.getAttribute("sizes")).toBeNull();
  await expect(hero.locator("h2 > strong")).toHaveText("Gallery");
  await expect(hero.locator(".wp-block-cover__inner-container > *")).toHaveCount(1);
  await expect(hero.locator("p, .wp-block-spacer")).toHaveCount(0);
  await expect(page.getByText("Resources for those seeking spiritual growth.")).toHaveCount(0);
  await expect(page.getByText("More purpose, passion and positivity")).toHaveCount(0);
  expect(await page.content()).not.toContain("resources.png");

  // Every photo file in the folder is listed (the 7 placeholders today), each a link to its own file,
  // around an image with its size and alt text, loaded lazily.
  const files = fs.readdirSync(GALLERY_DIR).filter((name) => !name.startsWith(".") && /\.(?:webp|jpe?g|png)$/i.test(name));
  expect(N).toBe(files.length);
  expect(N).toBeGreaterThan(0);
  await expect(items(page)).toHaveCount(N);
  for (const [i, { src, width, height, alt }] of PHOTOS.entries()) {
    const item = items(page).nth(i);
    await expect(item).toHaveAttribute("href", src);
    await expect(item).toHaveAccessibleName(alt);
    const img = item.locator("img");
    await expect(img).toHaveAttribute("src", src);
    await expect(img).toHaveAttribute("alt", alt);
    await expect(img).toHaveAttribute("loading", "lazy");
    await expect(img).toHaveAttribute("width", String(width));
    await expect(img).toHaveAttribute("height", String(height));
  }
  // The grid is above the footer, after the hero.
  const heroBox = (await hero.boundingBox())!;
  const firstBox = (await items(page).first().boundingBox())!;
  expect(firstBox.y).toBeGreaterThan(heroBox.y + heroBox.height);
  await expectClean(page, errors);
});

test("photos are shown whole at their own ratio, three across from 1024px, two from 600px, one below, 24px apart", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "sets its own viewport sizes");
  const errors = trackPageErrors(page);
  await openGallery(page);
  for (const [width, columns] of [[1440, 3], [1024, 3], [1023, 2], [600, 2], [599, 1], [412, 1], [390, 1]] as const) {
    await page.setViewportSize({ width, height: 900 });
    const layout = await items(page).evaluateAll(async (links) => Promise.all(links.map(async (link) => {
      const img = link.querySelector("img")!;
      img.loading = "eager";
      await img.decode();
      const box = img.getBoundingClientRect();
      const cell = link.parentElement!.getBoundingClientRect();
      return { x: Math.round(box.x), left: box.x, right: box.right, y: box.y, w: box.width, h: box.height, natural: img.naturalWidth / img.naturalHeight, fit: getComputedStyle(img).objectFit, cellW: cell.width };
    })));
    const lefts = [...new Set(layout.map((box) => box.x))];
    expect(lefts, `columns at ${width}px`).toHaveLength(columns);
    for (const box of layout) {
      // Whole: the box has the photo's own ratio and fills its cell's width (nothing cropped, nothing letterboxed).
      expect(Math.abs(box.w / box.h - box.natural), `ratio at ${width}px`).toBeLessThan(0.01);
      expect(["fill", "contain"]).toContain(box.fit);
      expect(Math.abs(box.w - box.cellW), `fills its cell at ${width}px`).toBeLessThan(1);
    }
    if (columns > 1) expect(Math.round(layout[1].left - layout[0].right), `gap at ${width}px`).toBe(24);
    else expect(Math.round(layout[1].y - (layout[0].y + layout[0].h)), `gap at ${width}px`).toBe(24);
    if (columns === 1) {
      // On phones a photo is as wide as the theme's content box: no inset of our own on top of the theme's.
      const content = await page.locator(".entry-content").evaluate((node) => node.getBoundingClientRect());
      expect(Math.abs(layout[0].left - content.left), `photo left edge at ${width}px`).toBeLessThan(0.5);
      expect(Math.abs(layout[0].w - content.width), `photo width at ${width}px`).toBeLessThan(0.5);
    }
  }
  await expectClean(page, errors);
});

test("the first photo opens in the viewer; arrows, buttons and swipes move through them all, wrapping around", async ({ page }) => {
  test.skip(N < 2, "needs two photos to move between");
  const errors = trackPageErrors(page);
  await openGallery(page);
  const first = items(page).first();
  await first.click();
  await expect(viewer(page)).toBeVisible();
  await expect(viewer(page)).toHaveAttribute("aria-modal", "true");
  await expect(viewer(page)).toHaveAccessibleName("Gallery");
  await expectPhoto(page, 1);
  // Focus starts inside, on the close button.
  await expect(button(page, "Close")).toBeFocused();

  await page.keyboard.press("ArrowRight");
  await expectPhoto(page, 2);
  await page.keyboard.press("ArrowLeft");
  await expectPhoto(page, 1);
  await page.keyboard.press("ArrowLeft");
  await expectPhoto(page, N);
  await page.keyboard.press("ArrowRight");
  await expectPhoto(page, 1);

  await button(page, "Next photo").click();
  await expectPhoto(page, 2);
  await button(page, "Previous photo").click();
  await button(page, "Previous photo").click();
  await expectPhoto(page, N);
  await button(page, "Next photo").click();
  await expectPhoto(page, 1);

  // Swipe left: the next photo; right: the previous one; a short drag (under 40px) does nothing.
  await drag(page, -160);
  await expectPhoto(page, 2);
  await drag(page, 160);
  await expectPhoto(page, 1);
  await drag(page, -30);
  await page.waitForTimeout(400);
  await expectPhoto(page, 1);

  // Tab never leaves the viewer.
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => !!document.activeElement?.closest(".tz-gallery-viewer"))).toBe(true);
  }
  await page.keyboard.press("Escape");
  await expect(page.locator(".tz-dialog")).toHaveCount(0);
  await expect(first).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.classList.contains("tz-dialog-open"))).toBe(false);

  // The close button closes it too (focus back on the photo that opened it), and so does a click on the backdrop.
  const last = items(page).nth(N - 1);
  await last.click();
  await expectPhoto(page, N);
  await button(page, "Close").click();
  await expect(page.locator(".tz-dialog")).toHaveCount(0);
  await expect(last).toBeFocused();
  await first.click();
  await expect(viewer(page)).toBeVisible();
  await page.mouse.click(3, 3);
  await expect(page.locator(".tz-dialog")).toHaveCount(0);
  // Arrow keys do nothing once it's closed.
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".tz-dialog")).toHaveCount(0);
  await expectClean(page, errors);
});

test("a touch swipe moves to the next and previous photo", async ({ page, isMobile }) => {
  test.skip(!isMobile, "real touch input (the phone project)");
  test.skip(N < 2, "needs two photos to move between");
  const errors = trackPageErrors(page);
  await openGallery(page);
  await items(page).first().click();
  await expectPhoto(page, 1);
  const box = (await viewer(page).locator(".tz-gallery-viewer__stage").boundingBox())!;
  const y = box.y + box.height / 2;
  const cdp = await page.context().newCDPSession(page);
  const swipe = async (from: number, to: number) => {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: from, y }] });
    for (let step = 1; step <= 8; step++) {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: from + ((to - from) * step) / 8, y }] });
    }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  };
  await swipe(box.x + box.width * 0.8, box.x + box.width * 0.2);
  await expectPhoto(page, 2);
  await swipe(box.x + box.width * 0.2, box.x + box.width * 0.8);
  await expectPhoto(page, 1);
  await expectClean(page, errors);
});

test("the viewer never scrolls and shows the whole photo, at desktop and phone sizes", async ({ page }) => {
  const errors = trackPageErrors(page);
  await openGallery(page);
  // The tallest and the widest photo.
  for (const n of TALLEST_AND_WIDEST) {
    await items(page).nth(n - 1).click();
    await expectPhoto(page, n);
    expect(await decoded(shownImage(page))).toBeGreaterThan(0);
    const viewport = page.viewportSize();
    const sizes = [{ width: 1440, height: 900 }, { width: 1280, height: 800 }, { width: 1024, height: 600 }, { width: 844, height: 390 }, { width: 390, height: 844 }, { width: 360, height: 640 }];
    for (const size of [viewport, ...sizes]) {
      if (size) await page.setViewportSize(size);
      const label = `photo ${n} at ${size?.width}x${size?.height}`;
      const box = await viewer(page).evaluate((node) => ({ sh: node.scrollHeight, ch: node.clientHeight, sw: node.scrollWidth, cw: node.clientWidth }));
      expect(box.sh, `viewer scroll height, ${label}`).toBeLessThanOrEqual(box.ch);
      expect(box.sw, `viewer scroll width, ${label}`).toBeLessThanOrEqual(box.cw);
      // The image box sits inside the viewer and on screen, and the photo is fitted into it whole.
      const fit = await shownImage(page).evaluate((img: HTMLImageElement) => {
        const r = img.getBoundingClientRect();
        const d = img.closest(".tz-dialog")!.getBoundingClientRect();
        return { fit: getComputedStyle(img).objectFit, inside: r.left >= d.left - 0.5 && r.right <= d.right + 0.5 && r.top >= d.top - 0.5 && r.bottom <= d.bottom + 0.5, h: r.height, onScreen: d.top >= 0 && d.bottom <= innerHeight && d.left >= 0 && d.right <= innerWidth };
      });
      expect(fit.fit, label).toBe("contain");
      expect(fit.inside, label).toBe(true);
      expect(fit.onScreen, label).toBe(true);
      expect(fit.h, label).toBeGreaterThan(100);
    }
    if (viewport) await page.setViewportSize(viewport);
    await page.keyboard.press("Escape");
    await expect(page.locator(".tz-dialog")).toHaveCount(0);
  }
  await expectClean(page, errors);
});

test("photos crossfade over .3s, and change at once with reduced motion", async ({ page }) => {
  test.skip(N < 2, "needs two photos to move between");
  const errors = trackPageErrors(page);
  await openGallery(page);
  await items(page).first().click();
  await expectPhoto(page, 1);
  expect(await shownImage(page).evaluate((img) => getComputedStyle(img).transitionDuration)).toBe("0.3s");
  await page.keyboard.press("ArrowRight");
  await expectPhoto(page, 2);
  // The old photo fades out underneath, then leaves.
  await expect(viewer(page).locator("img.tz-gallery-viewer__img")).toHaveCount(1);
  await page.keyboard.press("Escape");

  await page.emulateMedia({ reducedMotion: "reduce" });
  await items(page).first().click();
  await expectPhoto(page, 1);
  expect(await shownImage(page).evaluate((img) => getComputedStyle(img).transitionDuration)).toBe("0s");
  await page.keyboard.press("ArrowRight");
  expect(await viewer(page).locator("img.tz-gallery-viewer__img").count()).toBe(1);
  await expectPhoto(page, 2);
  await page.keyboard.press("Escape");
  expect(await page.locator(".tz-dialog, .tz-dialog-overlay").count()).toBe(0);
  await expectClean(page, errors);
});

test("Gallery is in the menus before Contact and marked current on /gallery/", async ({ page }) => {
  const errors = trackPageErrors(page);
  await openGallery(page);
  const labels = (list: string) => page.locator(`${list} > li`).evaluateAll((nodes) =>
    nodes.map((node) => node.querySelector(":scope > a, :scope > button, :scope > .tz-menu-group-label")?.textContent?.trim()));
  const desktop = ["Home", "About", "Resources", "Gallery", "Contact"];
  const lists = { "#menu-main-menu-links": desktop, "#menu-mobile-menu": [...desktop, "Donate", "Taste a Class"], "#menu-mobile-menu-1": [...desktop, "Donate", "Taste a Class"] };
  for (const [list, expected] of Object.entries(lists)) {
    expect(await labels(list), list).toEqual(expected);
    const current = page.locator(`${list} [aria-current="page"]`);
    await expect(current).toHaveCount(1);
    await expect(current).toHaveText("Gallery");
    await expect(current).toHaveAttribute("href", "/gallery/");
  }
  await expectClean(page, errors);
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });
  test("every photo is a visible link to its image file", async ({ page }) => {
    const errors = trackPageErrors(page);
    const response = await page.goto("/gallery/");
    expect(response?.status()).toBe(200);
    await expect(items(page)).toHaveCount(N);
    for (const [i, { src }] of PHOTOS.entries()) {
      const item = items(page).nth(i);
      await expect(item).toHaveAttribute("href", src);
      await item.scrollIntoViewIfNeeded();
      await expect(item).toBeVisible();
      const image = await page.request.get(src);
      expect(image.status()).toBe(200);
      expect(image.headers()["content-type"]).toMatch(/^image\//);
    }
    await items(page).first().click();
    await page.waitForURL((url) => url.pathname === PHOTOS[0].src);
    await expectClean(page, errors);
  });
});

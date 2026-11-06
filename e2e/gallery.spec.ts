import fs from "node:fs";
import path from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { expectClean, trackPageErrors } from "./helpers";

// The placeholder photos and their alt text, in gallery order (public/media/gallery/gallery.json).
type Entry = { alt: string; order: number };
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "public", "media", "gallery", "gallery.json"), "utf8")) as { files: Record<string, Entry> };
const PHOTOS = Object.entries(manifest.files).sort(([, a], [, b]) => a.order - b.order).map(([file, { alt }]) => ({ file, alt }));

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
  await expect(counter(page)).toHaveText(`${n} of ${PHOTOS.length}`);
  await expect(shownImage(page)).toHaveAttribute("alt", photo.alt);
  await expect(shownImage(page)).toHaveAttribute("src", `/media/gallery/${photo.file}`);
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

test("/gallery/ opens with its own hero (hero2.png, \"Gallery\", no Resources subtitle), then the seven photos", async ({ page }) => {
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

  // Each photo is a link to its own file, around an image with its size and alt text, loaded lazily.
  expect(PHOTOS).toHaveLength(7);
  await expect(items(page)).toHaveCount(PHOTOS.length);
  for (const [i, { file, alt }] of PHOTOS.entries()) {
    const item = items(page).nth(i);
    await expect(item).toHaveAttribute("href", `/media/gallery/${file}`);
    await expect(item).toHaveAccessibleName(alt);
    const img = item.locator("img");
    await expect(img).toHaveAttribute("src", `/media/gallery/${file}`);
    await expect(img).toHaveAttribute("alt", alt);
    await expect(img).toHaveAttribute("loading", "lazy");
    await expect(img).toHaveAttribute("width", /^\d+$/);
    await expect(img).toHaveAttribute("height", /^\d+$/);
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
  for (const [width, columns] of [[1440, 3], [1024, 3], [1023, 2], [600, 2], [599, 1], [390, 1]] as const) {
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
  }
  await expectClean(page, errors);
});

test("the first photo opens in the viewer; arrows, buttons and swipes move through all seven, wrapping around", async ({ page }) => {
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
  await expectPhoto(page, 7);
  await page.keyboard.press("ArrowRight");
  await expectPhoto(page, 1);

  await button(page, "Next photo").click();
  await expectPhoto(page, 2);
  await button(page, "Previous photo").click();
  await button(page, "Previous photo").click();
  await expectPhoto(page, 7);
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

  // The close button closes it too, and so does a click on the backdrop.
  await items(page).nth(2).click();
  await expectPhoto(page, 3);
  await button(page, "Close").click();
  await expect(page.locator(".tz-dialog")).toHaveCount(0);
  await expect(items(page).nth(2)).toBeFocused();
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
  // The tallest placeholder (the portrait) and a wide one.
  for (const n of [4, 5]) {
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
    await expect(items(page)).toHaveCount(PHOTOS.length);
    for (const [i, { file }] of PHOTOS.entries()) {
      const item = items(page).nth(i);
      await expect(item).toHaveAttribute("href", `/media/gallery/${file}`);
      await item.scrollIntoViewIfNeeded();
      await expect(item).toBeVisible();
      const image = await page.request.get(`/media/gallery/${file}`);
      expect(image.status()).toBe(200);
      expect(image.headers()["content-type"]).toBe("image/webp");
    }
    await items(page).first().click();
    await page.waitForURL(`**/media/gallery/${PHOTOS[0].file}`);
    await expectClean(page, errors);
  });
});

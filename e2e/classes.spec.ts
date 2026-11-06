import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { expectClean, trackPageErrors } from "./helpers";

type Clip = { id: string; title: string; published: string };
const readContent = <T>(file: string): T => JSON.parse(fs.readFileSync(path.join(__dirname, "..", "content", file), "utf8")) as T;
const SHORTS = readContent<{ shorts: Clip[] }>("shorts.json").shorts;
const VIDEOS = readContent<{ videos: Clip[] }>("youtube.json").videos;

const library = (page: Page) => page.locator("[data-tz-video-library]");
const grid = (page: Page, kind: "video" | "short") => page.locator(`.tz-vl__grid[data-kind="${kind}"]`);
const shown = (page: Page, kind: "video" | "short") => grid(page, kind).locator(".tz-vl__card:not([hidden])");
const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true });

/** The visible cards of a tab, in page order. */
const cards = (page: Page, kind: "video" | "short") =>
  shown(page, kind).evaluateAll((nodes) => nodes.map((node) => {
    const card = node as HTMLElement;
    return {
      id: card.dataset.id ?? "",
      title: card.dataset.title ?? "",
      time: Date.parse(card.dataset.published ?? ""),
      views: card.dataset.views === undefined ? null : Number(card.dataset.views)
    };
  }));

async function openClasses(page: Page) {
  const response = await page.goto("/classes/");
  expect(response?.status()).toBe(200);
  // The buttons only work once the island is live.
  await expect(library(page)).toHaveAttribute("data-tz-video-library", "ready");
}

// The player itself is YouTube's: answer its embed locally, so the tests never
// depend on YouTube (CSP still checks the frame's origin before the route answers).
const stubPlayer = (page: Page) =>
  page.route("https://www.youtube-nocookie.com/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Player</title><p>Player</p>" }));

test("Videos opens first, newest first, under the channel header", async ({ page }) => {
  const errors = trackPageErrors(page);
  await openClasses(page);
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page.locator("h1#tz-vl-title")).toHaveText("Classes");
  // A no-break space ties the "·" to the handle.
  expect(await page.locator(".tz-vl__meta").textContent()).toBe(`@tzionbreslovproject\u00a0· ${VIDEOS.length + SHORTS.length} videos`);
  await expect(button(page, "Videos")).toHaveAttribute("aria-pressed", "true");
  await expect(button(page, "Shorts")).toHaveAttribute("aria-pressed", "false");
  await expect(button(page, "Latest")).toHaveAttribute("aria-pressed", "true");
  await expect(grid(page, "short")).toBeHidden();

  const videos = await cards(page, "video");
  expect(videos).toHaveLength(VIDEOS.length);
  for (let i = 1; i < videos.length; i++) expect(videos[i].time).toBeLessThanOrEqual(videos[i - 1].time);

  // On phones the handle never breaks, and a wrapped line starts with the count, not a bare "·".
  for (const width of [320, 360, 390, 414]) {
    await page.setViewportSize({ width, height: 800 });
    const meta = await page.locator(".tz-vl__meta").evaluate((node) => {
      const handle = node.querySelector("strong")!.getClientRects();
      const count = node.querySelector(".tz-vl__count")!.getBoundingClientRect();
      return { handleLines: handle.length, handleTop: handle[0].top, countTop: count.top, countLeft: count.left, left: node.getBoundingClientRect().left };
    });
    expect(meta.handleLines, `handle lines at ${width}px`).toBe(1);
    if (meta.countTop > meta.handleTop + 1) expect(Math.round(meta.countLeft), `count starts its line at ${width}px`).toBe(Math.round(meta.left));
  }
  await expectClean(page, errors);
});

test("Oldest and Most popular reorder the videos", async ({ page }) => {
  const errors = trackPageErrors(page);
  await openClasses(page);

  await button(page, "Oldest").click();
  await expect(button(page, "Oldest")).toHaveAttribute("aria-pressed", "true");
  await expect(button(page, "Latest")).toHaveAttribute("aria-pressed", "false");
  const oldest = await cards(page, "video");
  expect(oldest).toHaveLength(VIDEOS.length);
  for (let i = 1; i < oldest.length; i++) expect(oldest[i].time).toBeGreaterThanOrEqual(oldest[i - 1].time);

  await button(page, "Most popular").click();
  await expect(button(page, "Most popular")).toHaveAttribute("aria-pressed", "true");
  const popular = await cards(page, "video");
  expect(popular).toHaveLength(VIDEOS.length);
  // Counted videos first, most viewed first; then the uncounted ones, newest first.
  const counted = popular.findIndex((video) => video.views === null);
  const split = counted < 0 ? popular.length : counted;
  expect(popular.slice(split).every((video) => video.views === null)).toBe(true);
  for (let i = 1; i < split; i++) expect(popular[i].views!).toBeLessThanOrEqual(popular[i - 1].views!);
  for (let i = split + 1; i < popular.length; i++) expect(popular[i].time).toBeLessThanOrEqual(popular[i - 1].time);

  await button(page, "Latest").click();
  expect((await cards(page, "video")).map((video) => video.id)).toEqual(VIDEOS.map((video) => video.id));
  await expectClean(page, errors);
});

test("Shorts lists the 26 bite-size clips, newest first, without the sort buttons", async ({ page }) => {
  const errors = trackPageErrors(page);
  await openClasses(page);
  await button(page, "Shorts").click();
  await expect(button(page, "Shorts")).toHaveAttribute("aria-pressed", "true");
  await expect(button(page, "Videos")).toHaveAttribute("aria-pressed", "false");
  await expect(grid(page, "video")).toBeHidden();
  await expect(page.locator(".tz-vl__sort")).toBeHidden();

  expect(SHORTS).toHaveLength(26);
  await expect(shown(page, "short")).toHaveCount(26);
  expect((await cards(page, "short")).map((clip) => clip.id)).toEqual(SHORTS.map((clip) => clip.id));
  const first = shown(page, "short").first();
  expect(await first.locator(".tz-vl__details strong").textContent()).toBe(SHORTS[0].title);
  // Title only: the clips' only dates are WordPress upload times.
  await expect(first.locator(".tz-vl__details span")).toHaveCount(0);

  await button(page, "Videos").click();
  await expect(page.locator(".tz-vl__sort")).toBeVisible();
  await expect(shown(page, "video")).toHaveCount(VIDEOS.length);
  await expectClean(page, errors);
});

test("search filters the clips, says when nothing matches, and Escape clears it", async ({ page }) => {
  const errors = trackPageErrors(page);
  await openClasses(page);
  await button(page, "Shorts").click();
  const toggle = button(page, "Search videos");
  await toggle.click();
  const input = page.getByRole("searchbox", { name: "Search videos" });
  await expect(input).toBeFocused();

  await input.fill("bitul");
  await expect(shown(page, "short")).toHaveCount(1);
  expect((await cards(page, "short"))[0].title).toBe("Rabbi Kalmus Daily Ray of Wisdom: What is Bitul?");

  const empty = page.locator(".tz-vl__empty");
  await expect(empty).toBeHidden();
  await input.fill("qqzzxx no such class");
  await expect(shown(page, "short")).toHaveCount(0);
  await expect(empty).toBeVisible();
  await expect(empty).toHaveText("No videos match that search.");

  await input.press("Escape");
  await expect(input).toBeHidden();
  await expect(toggle).toBeFocused();
  await expect(empty).toBeHidden();
  await expect(shown(page, "short")).toHaveCount(26);

  // The clear button does the same; switching tabs starts a fresh search.
  await toggle.click();
  await input.fill("bitul");
  await button(page, "Clear search").click();
  await expect(shown(page, "short")).toHaveCount(26);
  await toggle.click();
  await input.fill("kalmus");
  await button(page, "Videos").click();
  await expect(input).toHaveValue("");
  await expect(shown(page, "video")).toHaveCount(VIDEOS.length);

  // The open search box never covers the tabs, down to small phones, and leaves room to type.
  type Box = { x: number; y: number; width: number; height: number };
  const overlaps = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  const field = page.locator(".tz-vl__search-field");
  for (const width of [360, 390, 414, 768]) {
    await page.setViewportSize({ width, height: 800 });
    const [box, videos, shorts] = await Promise.all([field, button(page, "Videos"), button(page, "Shorts")].map((part) => part.boundingBox()));
    if (!box || !videos || !shorts) throw new Error(`search box or tabs not laid out at ${width}px`);
    expect(overlaps(box, videos), `search box over "Videos" at ${width}px`).toBe(false);
    expect(overlaps(box, shorts), `search box over "Shorts" at ${width}px`).toBe(false);
    expect(box.width, `search box width at ${width}px`).toBeGreaterThanOrEqual(200);
  }
  await expectClean(page, errors);
});

test("a card plays its video in the dialog; Escape, the close button and the backdrop close it", async ({ page }) => {
  const errors = trackPageErrors(page);
  await stubPlayer(page);
  await openClasses(page);
  await expect(page.locator("iframe")).toHaveCount(0);

  const [first, second] = await cards(page, "video");
  const firstLink = shown(page, "video").first().locator("a.tz-vl__trigger");
  await firstLink.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await expect(dialog).toHaveAccessibleName(first.title);
  await expect(dialog.locator(".tz-vl-player__title")).toHaveText(first.title);
  const iframe = dialog.locator("iframe");
  await expect(iframe).toHaveAttribute("src", `https://www.youtube-nocookie.com/embed/${first.id}?autoplay=1&playsinline=1&rel=0`);
  await expect(iframe).toHaveAttribute("title", first.title);
  expect(await page.evaluate(() => document.documentElement.classList.contains("tz-dialog-open"))).toBe(true);

  // Nothing in the player box to scroll (a scrollbar would show wherever scrollbars take up room).
  const viewport = page.viewportSize();
  const sizes = [{ width: 1440, height: 900 }, { width: 1024, height: 600 }, { width: 844, height: 390 }, { width: 390, height: 844 }];
  for (const size of [viewport, ...sizes]) {
    if (size) await page.setViewportSize(size);
    const box = await dialog.evaluate((node) => ({ sh: node.scrollHeight, ch: node.clientHeight, sw: node.scrollWidth, cw: node.clientWidth }));
    expect(box.sh, `player scroll height at ${size?.width}x${size?.height}`).toBeLessThanOrEqual(box.ch);
    expect(box.sw, `player scroll width at ${size?.width}x${size?.height}`).toBeLessThanOrEqual(box.cw);
  }
  if (viewport) await page.setViewportSize(viewport);

  // Focus starts on the close button and Tab never leaves the dialog.
  const close = dialog.getByRole("button", { name: "Close video player" });
  await expect(close).toBeFocused();
  const focusInDialog = () => page.evaluate(() => !!document.activeElement?.closest(".tz-dialog"));
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press("Tab");
    expect(await focusInDialog()).toBe(true);
  }
  await page.keyboard.press("Shift+Tab");
  expect(await focusInDialog()).toBe(true);

  await close.focus();
  await page.keyboard.press("Escape");
  await expect(page.locator(".tz-dialog")).toHaveCount(0);
  await expect(page.locator("iframe")).toHaveCount(0);
  await expect(firstLink).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.classList.contains("tz-dialog-open"))).toBe(false);

  const secondLink = shown(page, "video").nth(1).locator("a.tz-vl__trigger");
  await secondLink.click();
  await expect(dialog.locator("iframe")).toHaveAttribute("src", new RegExp(`/embed/${second.id}\\?`));
  await dialog.getByRole("button", { name: "Close video player" }).click();
  await expect(page.locator(".tz-dialog")).toHaveCount(0);
  await expect(secondLink).toBeFocused();

  await firstLink.click();
  await expect(dialog).toBeVisible();
  await page.mouse.click(4, 4);
  await expect(page.locator(".tz-dialog")).toHaveCount(0);
  await expectClean(page, errors);
});

test("with reduced motion the player closes at once", async ({ page }) => {
  const errors = trackPageErrors(page);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await stubPlayer(page);
  await openClasses(page);
  await shown(page, "video").first().locator("a.tz-vl__trigger").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  expect(await page.locator(".tz-dialog, .tz-dialog-overlay").count()).toBe(0);
  await expectClean(page, errors);
});

test("the channel link opens YouTube in a new tab", async ({ page }) => {
  const errors = trackPageErrors(page);
  await openClasses(page);
  const channel = page.getByRole("link", { name: "Visit our YouTube channel" });
  await expect(channel).toHaveAttribute("href", "https://youtube.com/@tzionbreslovproject");
  await expect(channel).toHaveAttribute("target", "_blank");
  await expect(channel).toHaveAttribute("rel", "noopener noreferrer");
  await expectClean(page, errors);
});

// Thumbnails keep today's size: the first thumbnail's width on the old Resources
// page's Classes tab, measured at these viewport widths before it was removed.
const RESOURCES_THUMBNAIL_WIDTHS: Array<[viewport: number, width: number]> = [[1440, 375.28], [1024, 299.95], [768, 214.64], [390, 298]];
test("thumbnails are as wide as on the Resources Classes tab", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "sets its own viewport sizes");
  const errors = trackPageErrors(page);
  await page.goto("/classes/");
  const classes: number[] = [];
  for (const [viewport] of RESOURCES_THUMBNAIL_WIDTHS) {
    await page.setViewportSize({ width: viewport, height: 900 });
    // Read once the layout has stopped changing.
    classes.push(await page.locator(".tz-vl__thumb").first().evaluate(async (node) => {
      for (let last = -1; ; await new Promise((resolve) => setTimeout(resolve, 150))) {
        const now = node.getBoundingClientRect().width;
        if (now === last) return now;
        last = now;
      }
    }));
  }
  testInfo.annotations.push({ type: "thumbnail widths", description: RESOURCES_THUMBNAIL_WIDTHS.map(([viewport, width], i) => `${viewport}px: ${classes[i]} (Resources ${width})`).join(", ") });
  RESOURCES_THUMBNAIL_WIDTHS.forEach(([viewport, width], i) =>
    expect(Math.abs(classes[i] - width), `at ${viewport}px: classes ${classes[i]} vs Resources ${width}`).toBeLessThanOrEqual(2));
  await expectClean(page, errors);
});

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });
  test("every video and clip is a visible link to YouTube, and no control that needs JS shows", async ({ page }) => {
    const errors = trackPageErrors(page);
    const response = await page.goto("/classes/");
    expect(response?.status()).toBe(200);
    const link = shown(page, "video").first().locator("a.tz-vl__trigger");
    await expect(link).toHaveAttribute("href", `https://www.youtube.com/watch?v=${VIDEOS[0].id}`);
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("aria-label", `Play video: ${VIDEOS[0].title}`);

    // Both tabs' cards, one after the other under the tab names.
    const watch = (clips: Clip[]) => clips.map((clip) => `https://www.youtube.com/watch?v=${clip.id}`);
    for (const [kind, name, clips] of [["video", "Videos", VIDEOS], ["short", "Shorts", SHORTS]] as const) {
      await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
      const links = grid(page, kind).locator("a.tz-vl__trigger");
      await expect(links).toHaveCount(clips.length);
      expect(await links.evaluateAll((nodes) => nodes.map((node) => node.getAttribute("href")))).toEqual(watch([...clips]));
      for (const each of await links.all()) await expect(each).toBeVisible();
    }
    expect(SHORTS).toHaveLength(26);

    // The tabs, search and sort only work with JS: none of them shows.
    await expect(page.locator(".tz-vl__bar")).toBeHidden();
    await expect(library(page).locator("button:visible, input:visible")).toHaveCount(0);
    await expectClean(page, errors);
  });
});

test("/classes/ ends with the Resources page's closing sections", async ({ page }) => {
  const errors = trackPageErrors(page);
  await openClasses(page);
  await expect(page.locator(".hero h2", { hasText: "More purpose, passion and positivity" })).toBeVisible();
  await expect(page.getByText("Live Speaking Engagements:")).toBeVisible();
  await expect(page.getByRole("link", { name: "Yes, I would like to donate" })).toHaveAttribute("href", "/donate/");
  await expectClean(page, errors);
});

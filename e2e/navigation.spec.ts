import fs from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { expectClean, trackPageErrors } from "./helpers";

// The header menus and footer Quick Links (lib/navigation.mjs, lib/client/menu.ts, app/navigation.css).
const desktopParent = (page: Page) => page.locator("#menu-item-33");
const desktopToggle = (page: Page) => page.locator("#menu-item-33 > .tz-submenu-toggle");
const desktopPanel = (page: Page) => page.locator("#tz-sub-resources");
const mobileParent = (page: Page) => page.locator("#menu-item-342");
const mobileToggle = (page: Page) => page.locator("#menu-item-342 > .tz-submenu-toggle");
const mobilePanel = (page: Page) => page.locator("#tz-sub-resources-mobile");
const panelLink = (panel: Locator, name: string) => panel.getByRole("link", { name, exact: true });

/** The menus' script is live (before that, CSS alone opens the desktop panel). */
const menusReady = async (page: Page) => {
  await expect(desktopParent(page)).toHaveAttribute("data-tz-menu", "ready");
  await expect(mobileParent(page)).toHaveAttribute("data-tz-menu", "ready");
};

/** The link is what the browser hits at its centre: nothing (the hero, the logo) covers it. */
const isOnTop = (link: Locator) => link.evaluate((node) => {
  const box = node.getBoundingClientRect();
  return node.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
});

const QUICK_LINKS = ["Home", "About", "Resources", "Classes", "Articles", "Gallery", "Contact", "Donate", "Taste a Class"];

test.describe("desktop menu", () => {
  test.skip(({ isMobile }) => isMobile, "the desktop menu shows from 1280px");

  test("hovering Resources shows Classes and Articles above the hero, at the top and after scrolling", async ({ page }) => {
    const errors = trackPageErrors(page);
    await page.goto("/");
    await menusReady(page);
    for (const scrollY of [0, 1200]) {
      await page.evaluate((y) => window.scrollTo(0, y), scrollY);
      if (scrollY) await expect(page.locator("header.site-header")).toHaveClass(/\bscroll\b/);
      await desktopToggle(page).hover();
      await expect(desktopPanel(page)).toBeVisible();
      await expect(desktopToggle(page)).toHaveAttribute("aria-expanded", "true");
      for (const name of ["Classes", "Articles"]) {
        const link = panelLink(desktopPanel(page), name);
        await expect(link).toBeVisible();
        expect(await isOnTop(link), `${name} on top at scrollY ${scrollY}`).toBe(true);
      }
      // Leaving closes it again.
      await page.mouse.move(700, 600);
      await expect(desktopPanel(page)).toBeHidden();
      await expect(desktopToggle(page)).toHaveAttribute("aria-expanded", "false");
    }
    await expectClean(page, errors);
  });

  test("the keyboard opens the panel, reaches Classes and Articles, and Escape closes it", async ({ page }) => {
    const errors = trackPageErrors(page);
    await page.goto("/");
    await menusReady(page);
    for (let i = 0; i < 10 && !(await desktopToggle(page).evaluate((node) => node === document.activeElement)); i++) await page.keyboard.press("Tab");
    await expect(desktopToggle(page)).toBeFocused();
    await expect(desktopPanel(page)).toBeHidden();
    await page.keyboard.press("Enter");
    await expect(desktopToggle(page)).toHaveAttribute("aria-expanded", "true");
    await expect(desktopPanel(page)).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(panelLink(desktopPanel(page), "Classes")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(panelLink(desktopPanel(page), "Articles")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(desktopToggle(page)).toHaveAttribute("aria-expanded", "false");
    await expect(desktopPanel(page)).toBeHidden();
    await expect(desktopToggle(page)).toBeFocused();
    // Space opens it too; tabbing out of it closes it.
    await page.keyboard.press("Space");
    await expect(desktopPanel(page)).toBeVisible();
    for (let i = 0; i < 3; i++) await page.keyboard.press("Tab");
    await expect(page.locator("#menu-item-tz-gallery > a")).toBeFocused();
    await expect(desktopPanel(page)).toBeHidden();
    await expectClean(page, errors);
  });

  test("a panel the mouse opened stays open while keyboard focus is inside it", async ({ page }) => {
    const errors = trackPageErrors(page);
    await page.goto("/");
    await menusReady(page);
    await desktopToggle(page).hover();
    await expect(desktopPanel(page)).toBeVisible();
    await desktopToggle(page).focus();
    await page.keyboard.press("Tab");
    const classes = panelLink(desktopPanel(page), "Classes");
    await expect(classes).toBeFocused();
    await page.mouse.move(700, 600);
    // Give a wrongly closing panel the time to close.
    await page.waitForTimeout(300);
    await expect(desktopPanel(page)).toBeVisible();
    await expect(desktopToggle(page)).toHaveAttribute("aria-expanded", "true");
    await expect(classes).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(desktopPanel(page)).toBeHidden();
    await expect(desktopToggle(page)).toBeFocused();
    await expectClean(page, errors);
  });

  test("Enter and Space toggle the panel even while the mouse rests on Resources", async ({ page }) => {
    const errors = trackPageErrors(page);
    await page.goto("/");
    await menusReady(page);
    await desktopToggle(page).hover();
    await expect(desktopPanel(page)).toBeVisible();
    await desktopToggle(page).focus();
    await page.keyboard.press("Enter");
    await expect(desktopToggle(page)).toHaveAttribute("aria-expanded", "false");
    await expect(desktopPanel(page)).toBeHidden();
    await page.keyboard.press("Space");
    await expect(desktopToggle(page)).toHaveAttribute("aria-expanded", "true");
    await expect(desktopPanel(page)).toBeVisible();
    await page.keyboard.press("Space");
    await expect(desktopPanel(page)).toBeHidden();
    await expectClean(page, errors);
  });

  for (const how of ["hovered", "focused"] as const) {
    test(`a panel CSS showed before the script ran (${how}) stays open when the script takes over`, async ({ page }) => {
      const errors = trackPageErrors(page);
      // Hold the page's scripts back, so the panel is first shown by CSS alone.
      let release!: () => void;
      const scriptsHeld = new Promise<void>((resolve) => { release = resolve; });
      await page.route("**/_next/static/chunks/*.js", async (route) => {
        await scriptsHeld;
        await route.continue();
      });
      await page.goto("/", { waitUntil: "domcontentloaded" });
      if (how === "hovered") await desktopToggle(page).hover();
      else await desktopToggle(page).focus();
      await expect(desktopPanel(page)).toBeVisible();
      await expect(desktopParent(page)).not.toHaveAttribute("data-tz-menu", "ready");
      release();
      await menusReady(page);
      await expect(desktopToggle(page)).toHaveAttribute("aria-expanded", "true");
      await expect(desktopPanel(page)).toBeVisible();
      // From here on the script decides: the mouse leaving, or Escape, closes it.
      if (how === "hovered") await page.mouse.move(700, 600);
      else await page.keyboard.press("Escape");
      await expect(desktopPanel(page)).toBeHidden();
      await expect(desktopToggle(page)).toHaveAttribute("aria-expanded", "false");
      await expectClean(page, errors);
    });
  }

  test("clicking Articles goes to /articles/ and marks it current", async ({ page }) => {
    const errors = trackPageErrors(page);
    await page.goto("/");
    await menusReady(page);
    await desktopToggle(page).hover();
    await expect(desktopPanel(page)).toBeVisible();
    await panelLink(desktopPanel(page), "Articles").click();
    await page.waitForURL("**/articles/");
    await expect(desktopParent(page)).toHaveClass(/\bcurrent-menu-ancestor\b/);
    // The panel is closed on the new page: read its (hidden) links from the DOM.
    await expect(page.locator("#menu-main-menu-links [aria-current]")).toHaveCount(1);
    await expect(desktopPanel(page).locator('a[aria-current="page"]')).toHaveText("Articles");
    // A click on the hovered toggle pins the panel, a second click closes it, a click elsewhere too.
    await desktopToggle(page).click();
    await expect(desktopToggle(page)).toHaveAttribute("aria-expanded", "true");
    await desktopToggle(page).click();
    await expect(desktopToggle(page)).toHaveAttribute("aria-expanded", "false");
    await desktopToggle(page).click();
    await expect(desktopPanel(page)).toBeVisible();
    await page.mouse.click(700, 600);
    await expect(desktopPanel(page)).toBeHidden();
    await expectClean(page, errors);
  });

  test("at 1280px and 1440px the menu stays on one line, clear of the logo (still centred) and the buttons", async ({ page }) => {
    const errors = trackPageErrors(page);
    // On /classes/ Resources is bold, on /gallery/ Gallery: the widest the menu gets.
    for (const width of [1280, 1440]) {
      await page.setViewportSize({ width, height: 800 });
      for (const path of ["/", "/classes/", "/gallery/"]) {
        await page.goto(path);
        const layout = await page.evaluate(() => {
          const box = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
          const items = [...document.querySelectorAll<HTMLElement>("#menu-main-menu-links > li")];
          const title = box(".title-area");
          return {
            tops: items.map((item) => item.offsetTop),
            lastRight: items.at(-1)!.getBoundingClientRect().right,
            menuRight: box("#menu-main-menu-links").right,
            titleLeft: title.left,
            titleCentre: title.left + title.width / 2,
            // The page's own width: without a vertical scrollbar's, where scrollbars take up room.
            pageCentre: document.documentElement.clientWidth / 2,
            buttonsLeft: box("#menu-main-menu-buttons").left
          };
        });
        const at = `${path} at ${width}px`;
        expect(layout.tops, at).toHaveLength(5);
        expect(new Set(layout.tops).size, `one line on ${at}`).toBe(1);
        expect(layout.menuRight, at).toBeLessThanOrEqual(layout.titleLeft);
        expect(layout.lastRight, at).toBeLessThanOrEqual(layout.titleLeft);
        expect(layout.lastRight, at).toBeLessThan(layout.buttonsLeft);
        // The logo stays in the middle of the header, as on checkpoint-001: the menu never pushes it aside.
        expect(Math.abs(layout.titleCentre - layout.pageCentre), `logo centred on ${at}`).toBeLessThanOrEqual(0.5);
      }
    }
    await expectClean(page, errors);
  });
});

test.describe("touch tablet", () => {
  test.skip(({ isMobile }) => isMobile, "a landscape tablet shows the desktop menu");
  test.use({ viewport: { width: 1366, height: 1024 }, hasTouch: true });

  test("tapping Resources opens the panel without navigating; tapping Classes navigates", async ({ page }) => {
    const errors = trackPageErrors(page);
    await page.goto("/");
    await menusReady(page);
    await desktopToggle(page).tap();
    await expect(desktopToggle(page)).toHaveAttribute("aria-expanded", "true");
    await expect(desktopPanel(page)).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/");
    // A second tap closes it, a third opens it again.
    await desktopToggle(page).tap();
    await expect(desktopPanel(page)).toBeHidden();
    await desktopToggle(page).tap();
    await expect(desktopPanel(page)).toBeVisible();
    await panelLink(desktopPanel(page), "Classes").tap();
    await page.waitForURL("**/classes/");
    await expectClean(page, errors);
  });
});

test.describe("mobile menu", () => {
  test.skip(({ isMobile }) => !isMobile, "the phone menu");

  test("the hamburger opens the menu; tapping Resources expands Classes and Articles in place; Classes navigates", async ({ page }) => {
    const errors = trackPageErrors(page);
    await page.goto("/");
    await menusReady(page);
    await page.locator("button.menu-toggle").tap();
    await expect(page.locator(".site-container")).toHaveClass(/\bmobile-nav-active\b/);
    await expect(mobileToggle(page)).toBeInViewport();
    await expect(mobilePanel(page)).toBeHidden();
    await mobileToggle(page).tap();
    await expect(mobileToggle(page)).toHaveAttribute("aria-expanded", "true");
    await expect(panelLink(mobilePanel(page), "Classes")).toBeVisible();
    await expect(panelLink(mobilePanel(page), "Articles")).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/");
    // In place, indented under Resources, above Contact.
    const toggleBox = (await mobileToggle(page).boundingBox())!;
    const classesBox = (await panelLink(mobilePanel(page), "Classes").boundingBox())!;
    const contactBox = (await page.locator("#menu-item-341 > a").boundingBox())!;
    expect(classesBox.x).toBeGreaterThan(toggleBox.x);
    expect(classesBox.y).toBeGreaterThan(toggleBox.y);
    expect(contactBox.y).toBeGreaterThan(classesBox.y);
    await panelLink(mobilePanel(page), "Classes").tap();
    await page.waitForURL("**/classes/");
    await expect(page.locator("#menu-item-342")).toHaveClass(/\bcurrent-menu-ancestor\b/);
    await expectClean(page, errors);
  });
});

test.describe("without JavaScript", () => {
  test.skip(({ isMobile }) => isMobile, "the desktop menu");
  test.use({ javaScriptEnabled: false });

  test("focusing or hovering Resources shows its panel", async ({ page }) => {
    const errors = trackPageErrors(page);
    await page.goto("/");
    await expect(desktopPanel(page)).toBeHidden();
    await desktopToggle(page).focus();
    await expect(panelLink(desktopPanel(page), "Classes")).toBeVisible();
    await expect(panelLink(desktopPanel(page), "Articles")).toBeVisible();
    await page.locator("#menu-item-32 > a").focus();
    await expect(desktopPanel(page)).toBeHidden();
    await desktopToggle(page).hover();
    await expect(panelLink(desktopPanel(page), "Classes")).toBeVisible();
    await expectClean(page, errors);
  });
});

test("the footer Quick Links follow the menu", async ({ page }) => {
  const errors = trackPageErrors(page);
  await page.goto("/contact/");
  const quickLinks = page.locator("#menu-mobile-menu-1");
  expect(await quickLinks.locator("a, .tz-menu-group-label").allTextContents()).toEqual(QUICK_LINKS);
  await expect(quickLinks.getByRole("link", { name: "Classes", exact: true })).toHaveAttribute("href", "/classes/");
  await expect(quickLinks.getByRole("link", { name: "Articles", exact: true })).toHaveAttribute("href", "/articles/");
  await expect(quickLinks.getByRole("link", { name: "Home", exact: true })).toHaveAttribute("href", "/");
  await expect(quickLinks.locator("[aria-current]")).toHaveText("Contact");
  await expectClean(page, errors);
});

test("the old Resources and /about/ buttons keep their labels and go to Classes and About", async ({ page }) => {
  const errors = trackPageErrors(page);
  const link = (name: string) => page.locator("#genesis-content").getByRole("link", { name, exact: true });
  await page.goto("/");
  await expect(link("ENRICH YOUR LIFE")).toHaveAttribute("href", "/classes/");
  await expect(link("Enrich your life")).toHaveAttribute("href", "/classes/");
  await expect(link("Read my full story")).toHaveAttribute("href", "/about-us/");
  await page.goto("/about-us/");
  await expect(link("Enrich your life")).toHaveAttribute("href", "/classes/");
  await expectClean(page, errors);
});

// For the pull request: the header and footer at 1280, 1440 and 390, and the open panel on desktop and phone.
test("screenshots of the menus", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "sets its own viewport sizes");
  const errors = trackPageErrors(page);
  const dir = "test-results/nav";
  fs.mkdirSync(dir, { recursive: true });
  for (const width of [1280, 1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/classes/");
    await menusReady(page);
    // The page fades in on load.
    await page.waitForTimeout(1500);
    await page.locator("header.site-header").screenshot({ path: `${dir}/header-${width}.png` });
    const footer = page.locator("#genesis-footer-widgets");
    await footer.scrollIntoViewIfNeeded();
    await page.waitForTimeout(1200);
    await footer.screenshot({ path: `${dir}/footer-${width}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await menusReady(page);
  await desktopToggle(page).hover();
  await expect(desktopPanel(page)).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${dir}/dropdown-desktop-1440.png`, clip: { x: 0, y: 0, width: 1440, height: 320 } });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/classes/");
  await menusReady(page);
  await page.locator("button.menu-toggle").click();
  await mobileToggle(page).click();
  await expect(mobilePanel(page)).toBeVisible();
  await page.waitForTimeout(2200);
  await page.screenshot({ path: `${dir}/dropdown-mobile-390.png` });
  await expectClean(page, errors);
});

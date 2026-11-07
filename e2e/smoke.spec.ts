import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { CSP } from "../config/security-headers.mjs";
import { siteRoutes } from "../config/site-structure.mjs";
import { expectClean, trackPageErrors } from "./helpers";

// Every page the site serves: the imported ones minus removed, plus the composed ones.
const { routes } = siteRoutes(JSON.parse(fs.readFileSync(path.join(__dirname, "..", "content", "routes.json"), "utf8")));

// Scroll the whole page so lazy images, scroll animations and their handlers run too.
async function scrollThrough(page: Page) {
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 600) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
  });
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => undefined);
}

for (const { path: route } of routes) {
  test(`${route} loads cleanly`, async ({ page }) => {
    const errors = trackPageErrors(page);
    const response = await page.goto(route);
    expect(response?.status()).toBe(200);
    // A reused server on this port without SECURITY_HEADERS=1 would make every CSP check meaningless.
    expect(response?.headers()["content-security-policy"], "served with the enforced CSP").toBe(CSP);
    await scrollThrough(page);
    await expectClean(page, errors);
  });
}

// The 404 page has the site's menus too, so it runs the menu script (lib/client/menu.ts).
test("the 404 page loads cleanly", async ({ page }) => {
  const errors = trackPageErrors(page);
  const response = await page.goto("/no-such-page/");
  expect(response?.status()).toBe(404);
  expect(response?.headers()["content-security-policy"], "served with the enforced CSP").toBe(CSP);
  await scrollThrough(page);
  await expectClean(page, errors);
});

// Pages composed in code (lib/pages/compose.ts) share a link with their own hero image, like the imported pages do.
const COMPOSED_HEROES: Record<string, string> = {
  "/classes/": "/wp-content/uploads/2023/06/resources.png",
  "/articles/": "/wp-content/uploads/2023/06/resources.png",
  "/events/": "/wp-content/uploads/2023/06/eagle-in-the-sky.png",
  "/gallery/": "/wp-content/uploads/2023/06/hero2.png",
  "/privacy/": "/wp-content/uploads/2023/06/clouds-in-the-sky-1.png"
};
for (const [route, hero] of Object.entries(COMPOSED_HEROES)) {
  test(`${route} has og:image (its hero) and a large-image Twitter card`, async ({ page, request }) => {
    const errors = trackPageErrors(page);
    await page.goto(route);
    const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
    const site = new URL(canonical!).origin;
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", `${site}${hero}`);
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute("content", "summary_large_image");
    // The page's own hero, and a real image file on the site.
    await expect(page.locator(".hero img.wp-block-cover__image-background")).toHaveAttribute("src", hero);
    const image = await request.get(hero);
    expect(image.status()).toBe(200);
    expect(image.headers()["content-type"]).toMatch(/^image\//);
    await expectClean(page, errors);
  });
}

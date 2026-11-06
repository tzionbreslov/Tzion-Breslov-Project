import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { CSP } from "../config/security-headers.mjs";
import { expectClean, trackPageErrors } from "./helpers";

// Task 2 switches this to siteRoutes(index).routes from config/site-structure.mjs.
const { routes } = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "content", "routes.json"), "utf8")) as {
  routes: { path: string }[];
};

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

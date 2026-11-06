import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { expectClean, trackPageErrors } from "./helpers";

// The 18 Parasha titles exactly as the Resources page's "Articles" tab lists
// them (the uagb-block-1908e9b6 grid; the page also holds the bite-size grid).
const ARTICLES_GRID = "uagb-block-1908e9b6";
function resourcesArticleTitles(key: string): string[] {
  const { main } = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "content", "pages", `${key}.json`), "utf8")) as { main: string };
  const start = main.indexOf(ARTICLES_GRID);
  const grid = main.slice(start, main.indexOf("uagb-block-", start + ARTICLES_GRID.length));
  return [...grid.matchAll(/class="uagb-post__title[^"]*">\s*<a [^>]*>([^<]*)<\/a>/g)].map((m) => m[1]);
}
const PAGE_1 = resourcesArticleTitles("resources");
const PAGE_2 = resourcesArticleTitles("resources__page__2");

// textContent, not innerText/toHaveText: those collapse the two spaces in "Mikeitz  |".
const titles = (page: Page) =>
  page.locator("[data-tz-post-grid] .uagb-post__title a").evaluateAll((links) => links.map((link) => link.textContent ?? ""));
const pagination = (page: Page, name: string) =>
  page.locator("[data-tz-post-grid] .uagb-post-pagination-wrap").getByRole("link", { name, exact: true });
// Clicks a pagination link and waits for the page it fetches (it can take seconds on a busy machine).
async function paginate(page: Page, name: string, fetches: string) {
  const fetched = page.waitForResponse((response) => new URL(response.url()).pathname === fetches);
  await pagination(page, name).click();
  await fetched;
}

test("/articles/ opens with the Resources header, then the Articles heading and the first nine articles", async ({ page }) => {
  const errors = trackPageErrors(page);
  const response = await page.goto("/articles/");
  expect(response?.status()).toBe(200);

  const heroHeading = page.locator(".hero h2", { hasText: "More purpose, passion and positivity" });
  const heroText = page.locator(".hero p", { hasText: "Resources for those seeking spiritual growth." });
  const heading = page.locator("h1");
  await expect(heroHeading).toBeVisible();
  await expect(heroText).toBeVisible();
  await expect(heading).toHaveCount(1);
  expect(await heading.textContent()).toBe("Articles");
  const heroBottom = (await heroText.boundingBox())!;
  const headingTop = (await heading.boundingBox())!;
  expect(headingTop.y).toBeGreaterThan(heroBottom.y + heroBottom.height);

  await expect(page.locator(".uagb-post__inner-wrap")).toHaveCount(9);
  expect((await titles(page))[0]).toBe("Parashas Tetzaveh | Feb 12th 2022");
  await expectClean(page, errors);
});

test("pagination swaps the articles in place, and the 18 titles are the Resources articles in order", async ({ page }) => {
  expect(PAGE_1).toHaveLength(9);
  expect(PAGE_2).toHaveLength(9);
  const errors = trackPageErrors(page);
  await page.goto("/articles/");
  const first = await titles(page);

  // Click only once the post-grid island is live; before that the link would navigate.
  await expect(page.locator("[data-tz-post-grid]")).toHaveAttribute("data-tz-post-grid", "ready");
  await paginate(page, "2", "/articles/page/2/");
  await expect.poll(() => titles(page)).toEqual(PAGE_2);
  expect(new URL(page.url()).pathname).toBe("/articles/");
  const second = await titles(page);
  expect(second).toContain("Parashas Vayigash | Dec10th-11th 2021");
  expect(second).toContain("Parashas Mikeitz  | Dec 3rd-4th 2021");
  expect([...first, ...second]).toEqual([...PAGE_1, ...PAGE_2]);

  await paginate(page, "« Previous", "/articles/");
  await expect.poll(() => titles(page)).toEqual(PAGE_1);
  expect(new URL(page.url()).pathname).toBe("/articles/");
  await expectClean(page, errors);
});

test("/articles/page/2/ lists the second nine articles", async ({ page }) => {
  const errors = trackPageErrors(page);
  const response = await page.goto("/articles/page/2/");
  expect(response?.status()).toBe(200);
  expect(await titles(page)).toEqual(PAGE_2);
  await expect(pagination(page, "« Previous")).toHaveAttribute("href", "/articles/");
  await expectClean(page, errors);
});

test("/articles/ ends with the Resources page's closing sections", async ({ page }) => {
  const errors = trackPageErrors(page);
  await page.goto("/articles/");
  await expect(page.getByText("Live Speaking Engagements:")).toBeVisible();
  await expect(page.getByRole("link", { name: "Yes, I would like to donate" })).toHaveAttribute("href", "/donate/");
  await expectClean(page, errors);
});

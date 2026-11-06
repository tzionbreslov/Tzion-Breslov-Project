import { expect, test } from "@playwright/test";
import { expectClean, trackPageErrors } from "./helpers";

// The Events page (lib/pages/events.ts, lib/events.mjs) as the committed empty
// default builds it: content/events.json is only filled by the deploy's calendar
// sync (scripts/sync-events.mjs), never in git, so CI always sees no events.

test("/events/ opens with its own hero (eagle-in-the-sky.png, \"Upcoming events\"), then says nothing is scheduled", async ({ page }) => {
  const errors = trackPageErrors(page);
  const response = await page.goto("/events/");
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle("Events - Tzion Breslov");
  await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", "Upcoming classes and gatherings with Tzion Breslov.");

  // renderHero: another image (no srcset/sizes left from resources.png), heading swapped, no Resources subtitle.
  const hero = page.locator(".hero");
  await expect(hero).toHaveCount(1);
  const heroImage = hero.locator("img.wp-block-cover__image-background");
  await expect(heroImage).toHaveAttribute("src", "/wp-content/uploads/2023/06/eagle-in-the-sky.png");
  expect(await heroImage.getAttribute("srcset")).toBeNull();
  expect(await heroImage.getAttribute("sizes")).toBeNull();
  await expect(hero.locator("h2 > strong")).toHaveText("Upcoming events");
  await expect(hero.locator("p")).toHaveCount(0);
  await expect(page.getByText("Resources for those seeking spiritual growth.")).toHaveCount(0);

  // The empty state, under the hero: no cards, and a way to hear about the next gathering.
  await expect(page.locator("article.tz-event")).toHaveCount(0);
  const empty = page.locator(".tz-events__empty");
  await expect(empty).toBeVisible();
  await expect(empty.getByRole("heading", { name: "No events are currently scheduled" })).toBeVisible();
  await expect(empty.locator("p")).toHaveText("Contact us to hear about the next gathering.");
  const heroBox = (await hero.boundingBox())!;
  expect((await empty.boundingBox())!.y).toBeGreaterThan(heroBox.y + heroBox.height);

  const contact = empty.getByRole("link", { name: "Contact us", exact: true });
  await expect(contact).toHaveAttribute("href", "/contact/");
  await contact.click();
  await page.waitForURL("**/contact/");
  await expectClean(page, errors);
});

test("Events is in the menus before Gallery and marked current on /events/", async ({ page }) => {
  const errors = trackPageErrors(page);
  await page.goto("/events/");
  const labels = (list: string) => page.locator(`${list} > li`).evaluateAll((nodes) =>
    nodes.map((node) => node.querySelector(":scope > a, :scope > button, :scope > .tz-menu-group-label")?.textContent?.trim()));
  const desktop = ["Home", "About", "Resources", "Events", "Gallery", "Contact"];
  const lists = { "#menu-main-menu-links": desktop, "#menu-mobile-menu": [...desktop, "Donate", "Taste a Class"], "#menu-mobile-menu-1": [...desktop, "Donate", "Taste a Class"] };
  for (const [list, expected] of Object.entries(lists)) {
    expect(await labels(list), list).toEqual(expected);
    const current = page.locator(`${list} [aria-current="page"]`);
    await expect(current).toHaveCount(1);
    await expect(current).toHaveText("Events");
    await expect(current).toHaveAttribute("href", "/events/");
  }
  await expectClean(page, errors);
});

test("/events.json is served and lists the page's events (none in the committed default)", async ({ request }) => {
  const response = await request.get("/events.json");
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/json");
  const body = await response.json();
  expect(body).toEqual({ syncedAt: null, events: [] });
});

import { expect, test, type Page } from "@playwright/test";
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

  // The empty state, under the hero: no cards, and two ways to hear about the next gathering.
  await expect(page.locator("article.tz-event")).toHaveCount(0);
  const empty = page.locator(".tz-events__empty");
  await expect(empty).toBeVisible();
  await expect(empty.getByRole("heading", { name: "No events are currently scheduled" })).toBeVisible();
  await expect(empty.locator("p")).toHaveText("Sign up below to hear about the next gathering, or contact us.");
  const heroBox = (await hero.boundingBox())!;
  expect((await empty.boundingBox())!.y).toBeGreaterThan(heroBox.y + heroBox.height);
  // "Sign up below": the announcements signup comes right after the card.
  const signup = page.getByRole("region", { name: "Get event announcements" });
  await expect(signup).toBeVisible();
  expect((await signup.boundingBox())!.y).toBeGreaterThan((await empty.boundingBox())!.y + (await empty.boundingBox())!.height);

  const contact = empty.getByRole("link", { name: "contact us", exact: true });
  await expect(contact).toHaveAttribute("href", "/contact/");
  await contact.click();
  await page.waitForURL("**/contact/");
  await expectClean(page, errors);
});

// The "Get event announcements" signup (lib/events.mjs, lib/client/announcements.ts).
// The committed build has no forms API (forms stay off on the preview), so it can't send.
test.describe("Get event announcements", () => {
  const signup = (page: Page) => page.getByRole("region", { name: "Get event announcements" });
  const CONSENT = "I agree to the privacy notice and consent to this submission.";

  test("has an email field, the two lists (Event announcements ticked), the consent and Sign up", async ({ page }) => {
    const errors = trackPageErrors(page);
    await page.goto("/events/");
    const form = signup(page);
    await expect(form.getByRole("heading", { name: "Get event announcements" })).toBeVisible();
    await expect(form.getByLabel("Email", { exact: true })).toHaveAttribute("type", "email");
    await expect(form.getByRole("checkbox", { name: "Event announcements" })).toBeChecked();
    await expect(form.getByRole("checkbox", { name: "Newsletter" })).not.toBeChecked();
    await expect(form.getByRole("checkbox", { name: CONSENT })).not.toBeChecked();
    await expect(form.getByRole("button", { name: "Sign up" })).toBeVisible();
    // Not a footer-style Gravity form: forms.ts and the subscription notice leave it alone.
    await expect(form.locator("form[data-tz-form]")).toHaveCount(0);
    await expectClean(page, errors);
  });

  test("needs at least one list ticked", async ({ page }) => {
    const errors = trackPageErrors(page);
    await page.goto("/events/");
    await page.waitForSelector("[data-tz-announcements=ready]");
    const form = signup(page);
    await form.getByLabel("Email", { exact: true }).fill("visitor@example.com");
    await form.getByRole("checkbox", { name: "Event announcements" }).uncheck();
    await form.getByRole("checkbox", { name: CONSENT }).check();
    await form.getByRole("button", { name: "Sign up" }).click();
    const lists = form.getByRole("group", { name: "Email lists" });
    await expect(lists).toHaveAccessibleDescription("Choose at least one list.");
    await expect(form.getByRole("checkbox", { name: "Event announcements" })).toBeFocused();
    await expect(form.getByRole("alert")).toHaveCount(0);

    // Ticking one clears it.
    await form.getByRole("checkbox", { name: "Newsletter" }).check();
    await form.getByRole("button", { name: "Sign up" }).click();
    await expect(lists).not.toHaveAccessibleDescription("Choose at least one list.");
    await expectClean(page, errors);
  });

  test("submitting shows the unavailable message with tzionbreslovproject@gmail.com", async ({ page }) => {
    const errors = trackPageErrors(page);
    await page.goto("/events/");
    await page.waitForSelector("[data-tz-announcements=ready]");
    const form = signup(page);
    await form.getByLabel("Email", { exact: true }).fill("visitor@example.com");
    await form.getByRole("checkbox", { name: CONSENT }).check();
    await form.getByRole("button", { name: "Sign up" }).click();
    const alert = form.getByRole("alert");
    await expect(alert).toHaveText("This form is temporarily unavailable. Please email us at tzionbreslovproject@gmail.com.");
    await expect(alert).toContainText("tzionbreslovproject@gmail.com");
    await expectClean(page, errors);
  });
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

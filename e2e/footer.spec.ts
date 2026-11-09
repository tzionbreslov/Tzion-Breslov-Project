import { expect, test } from "@playwright/test";
import { expectClean, trackPageErrors } from "./helpers";

// The owner's edits of 2026-11-08 (lib/pages/edits.mjs): every footer's last line reads "© 2026 Tzion Breslov",
// with no designer credit or link, and the articles name Tzion Breslov as their author in their page data.

// One page per footer variant (content/fragments), a composed page, an article and the 404 page.
const PAGES = ["/", "/about-us/", "/contact/", "/donate/", "/classes/", "/parshat-noach-october-8-9-2021/", "/no-such-page/"];

for (const route of PAGES) {
  test(`${route}: the footer's last line is "© 2026 Tzion Breslov", with no credit line`, async ({ page }) => {
    const errors = trackPageErrors(page);
    await page.goto(route);
    const footer = page.locator("#genesis-footer-widgets");
    // The same paragraph as before (centred, small, light), now the name alone, spelled right, with no link.
    const credit = footer.locator("p.has-text-align-center.has-14-font-size");
    await expect(credit).toHaveCount(1);
    expect(await credit.textContent()).toBe("© 2026 Tzion Breslov");
    await expect(credit.locator("a")).toHaveCount(0);
    expect(await credit.evaluate((node) => getComputedStyle(node).textAlign)).toBe("center");
    const body = (await page.locator("body").textContent()) ?? "";
    for (const gone of ["Site by", "Esti Wolo", "Beslov"]) expect(body, gone).not.toContain(gone);
    await expect(page.locator('a[href*="estiwolo"]')).toHaveCount(0);
    await expectClean(page, errors);
  });
}

test("an article names Tzion Breslov as its author in its page data", async ({ page }) => {
  const errors = trackPageErrors(page);
  await page.goto("/parshat-noach-october-8-9-2021/");
  await expect(page.locator('meta[name="author"]')).toHaveAttribute("content", "Tzion Breslov");
  await expect(page.locator('meta[name="twitter:label1"]')).toHaveAttribute("content", "Written by");
  await expect(page.locator('meta[name="twitter:data1"]')).toHaveAttribute("content", "Tzion Breslov");
  const jsonLd = (await page.locator('script[type="application/ld+json"]').textContent()) ?? "{}";
  // Her gravatar image is gone from it (WordPress's own CSS still has a .wp-social-link-gravatar rule).
  expect(jsonLd).not.toContain("gravatar");
  const graph = JSON.parse(jsonLd)["@graph"] as
    Array<{ "@type": string; "@id"?: string; name?: string; image?: unknown; author?: { name: string; "@id": string } }>;
  const article = graph.find((node) => node["@type"] === "Article")!;
  const person = graph.find((node) => node["@type"] === "Person")!;
  expect(article.author!.name).toBe("Tzion Breslov");
  expect(person["@id"]).toBe(article.author!["@id"]);
  expect(person.name).toBe("Tzion Breslov");
  expect(person.image).toBeUndefined();
  expect(await page.content()).not.toContain("Esti Wolo");
  await expectClean(page, errors);
});

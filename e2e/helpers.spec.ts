import { expect, test } from "@playwright/test";
import { cspViolations, expectClean, trackPageErrors } from "./helpers";

// The check every spec ends with (expectClean) must catch what it claims to.

test("cspViolations refuses a page that trackPageErrors never saw", async ({ page }) => {
  await page.goto("/privacy/");
  await expect(cspViolations(page)).rejects.toThrow("call trackPageErrors first");
});

test("a real violation of the site's CSP on a tracked page is reported, and fails expectClean", async ({ page }) => {
  const errors = trackPageErrors(page);
  await page.goto("/privacy/");
  // The enforced policy's img-src doesn't allow example.com: Chromium blocks the load and logs it.
  await page.evaluate(() => {
    const image = new Image();
    image.src = "https://example.com/not-allowed.png";
    document.body.append(image);
  });
  await expect.poll(() => cspViolations(page)).toEqual([
    expect.stringMatching(/^Loading the image 'https:\/\/example\.com\/not-allowed\.png' violates the following Content Security Policy directive: "img-src /)
  ]);
  await expect(expectClean(page, errors)).rejects.toThrow(/cspViolations/);
});

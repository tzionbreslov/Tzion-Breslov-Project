import { expect, test } from "@playwright/test";
import { cspViolations, expectClean, scrollIntoViewAndSettle, trackPageErrors } from "./helpers";

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

// The settle step before the Classes and RSVP clicks must say what went wrong, not run into the test timeout.
test("scrollIntoViewAndSettle waits for a still box, and gives up on one that keeps moving", async ({ page }) => {
  const errors = trackPageErrors(page);
  await page.setContent('<div style="height: 3000px"></div><div id="target" style="width: 40px; height: 40px">x</div><div style="height: 3000px"></div>');
  const target = page.locator("#target");
  await scrollIntoViewAndSettle(target);
  // A new place every other frame: still enough for Playwright's own stable check (two frames
  // alike) inside scrollIntoViewIfNeeded, never for the three frames the settle step waits for.
  await page.evaluate(() => {
    const node = document.getElementById("target")!;
    let frame = 0;
    const step = () => {
      frame++;
      node.style.marginLeft = `${Math.floor(frame / 2) % 100}px`;
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
  await expect(scrollIntoViewAndSettle(target)).rejects.toThrow("scrollIntoViewAndSettle: target kept moving");
  await expectClean(page, errors);
});

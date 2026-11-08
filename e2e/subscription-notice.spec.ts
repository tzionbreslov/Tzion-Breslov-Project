import { expect, test } from "@playwright/test";
import { expectClean, expectGapFallbackLayout, trackPageErrors } from "./helpers";

// The mailing-list notices at the foot of the screen: "You've joined…" once a confirmation link was already used
// (?subscription=confirmed, components/enhancers.tsx), and the confirmation prompt and its outcomes
// (?subscription=confirm|invalid|error, lib/client/subscription-confirm.ts). Both are styled in app/enhancements.css.

// Safari before 14.1 has no flex gap: app/enhancements.css then spaces each notice's text, buttons and dismiss button
// with margins (the prompt's text and buttons wrap: half the gap round each, the row pulled out by as much), under
// @supports not (inset: 0), which those browsers also lack. This browser has both, so the fallback's rules are applied
// here unconditionally and must lay the notices out exactly as the gaps do (e2e/helpers.ts).
test("without flex gap, margins space the notices exactly as the gaps do", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "sets its own viewport sizes");
  test.slow();
  const errors = trackPageErrors(page);
  const widths = [320, 390, 600, 601, 768, 1440];

  await page.goto("/?subscription=confirmed");
  await expect(page.locator(".tz-notice")).toBeVisible();
  await expectGapFallbackLayout(page, {
    containers: [".tz-notice"],
    targets: { contents: [".tz-notice"] },
    widths
  });

  // An invalid link: its message and "Sign up again" (the confirm button stays hidden), then the dismiss button.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?subscription=invalid");
  await expect(page.getByRole("button", { name: "Sign up again", exact: true })).toBeVisible();
  await expectGapFallbackLayout(page, {
    containers: [".tz-notice--subscription", ".tz-notice__body"],
    // The body's own box is where its margins go: its text and buttons, and the notice round it, are compared.
    targets: { contents: [".tz-notice__body > *", ".tz-notice--subscription > button"], boxes: [".tz-notice--subscription"] },
    widths
  });
  await expectClean(page, errors);
});

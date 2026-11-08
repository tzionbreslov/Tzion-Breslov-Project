import { expect, test, type Page } from "@playwright/test";
import { expectClean, expectGapFallbackLayout, trackPageErrors } from "./helpers";

// The Donate form (components/donate-form.tsx, a client island) and its
// "Manage your monthly donation" link to PayPal's automatic payments page, for
// donors already giving monthly. Its two lines come from content/copy/en.json
// (`donate`); the rest of the form keeps its original wording. That wording is
// rendered in the browser only, so check:wording never sees it: this spec is
// what guards it.
const AUTOPAY = "https://www.paypal.com/myaccount/autopay/";
const MANAGE = "Manage your monthly donation";
const NOTE = "Already giving monthly through PayPal? Change or cancel it in your PayPal account.";

const PRICES = ["$100", "$150", "$300", "$600", "Other amount"];
const TIERS = [
  "Sponsor a Live Lesson",
  "Sponsor a Week of Short, Inspirational Clips",
  "Sponsor Two Weeks of Short, Inspirational Clips",
  "Sponsor a Full Month of Short, Inspirational Clips"
];
const LEGENDS = ["Choose a donation amount", "How often would you like to donate?"];
const LABELS = ["Dedication / In Honor Of / Other Note", "Name", "Email"];

const DARK_BLUE = "rgb(30, 97, 161)";
const TURQUOISE = "rgb(112, 185, 188)";

const form = (page: Page) => page.locator("form.tz-donate__form");
const manage = (page: Page) => form(page).getByRole("link", { name: MANAGE, exact: true });
const frequency = (page: Page) => form(page).locator("fieldset.tz-donate__group:has(.tz-donate__frequency)");
const radio = (page: Page, name: "Monthly" | "One time") => frequency(page).getByRole("radio", { name, exact: true });

/** /donate/, once the form island has mounted (it only exists in the browser). */
async function openDonate(page: Page) {
  const response = await page.goto("/donate/");
  expect(response?.status()).toBe(200);
  await expect(form(page)).toBeVisible();
}

test("/donate/: \"Manage your monthly donation\" opens PayPal's automatic payments in a new tab; the form's own labels are unchanged", async ({ page }) => {
  const errors = trackPageErrors(page);
  await openDonate(page);

  // The form says what it said before.
  await expect(form(page).locator(".tz-donate__price")).toHaveText(PRICES);
  await expect(form(page).locator(".tz-donate__desc")).toHaveText(TIERS);
  await expect(form(page).locator("legend")).toHaveText(LEGENDS);
  await expect(frequency(page).locator(".tz-donate__freq")).toHaveText(["Monthly", "One time"]);
  await expect(form(page).locator("label.gfield_label")).toHaveText(LABELS);
  await expect(form(page).locator("button[type=submit]")).toHaveText("Donate $150");

  // The link and its note.
  await expect(form(page).locator("a.tz-donate__manage")).toHaveCount(1);
  await expect(manage(page)).toHaveClass("tz-donate__manage");
  await expect(manage(page)).toHaveAttribute("href", AUTOPAY);
  await expect(manage(page)).toHaveAttribute("target", "_blank");
  await expect(manage(page)).toHaveAttribute("rel", "noopener noreferrer");
  const note = form(page).locator("p.tz-donate__manage-note");
  await expect(note).toHaveText(NOTE);
  // The note is the link's description, so it is read with the link when the link gets focus.
  await expect(manage(page)).toHaveAccessibleDescription(NOTE);

  // Directly under the frequency fieldset, outside it (not one of its radio options), with
  // its note after it, before the Dedication field.
  const placement = await frequency(page).evaluate((fieldset) => {
    const block = fieldset.nextElementSibling!;
    const link = fieldset.ownerDocument.querySelector("a.tz-donate__manage")!;
    const note = fieldset.ownerDocument.querySelector("p.tz-donate__manage-note")!;
    const dedication = block.nextElementSibling!;
    return {
      linkFirst: block === link || block.firstElementChild === link,
      noteAfterLink: link.nextElementSibling === note,
      insideFieldset: fieldset.contains(link),
      blockClass: block.className,
      next: dedication.querySelector("label")?.textContent ?? null,
      gapAbove: link.getBoundingClientRect().top - fieldset.querySelector(".tz-donate__frequency")!.getBoundingClientRect().bottom,
      dedicationBelow: dedication.getBoundingClientRect().top - note.getBoundingClientRect().bottom
    };
  });
  expect(placement).toMatchObject({ linkFirst: true, noteAfterLink: true, insideFieldset: false, next: LABELS[0] });
  expect(placement.blockClass).toMatch(/^tz-/);
  expect(placement.gapAbove).toBeGreaterThan(0);
  expect(placement.dedicationBelow).toBeGreaterThan(0);

  // Always there: with "One time" (the default) and with "Monthly".
  await expect(radio(page, "One time")).toBeChecked();
  await expect(manage(page)).toBeVisible();
  await expect(note).toBeVisible();
  // Retried: this check() has failed intermittently (cause not established).
  await expect(async () => {
    await radio(page, "Monthly").check();
  }).toPass({ timeout: 10_000 });
  await expect(manage(page)).toBeVisible();
  await expect(note).toBeVisible();

  // A click opens PayPal in a new tab and leaves the form where it was. (PayPal is answered locally.)
  await page.context().route("https://www.paypal.com/**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><title>PayPal</title><p>PayPal</p>" })
  );
  const [popup] = await Promise.all([page.context().waitForEvent("page"), manage(page).click()]);
  await popup.waitForLoadState();
  expect(popup.url()).toBe(AUTOPAY);
  // noopener: the new tab cannot reach back into the donate page.
  expect(await popup.evaluate(() => window.opener)).toBeNull();
  await popup.close();
  await expect(page).toHaveURL(/\/donate\/$/);
  await expect(radio(page, "Monthly")).toBeChecked();
  await expectClean(page, errors);
});

test("the manage link reads as a Tzion link: 14px Montserrat bold, dark blue and underlined, turquoise on hover, a visible focus ring", async ({ page }) => {
  const errors = trackPageErrors(page);
  await openDonate(page);
  const link = manage(page);

  await expect(link).toHaveCSS("font-size", "14px");
  await expect(link).toHaveCSS("font-weight", "700");
  await expect(link).toHaveCSS("font-family", /Montserrat/);
  await expect(link).toHaveCSS("color", DARK_BLUE);
  await expect(link).toHaveCSS("text-decoration-line", "underline");

  const note = form(page).locator("p.tz-donate__manage-note");
  await expect(note).toHaveCSS("font-family", /Montserrat/);
  await expect(note).toHaveCSS("font-size", "14px");
  await expect(note).toHaveCSS("text-decoration-line", "none");

  if (!test.info().project.use.isMobile) {
    // Hover again if the theme's scroll handling moved the page from under the pointer.
    await expect(async () => {
      await link.hover();
      await expect(link).toHaveCSS("color", TURQUOISE, { timeout: 1000 });
    }).toPass({ timeout: 10_000 });
    await expect(link).toHaveCSS("text-decoration-line", "underline");
    await page.mouse.move(0, 0);
    await expect(link).toHaveCSS("color", DARK_BLUE);
  }

  // Keyboard focus (the theme's a:focus would otherwise make it black and plain).
  await radio(page, "One time").focus();
  await page.keyboard.press("Tab");
  await expect(link).toBeFocused();
  await expect(link).toHaveCSS("outline-style", "solid");
  await expect(link).toHaveCSS("outline-width", "3px");
  await expect(link).toHaveCSS("outline-color", DARK_BLUE);
  await expect(link).toHaveCSS("color", DARK_BLUE);
  await expect(link).toHaveCSS("text-decoration-line", "underline");
  await expectClean(page, errors);
});

test("keyboard: the arrow keys stay inside the frequency choice; Tab goes frequency → manage link → Dedication, and back", async ({ page }) => {
  const errors = trackPageErrors(page);
  await openDonate(page);
  const oneTime = radio(page, "One time");
  const monthly = radio(page, "Monthly");
  const dedication = form(page).getByLabel(LABELS[0], { exact: true });

  // The arrow keys move between Monthly and One time (and wrap), never onto the link.
  await oneTime.focus();
  for (const [key, checked] of [["ArrowLeft", monthly], ["ArrowRight", oneTime], ["ArrowDown", monthly], ["ArrowDown", oneTime], ["ArrowUp", monthly]] as const) {
    await page.keyboard.press(key);
    await expect(checked).toBeFocused();
    await expect(checked).toBeChecked();
  }
  await expect(manage(page)).not.toBeFocused();

  // One tab stop for the frequency, then the link, then the rest of the form.
  await page.keyboard.press("Tab");
  await expect(manage(page)).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dedication).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(manage(page)).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(monthly).toBeFocused();
  // And the frequency still comes right after the amount.
  await page.keyboard.press("Shift+Tab");
  await expect(form(page).getByRole("radio", { name: /\$150/ })).toBeFocused();
  await expectClean(page, errors);
});

// Safari before 14.1 has no flex gap: app/enhancements.css then spaces each frequency's radio from its label, and the
// "Other amount" field from its "$", with margins (@supports not (inset: 0), which those browsers also lack). This
// browser has both, so the fallback's rules are applied here unconditionally and must lay the form out exactly as
// the gaps do (e2e/helpers.ts).
test("without flex gap, margins space the frequency choices and the other amount exactly as the gaps do", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "sets its own viewport sizes");
  const errors = trackPageErrors(page);
  await openDonate(page);
  // "Other amount" shows its field.
  await form(page).getByRole("radio", { name: "Other amount" }).check();
  await expect(form(page).locator(".tz-donate__custom")).toBeVisible();
  await expectGapFallbackLayout(page, {
    containers: [".tz-donate__freq", ".tz-donate__custom"],
    targets: { contents: [".tz-donate__freq", ".tz-donate__custom"], boxes: [".tz-donate__tier--other", ".tz-donate__frequency", "form.tz-donate__form"] },
    widths: [320, 390, 600, 601, 768, 1024, 1440]
  });
  await expectClean(page, errors);
});

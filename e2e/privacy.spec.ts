import fs from "node:fs";
import path from "node:path";
import { load } from "cheerio";
import { expect, test } from "@playwright/test";
import { siteRoutes } from "../config/site-structure.mjs";
import { expectClean, trackPageErrors } from "./helpers";

// The privacy notice (lib/pages/privacy.ts, its text in content/copy/en.json
// `privacy`), linked from the end of every page's footer Quick Links and from
// the consent lines of the "Get event announcements" signup (lib/events.mjs)
// and the RSVP form (lib/client/rsvp.ts, tested in e2e/rsvp.spec.ts).

const HEADINGS = ["What you send us", "How we use it", "Where it goes", "How long we keep it", "Cookies and tracking", "Your choices"];
const CONSENT = "I agree to the privacy notice and consent to this submission.";

test("/privacy/ opens with its own hero (clouds-in-the-sky-1.png, \"Privacy notice\"), the date, then the six sections in order", async ({ page }) => {
  const errors = trackPageErrors(page);
  const response = await page.goto("/privacy/");
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle("Privacy notice - Tzion Breslov");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/privacy\/$/);

  // renderHero: another image (no srcset/sizes left from resources.png), heading swapped, no Resources subtitle.
  const hero = page.locator(".hero");
  await expect(hero).toHaveCount(1);
  const heroImage = hero.locator("img.wp-block-cover__image-background");
  await expect(heroImage).toHaveAttribute("src", "/wp-content/uploads/2023/06/clouds-in-the-sky-1.png");
  expect(await heroImage.getAttribute("srcset")).toBeNull();
  expect(await heroImage.getAttribute("sizes")).toBeNull();
  // The hero's heading is the page's main heading: its only h1 (the notice's sections are h2s).
  await expect(hero.locator("h1 > strong")).toHaveText("Privacy notice");
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(hero.locator("p")).toHaveCount(0);

  // A fixed date (Ruling R38), never the build date.
  const legal = page.locator(".tz-legal");
  await expect(legal).toHaveCount(1);
  await expect(legal.locator(".tz-legal__updated")).toHaveText("Last updated November 9, 2026");
  await expect(legal.locator(".tz-legal__intro")).not.toBeEmpty();
  const heroBox = (await hero.boundingBox())!;
  expect((await legal.boundingBox())!.y).toBeGreaterThan(heroBox.y + heroBox.height);

  // The six sections, each a heading over its paragraphs; nothing else is a heading here, and the
  // sections are plain ones (the headings structure the page), not six region landmarks.
  await expect(legal.getByRole("heading", { level: 2 })).toHaveText(HEADINGS);
  await expect(legal.getByRole("heading")).toHaveCount(HEADINGS.length);
  await expect(legal.getByRole("region")).toHaveCount(0);
  const sections = legal.locator("section.tz-legal__section");
  await expect(sections).toHaveCount(HEADINGS.length);
  for (const [i, heading] of HEADINGS.entries()) {
    const section = sections.nth(i);
    await expect(section.locator(":scope > h2:first-child")).toHaveText(heading);
    expect(await section.locator("p").count(), heading).toBeGreaterThan(0);
  }
  // The RSVP retention the forms Worker enforces (worker/src/database.ts cleanExpiredData, owner decision 2026-11-07):
  // "normally", because a day the site's events list can't be read deletes only RSVPs whose event ended more than 7 days
  // before (Ruling R44 keeps a moved event's RSVPs; the 7 days bound how long the feed being down can keep one).
  const keep = sections.nth(HEADINGS.indexOf("How long we keep it"));
  await expect(keep.locator("p").filter({ hasText: /^RSVPs / })).toHaveText(
    "RSVPs are kept by the forms service until its daily clean-up after the event ends, normally within a day, then deleted. Each RSVP is also emailed to our inbox."
  );
  // Requests go to the inbox the site already names (Contact page, form messages), shown covered as everywhere else
  // (lib/contact-details.mjs): no address or mailto link in the page; "Show email" reveals it once the forms are on.
  const choices = sections.last();
  await expect(choices.locator("p").last()).toHaveText("To see, correct or delete the information you have sent us, write to tzion••••••@gmail.com.");
  await expect(choices.locator('[data-tz-contact="email"] .tz-contact__value')).toHaveText("tzion••••••@gmail.com");
  await expect(page.locator('.tz-legal a[href^="mailto:"]')).toHaveCount(0);
  expect(await legal.innerHTML()).not.toContain("tzionbreslovproject");

  // No closing sections: the notice ends the page.
  await expect(page.getByText("Live Speaking Engagements")).toHaveCount(0);
  await expectClean(page, errors);
});

// The owner-approved edits for the covered contact details (2026-11-09: docs/superpowers/specs/2026-11-08-hidden-contact-details-design.md,
// "Privacy notice edits" 1-5), each as the whole paragraph it is in. Every claim holds for the code as built: the
// reveal (POST /v1/contact-details) sends the IP address to the forms service and Turnstile, keeps only the
// short-lived hashed IP rate-limit record (no request log), and the browser keeps the details in sessionStorage.
const CONTACT_DETAILS_EDITS = {
  "What you send us": "Our forms service also receives your IP address with every form you send, when you open the link in a " +
    "confirmation email and confirm your sign-up, and when you open the Events page while it lists events, because your " +
    "browser then asks it which events are full, and when you tap “Show” next to our phone number or email address.",
  "How we use it": "We also use it to protect the forms, and our phone number and email address, from spam and abuse. " +
    "Cloudflare Turnstile checks that a person, not a program, is sending a form or asking to see them, and our forms " +
    "service passes your IP address to it for that check. To limit repeated submissions and requests, the forms service " +
    "keeps short-lived records of your IP address (and, for forms, your email address) in scrambled (salted and hashed) form.",
  "Where it goes": "Our forms service also runs on Cloudflare: it receives what you send through the forms, keeps the records " +
    "described below in Cloudflare’s database, and tells the Events page which events are full. Cloudflare Turnstile, which " +
    "protects the forms and our contact details, loads on every page, because every page has the newsletter sign-up and our " +
    "contact details in its footer. It receives your IP address and information about your browser and device, to tell " +
    "people from programs.",
  "How long we keep it": "Security records: a log of contact and sign-up requests (a reference number and whether it went " +
    "through, not what you wrote) is kept for 30 days; the reports Resend sends us about email delivery and subscriptions " +
    "(for example a bounce, a complaint or a change to your lists), which include the email address concerned and, for an " +
    "email, its subject (for a contact message, the sender’s name, or their email address if they gave no name), for 90 " +
    "days; the scrambled records that limit repeated submissions and requests to see our contact details until the next " +
    "daily clean-up, at most about a day; and error records from the forms service, designed to contain no personal " +
    "details, for up to 7 days.",
  "Cookies and tracking": "When you tap “Show” next to our phone number or email address, your browser keeps them for that " +
    "tab until you close it, so the next pages you open show them too."
};

test("the notice says what the contact details' \"Show\" does, in the owner-approved words", async ({ page }) => {
  const errors = trackPageErrors(page);
  await page.goto("/privacy/");
  const sections = page.locator(".tz-legal section.tz-legal__section");
  for (const [heading, text] of Object.entries(CONTACT_DETAILS_EDITS)) {
    const section = sections.filter({ has: page.getByRole("heading", { name: heading, exact: true }) });
    await expect(section.locator("p").filter({ hasText: text }), heading).toHaveCount(1);
    await expect(section.locator("p").filter({ hasText: text }), heading).toHaveText(text);
  }
  // The new sentence is its own paragraph, right after the one about services that store information in the browser.
  const cookies = sections.filter({ has: page.getByRole("heading", { name: "Cookies and tracking", exact: true }) }).locator("p");
  await expect(cookies).toHaveCount(3);
  await expect(cookies.nth(1)).toHaveText(/^The services that load inside some of its pages/);
  await expect(cookies.nth(2)).toHaveText(CONTACT_DETAILS_EDITS["Cookies and tracking"]);
  await expectClean(page, errors);
});

test("the notice reads as Tzion's legal layout: 760px wide, Newsreader dark-blue headings, 18px Montserrat text, a light-blue rule between sections", async ({ page }) => {
  const errors = trackPageErrors(page);
  await page.goto("/privacy/");
  const legal = page.locator(".tz-legal__body");
  const layout = await legal.evaluate((node) => {
    const style = (el: Element) => getComputedStyle(el);
    const sections = [...node.querySelectorAll("section.tz-legal__section")];
    const heading = node.querySelector("section h2")!;
    const text = node.querySelector("section p")!;
    return {
      width: node.getBoundingClientRect().width,
      left: node.getBoundingClientRect().left,
      right: node.getBoundingClientRect().right,
      column: node.parentElement!.getBoundingClientRect().width,
      viewport: document.documentElement.clientWidth,
      scrollsSideways: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      headingFont: style(heading).fontFamily,
      headingColor: style(heading).color,
      textFont: style(text).fontFamily,
      textSize: style(text).fontSize,
      rules: sections.map((section) => [style(section).borderTopStyle, style(section).borderTopColor]),
      ruleWidths: sections.map((section) => parseFloat(style(section).borderTopWidth))
    };
  });
  // 760px on a wide screen, centred; on a phone the page's own column, at least 16px from each edge.
  expect(layout.width).toBe(Math.min(760, layout.column));
  expect(layout.left).toBeGreaterThanOrEqual(16);
  expect(layout.viewport - layout.right).toBeGreaterThanOrEqual(16);
  expect(Math.abs(layout.left - (layout.viewport - layout.right))).toBeLessThanOrEqual(1);
  expect(layout.scrollsSideways).toBe(false);
  expect(layout.headingFont).toMatch(/^"?Newsreader"?/);
  expect(layout.headingColor).toBe("rgb(30, 97, 161)");
  expect(layout.textFont).toMatch(/^"?Montserrat"?/);
  expect(layout.textSize).toBe("18px");
  // The first section starts under the intro without a rule; every later one has the light-blue rule.
  expect(layout.rules[0][0]).toBe("none");
  for (const [style, color] of layout.rules.slice(1)) expect([style, color]).toEqual(["solid", "rgba(30, 97, 161, 0.2)"]);
  for (const width of layout.ruleWidths.slice(1)) expect(width).toBeGreaterThan(0);
  await expectClean(page, errors);
});

test.describe("links to the notice", () => {
  test.skip(({ isMobile }) => isMobile, "reads the built files and the menus' markup: one project is enough");

  // Every page the site serves (as built in out/), and the 404 page.
  test("every page's footer Quick Links end with Privacy → /privacy/, current only on /privacy/; the header menus have no Privacy", () => {
    const out = path.join(__dirname, "..", "out");
    const { routes } = siteRoutes(JSON.parse(fs.readFileSync(path.join(__dirname, "..", "content", "routes.json"), "utf8")));
    const files = [...routes.map((route) => ({ route: route.path, file: path.join(out, route.path, "index.html") })), { route: "", file: path.join(out, "404.html") }];
    expect(files.map((f) => f.route)).toContain("/privacy/");
    for (const { route, file } of files) {
      const $ = load(fs.readFileSync(file, "utf8"));
      const items = $("#menu-mobile-menu-1 > li");
      expect(items.length, route).toBeGreaterThan(1);
      const last = items.last().children("a");
      expect(last.text(), route).toBe("Privacy");
      expect(last.attr("href"), route).toBe("/privacy/");
      expect(last.attr("aria-current"), route).toBe(route === "/privacy/" ? "page" : undefined);
      expect($("#menu-mobile-menu-1 a").filter((_, a) => $(a).text() === "Privacy").length, route).toBe(1);
      expect($("#menu-main-menu-links a, #menu-mobile-menu a, #menu-main-menu-buttons a").filter((_, a) => $(a).text().trim() === "Privacy").length, route).toBe(0);
    }
  });
});

test("the \"Get event announcements\" consent line links \"privacy notice\" to /privacy/ and still reads as it did", async ({ page }) => {
  const errors = trackPageErrors(page);
  await page.goto("/events/");
  const signup = page.getByRole("region", { name: "Get event announcements" });
  const consent = signup.getByRole("checkbox", { name: CONSENT });
  await expect(consent).not.toBeChecked();
  const label = signup.locator("label.tz-consent");
  await expect(label).toHaveText(CONSENT);
  const link = label.getByRole("link", { name: "privacy notice", exact: true });
  await expect(link).toHaveAttribute("href", "/privacy/");
  await link.click();
  await page.waitForURL("**/privacy/");
  await expect(page.locator(".tz-legal")).toHaveCount(1);
  await expectClean(page, errors);
});

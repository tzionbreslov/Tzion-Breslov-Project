import { expect, test, type Page, type Route } from "@playwright/test";
import { FIXTURE_IDS } from "../scripts/fixtures/write-events-fixture.mjs";
import { expectClean, scrollIntoViewAndSettle, trackPageErrors } from "./helpers";

// RSVPs on the Events page (lib/events.mjs, lib/client/rsvp.ts) against the
// fixture build (scripts/fixtures/write-events-fixture.mjs: an event that
// started an hour ago, one tomorrow, one with "No RSVP", one with a limit), in
// two builds:
// - TZ_E2E_EVENTS=1: built with NEXT_PUBLIC_API_BASE_URL=https://api.tzionbreslov.org
//   and Turnstile's always-pass test key. Turnstile and the forms API are stubbed
//   here, so nothing leaves the machine; the enforced CSP still checks both
//   origins before a stub answers.
// - TZ_E2E_EVENTS=preview: built without them, as the github.io preview is.
// The "Get event announcements" signup's live path (lib/client/announcements.ts) is tested
// here too, on the first build, and so is what both show before their island is ready
// and without JavaScript (Ruling R13).

const API = "https://api.tzionbreslov.org";
const TEXT = {
  success: "Thank you — your RSVP is in. A confirmation is on its way to your inbox.",
  full: "Sorry — this event is now full.",
  closed: "RSVPs for this event have closed.",
  error: "Something went wrong sending your RSVP. Please try again.",
  consent: "I agree to the privacy notice and consent to this submission.",
  unavailable: "RSVPs open when the new site launches. Until then, email us at tzionbreslovproject@gmail.com.",
  placesLeft: (n: number) => n === 1
    ? "Sorry — only 1 place is left. Lower the number of guests, or email us at tzionbreslovproject@gmail.com."
    : `Sorry — only ${n} places are left. Lower the number of guests, or email us at tzionbreslovproject@gmail.com.`,
  rsvpByEmail: "To RSVP, email us at tzionbreslovproject@gmail.com.",
  announcementsByEmail: "To get event announcements, email us at tzionbreslovproject@gmail.com.",
  signedUp: "Almost there! Please check your inbox and click the link to confirm your subscription."
};
const EMAIL_LINK = "mailto:tzionbreslovproject@gmail.com";

const card = (page: Page, id: string) => page.locator(`article.tz-event[data-event-id="${id}"]`);
const rsvpButton = (page: Page, id: string) => card(page, id).getByRole("button", { name: "RSVP", exact: true });
const dialog = (page: Page) => page.getByRole("dialog");

/** A minimal Turnstile: renders nothing and hands out a token at once. */
const TURNSTILE = "window.turnstile = { render: function () { return 'stub-widget'; }, getResponse: function () { return 'test-token'; }, reset: function () {}, remove: function () {} };";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };

type Availability = Record<string, { full: boolean; remaining: number | null }>;

/** Stubs Turnstile and GET /v1/rsvp/availability; returns the POST bodies sent to /v1/rsvp. */
async function stubServices(page: Page, availability: Availability = {}, answer: (route: Route) => Promise<void> = (route) => route.abort("failed")) {
  const posts: Array<Record<string, unknown>> = [];
  await page.route("https://challenges.cloudflare.com/**", (route) => route.fulfill({ contentType: "application/javascript", body: TURNSTILE }));
  await page.route(`${API}/v1/rsvp/availability`, (route) =>
    route.fulfill({ status: 200, contentType: "application/json", headers: cors, body: JSON.stringify({ ok: true, events: availability }) }));
  await page.route(`${API}/v1/rsvp`, async (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    posts.push(route.request().postDataJSON() as Record<string, unknown>);
    return answer(route);
  });
  return posts;
}

const reply = (status: number, body: Record<string, unknown>) => (route: Route) =>
  route.fulfill({ status, contentType: "application/json", headers: cors, body: JSON.stringify(body) });

async function openEvents(page: Page) {
  const response = await page.goto("/events/");
  expect(response?.status()).toBe(200);
  await page.waitForSelector("[data-tz-rsvp=ready]");
}

async function openRsvp(page: Page, id: string = FIXTURE_IDS.open) {
  // On desktop the RSVP buttons start below the fold: bring the button up first, so the theme's
  // header switch can't move it in the middle of the click (scrollIntoViewAndSettle).
  await scrollIntoViewAndSettle(rsvpButton(page, id));
  await rsvpButton(page, id).click();
  await expect(dialog(page)).toBeVisible();
}

async function fillRsvp(page: Page, guests = "3") {
  const box = dialog(page);
  await box.getByLabel("Name", { exact: true }).fill("Ada Lovelace");
  await box.getByLabel("Email", { exact: true }).fill("ada@example.com");
  await box.getByLabel("Number of guests").fill(guests);
  await box.getByLabel("Accessibility or dietary needs (optional)").fill("Step-free access");
  await box.getByLabel(TEXT.consent).check();
  // The Worker refuses a form sent faster than 1.5 s after it opened.
  await page.waitForTimeout(1600);
}

test.describe("with the forms API (TZ_E2E_EVENTS=1)", () => {
  test.skip(process.env.TZ_E2E_EVENTS !== "1", "needs the events fixture build (TZ_E2E_EVENTS=1, see scripts/fixtures/write-events-fixture.mjs)");

  test("RSVP shows on open events only: not on \"No RSVP\", not once started, and \"This event is full\" when full", async ({ page }) => {
    const errors = trackPageErrors(page);
    await stubServices(page, {
      [FIXTURE_IDS.open]: { full: false, remaining: null },
      [FIXTURE_IDS.started]: { full: false, remaining: null },
      [FIXTURE_IDS.limited]: { full: true, remaining: 0 }
    });
    await openEvents(page);

    await expect(page.locator("article.tz-event")).toHaveCount(4);
    await expect(rsvpButton(page, FIXTURE_IDS.open)).toBeVisible();
    await expect(card(page, FIXTURE_IDS.noRsvp).locator("button")).toHaveCount(0);
    await expect(card(page, FIXTURE_IDS.noRsvp)).toHaveAttribute("data-rsvp", "off");
    await expect(card(page, FIXTURE_IDS.started).getByRole("button")).toHaveCount(0);

    const limited = card(page, FIXTURE_IDS.limited);
    await expect(limited).toHaveAttribute("data-limit", "40");
    await expect(limited.locator("p.tz-event__full")).toHaveText("This event is full");
    await expect(limited.locator("button")).toHaveCount(0);
    await expectClean(page, errors);
  });

  test("the RSVP dialog opens on Name with the event's title and time, and Escape gives focus back to the button", async ({ page }) => {
    const errors = trackPageErrors(page);
    await stubServices(page);
    await openEvents(page);
    await openRsvp(page);

    const box = dialog(page);
    await expect(box).toHaveAccessibleName("RSVP: Weekly class");
    await expect(box.getByRole("heading", { name: "RSVP: Weekly class" })).toBeVisible();
    const when = (await card(page, FIXTURE_IDS.open).locator(".tz-event__when").textContent())!.replace(/\s/g, " ");
    await expect(box.locator(".tz-rsvp__when")).toHaveText(when);
    await expect(box.getByLabel("Name", { exact: true })).toBeFocused();
    await expect(box.getByLabel("Email", { exact: true })).toHaveAttribute("type", "email");
    const guests = box.getByLabel("Number of guests");
    await expect(guests).toHaveValue("1");
    await expect(guests).toHaveAttribute("min", "1");
    await expect(guests).toHaveAttribute("max", "12");
    await expect(box.getByLabel("Accessibility or dietary needs (optional)")).toHaveJSProperty("tagName", "TEXTAREA");
    await expect(box.getByLabel(TEXT.consent)).not.toBeChecked();
    await expect(box.getByRole("button", { name: "Send RSVP" })).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(dialog(page)).toHaveCount(0);
    await expect(rsvpButton(page, FIXTURE_IDS.open)).toBeFocused();
    await expectClean(page, errors);
  });

  test("the form asks for a name, a valid email, 1-12 guests and the consent before sending anything", async ({ page }) => {
    const errors = trackPageErrors(page);
    const posts = await stubServices(page);
    await openEvents(page);
    await openRsvp(page);
    const box = dialog(page);
    await box.getByLabel("Number of guests").fill("13");
    await box.getByRole("button", { name: "Send RSVP" }).click();

    const name = box.getByLabel("Name", { exact: true });
    await expect(name).toHaveAttribute("aria-invalid", "true");
    await expect(name).toBeFocused();
    await expect(name).toHaveAccessibleDescription("This field is required.");
    await expect(box.getByLabel("Email", { exact: true })).toHaveAttribute("aria-invalid", "true");
    await expect(box.getByLabel("Number of guests")).toHaveAccessibleDescription("Please enter a number from 1 to 12.");
    await expect(box.getByLabel(TEXT.consent)).toHaveAccessibleDescription("Please tick this box to send your RSVP.");
    expect(posts).toHaveLength(0);
    await expectClean(page, errors);
  });

  test("a 202 shows the thank-you message, after sending the RSVP with its security envelope", async ({ page }) => {
    const errors = trackPageErrors(page);
    const posts = await stubServices(page, {}, reply(202, { ok: true, requestId: "r", confirmationId: "c" }));
    await openEvents(page);
    await openRsvp(page);
    await fillRsvp(page);
    await dialog(page).getByRole("button", { name: "Send RSVP" }).click();

    await expect(dialog(page).getByRole("status")).toHaveText(TEXT.success);
    await expect(dialog(page).locator("form")).toHaveCount(0);
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({
      eventId: FIXTURE_IDS.open,
      name: "Ada Lovelace",
      email: "ada@example.com",
      guests: 3,
      accessibility: "Step-free access",
      consent: "granted",
      website: "",
      "cf-turnstile-response": "test-token",
      requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      startedAt: expect.any(Number),
      submittedAt: expect.any(String)
    });
    await expectClean(page, errors);
  });

  test("a 409 EVENT_FULL says the event is now full, EVENT_CLOSED that RSVPs have closed", async ({ page }) => {
    const errors = trackPageErrors(page);
    let answer = reply(409, { ok: false, error: "EVENT_FULL", correlationId: "x" });
    await stubServices(page, {}, (route) => answer(route));
    await openEvents(page);
    await openRsvp(page);
    await fillRsvp(page);
    await dialog(page).getByRole("button", { name: "Send RSVP" }).click();
    await expect(dialog(page).getByRole("alert")).toHaveText(TEXT.full);

    answer = reply(409, { ok: false, error: "EVENT_CLOSED", correlationId: "x" });
    await dialog(page).getByRole("button", { name: "Send RSVP" }).click();
    await expect(dialog(page).getByRole("alert")).toHaveText(TEXT.closed);
    await expectClean(page, errors);
  });

  test("a 409 EVENT_FULL for more guests than the places left says how many are left, asking availability again", async ({ page }) => {
    const errors = trackPageErrors(page);
    // The count when the page opened (enough for 3), then what the Worker says after the 409.
    const availability: Availability = { [FIXTURE_IDS.limited]: { full: false, remaining: 5 } };
    await stubServices(page, availability, reply(409, { ok: false, error: "EVENT_FULL", correlationId: "x" }));
    let asked = 0;
    page.on("request", (request) => {
      if (request.url() === `${API}/v1/rsvp/availability`) asked++;
    });
    await openEvents(page);
    await expect.poll(() => asked).toBe(1);
    await openRsvp(page, FIXTURE_IDS.limited);
    await fillRsvp(page, "3");
    const send = dialog(page).getByRole("button", { name: "Send RSVP" });
    const alert = dialog(page).getByRole("alert");

    availability[FIXTURE_IDS.limited] = { full: false, remaining: 2 };
    await send.click();
    await expect(alert).toHaveText(TEXT.placesLeft(2));
    await expect(alert).toBeFocused();
    await expect.poll(() => asked).toBe(2);

    availability[FIXTURE_IDS.limited] = { full: false, remaining: 1 };
    await send.click();
    await expect(alert).toHaveText(TEXT.placesLeft(1));

    // None left: the event is now full, as before.
    availability[FIXTURE_IDS.limited] = { full: true, remaining: 0 };
    await send.click();
    await expect(alert).toHaveText(TEXT.full);
    await expect(dialog(page).locator("form")).toHaveCount(1);
    await expectClean(page, errors);
  });

  test("a network error shows the error message and keeps the form for another try", async ({ page }) => {
    const errors = trackPageErrors(page);
    const posts = await stubServices(page, {}, (route) => route.abort("failed"));
    await openEvents(page);
    await openRsvp(page);
    await fillRsvp(page);
    await dialog(page).getByRole("button", { name: "Send RSVP" }).click();
    await expect(dialog(page).getByRole("alert")).toHaveText(TEXT.error);
    await expect(dialog(page).getByRole("button", { name: "Send RSVP" })).toBeEnabled();
    expect(posts).toHaveLength(1);

    // The retry is the same submission: it keeps its requestId (the Worker answers it once).
    await dialog(page).getByRole("button", { name: "Send RSVP" }).click();
    await expect(dialog(page).getByRole("alert")).toHaveText(TEXT.error);
    expect(posts).toHaveLength(2);
    expect(posts[1].requestId).toBe(posts[0].requestId);
    await expectClean(page, errors);
  });

  test("the dialog stays usable on short and narrow screens: it scrolls inside, nothing sticks out", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "sets its own viewport sizes");
    const errors = trackPageErrors(page);
    await stubServices(page, {}, reply(202, { ok: true, requestId: "r", confirmationId: "c" }));
    for (const size of [{ width: 390, height: 844 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(size);
      await openEvents(page);
      await openRsvp(page);
      const geometry = await dialog(page).evaluate((node) => {
        const box = node.getBoundingClientRect();
        const fixed = [...node.querySelectorAll<HTMLElement>("*")]
          .filter((child) => getComputedStyle(child).position === "fixed")
          .map((child) => child.getBoundingClientRect())
          .filter((rect) => rect.left < box.left - 0.5 || rect.top < box.top - 0.5 || rect.right > box.right + 0.5 || rect.bottom > box.bottom + 0.5);
        return {
          inside: box.left >= 0 && box.top >= 0 && box.right <= innerWidth && box.bottom <= innerHeight,
          pageScrollsSideways: document.documentElement.scrollWidth > innerWidth,
          boxScrollsSideways: node.scrollWidth > node.clientWidth,
          fixedOutside: fixed.length
        };
      });
      expect(geometry, `${size.width}x${size.height}`).toEqual({ inside: true, pageScrollsSideways: false, boxScrollsSideways: false, fixedOutside: 0 });
      await fillRsvp(page);
      const send = dialog(page).getByRole("button", { name: "Send RSVP" });
      await send.scrollIntoViewIfNeeded();
      await expect(send).toBeInViewport();
      await send.click();
      await expect(dialog(page).getByRole("status")).toHaveText(TEXT.success);
      await page.keyboard.press("Escape");
      await expect(dialog(page)).toHaveCount(0);
    }
    await expectClean(page, errors);
  });

  test("the consent line links \"privacy notice\" to /privacy/ and still reads as it did", async ({ page }) => {
    const errors = trackPageErrors(page);
    await stubServices(page);
    await openEvents(page);
    await openRsvp(page);
    const box = dialog(page);
    const consent = box.getByLabel(TEXT.consent);
    await expect(consent).not.toBeChecked();
    const label = box.locator("label.tz-consent");
    await expect(label).toHaveText(TEXT.consent);
    const link = label.getByRole("link", { name: "privacy notice", exact: true });
    await expect(link).toHaveAttribute("href", "/privacy/");
    // Inside the dialog's focus order, right after the checkbox.
    await consent.focus();
    await page.keyboard.press("Tab");
    await expect(link).toBeFocused();
    await link.click();
    await page.waitForURL("**/privacy/");
    await expect(page.locator(".tz-legal")).toHaveCount(1);
    await expectClean(page, errors);
  });

  // A calendar title is text: "$&", "$'" or "$$" in it are not replacement patterns.
  test("a calendar title with $&, $' or $$ shows in the dialog's title as written", async ({ page }) => {
    const errors = trackPageErrors(page);
    await stubServices(page);
    await openEvents(page);
    const title = "Kumzits: $& $' $$ night";
    await card(page, FIXTURE_IDS.open).locator(".tz-event__title").evaluate((node, text) => { node.textContent = text; }, title);
    await openRsvp(page);
    await expect(dialog(page)).toHaveAccessibleName(`RSVP: ${title}`);
    await expect(dialog(page).getByRole("heading", { level: 2 })).toHaveText(`RSVP: ${title}`);
    await expectClean(page, errors);
  });
});

test.describe("on the preview, without a forms API (TZ_E2E_EVENTS=preview)", () => {
  test.skip(process.env.TZ_E2E_EVENTS !== "preview", "needs the events fixture built without NEXT_PUBLIC_API_BASE_URL (TZ_E2E_EVENTS=preview)");

  test("RSVP says RSVPs open when the new site launches, and nothing is sent anywhere", async ({ page }) => {
    const errors = trackPageErrors(page);
    const outside: string[] = [];
    page.on("request", (request) => {
      const url = request.url();
      if (url.startsWith(API) || url.startsWith("https://challenges.cloudflare.com")) outside.push(url);
    });
    await openEvents(page);
    await expect(rsvpButton(page, FIXTURE_IDS.open)).toBeVisible();
    // No forms API, no availability check: the limited event keeps its button.
    await expect(rsvpButton(page, FIXTURE_IDS.limited)).toBeVisible();
    await expect(card(page, FIXTURE_IDS.started).getByRole("button")).toHaveCount(0);

    await openRsvp(page);
    await expect(dialog(page).getByLabel("Name", { exact: true })).toBeFocused();
    await expect(dialog(page).locator("label.tz-consent").getByRole("link", { name: "privacy notice", exact: true })).toHaveAttribute("href", "/privacy/");
    await fillRsvp(page);
    await dialog(page).getByRole("button", { name: "Send RSVP" }).click();
    const alert = dialog(page).getByRole("alert");
    await expect(alert).toHaveText(TEXT.unavailable);
    await expect(alert).toBeFocused();
    await expect(dialog(page).locator("form")).toHaveCount(1);
    expect(outside).toEqual([]);
    await expectClean(page, errors);
  });
});

const signup = (page: Page) => page.getByRole("region", { name: "Get event announcements" });

test.describe("Get event announcements with the forms API (TZ_E2E_EVENTS=1)", () => {
  test.skip(process.env.TZ_E2E_EVENTS !== "1", "needs the events fixture build (TZ_E2E_EVENTS=1, see scripts/fixtures/write-events-fixture.mjs)");

  const choices = [
    { lists: ["Event announcements"], topics: ["events"] },
    { lists: ["Event announcements", "Newsletter"], topics: ["events", "newsletter"] }
  ];
  for (const { lists, topics } of choices) {
    test(`ticking ${lists.join(" and ")} sends topics ${JSON.stringify(topics)}, then shows the signup's confirmation`, async ({ page }) => {
      const errors = trackPageErrors(page);
      await stubServices(page);
      const posts: Array<Record<string, unknown>> = [];
      await page.route(`${API}/v1/subscribe`, async (route) => {
        if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
        posts.push(route.request().postDataJSON() as Record<string, unknown>);
        return reply(202, { ok: true, requestId: "r", confirmationRequired: true })(route);
      });
      await page.goto("/events/");
      await page.waitForSelector("[data-tz-announcements=ready]");
      const region = signup(page);
      await region.getByLabel("Email", { exact: true }).fill("ada@example.com");
      // "Event announcements" is ticked from the start.
      await expect(region.getByRole("checkbox", { name: "Event announcements" })).toBeChecked();
      if (lists.includes("Newsletter")) await region.getByRole("checkbox", { name: "Newsletter" }).check();
      await region.getByRole("checkbox", { name: TEXT.consent }).check();
      await region.getByRole("button", { name: "Sign up" }).click();

      const done = region.getByRole("status");
      await expect(done).toHaveText(TEXT.signedUp);
      await expect(done).toBeFocused();
      await expect(region.locator("form")).toHaveCount(0);
      expect(posts).toHaveLength(1);
      expect(posts[0].topics).toEqual(topics);
      expect(posts[0]).toMatchObject({
        email: "ada@example.com",
        website: "",
        "cf-turnstile-response": "test-token",
        requestId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        startedAt: expect.any(Number),
        submittedAt: expect.any(String)
      });
      await expectClean(page, errors);
    });
  }
});

// Ruling R13: no control may look usable but be dead. Before its island is ready an RSVP button
// does nothing and the signup would post to the static host, so both keep their place but stay
// hidden; without JavaScript they give way to a line offering email.
test.describe("before the islands are ready, and without JavaScript", () => {
  test.skip(!process.env.TZ_E2E_EVENTS, "needs an events fixture build (TZ_E2E_EVENTS=1 or preview)");

  test("the RSVP buttons and the signup form stay hidden until their island is ready, without moving anything", async ({ page }) => {
    const errors = trackPageErrors(page);
    if (process.env.TZ_E2E_EVENTS === "1") await stubServices(page);
    const actions = card(page, FIXTURE_IDS.open).locator(".tz-event__actions");
    const form = signup(page).locator("form");
    // The open event's card, its RSVP slot and the signup form, measured from that card's top. (The card above,
    // an event that has started, loses its button once the island runs, by design, and moves everything below.)
    const boxes = () => page.evaluate((id) => {
      const event = `article.tz-event[data-event-id="${id}"]`;
      const top = document.querySelector(event)!.getBoundingClientRect().y;
      const box = (selector: string) => {
        const rect = document.querySelector(selector)!.getBoundingClientRect();
        return { x: rect.x, y: rect.y - top, width: rect.width, height: rect.height };
      };
      return { card: box(event), actions: box(`${event} .tz-event__actions`), form: box(".tz-announce__form").y };
    }, FIXTURE_IDS.open);

    // Next's scripts never arrive (its stylesheet does): the page as it is before the islands start.
    await page.route("**/_next/static/chunks/*.js", (route) => route.abort());
    await page.goto("/events/");
    await expect(actions).toBeHidden();
    await expect(form).toBeHidden();
    await expect(page.getByText(TEXT.rsvpByEmail).first()).toBeHidden();
    await expect(page.getByText(TEXT.announcementsByEmail)).toBeHidden();
    const before = await boxes();
    expect(before.actions.height).toBeGreaterThan(40);

    await page.unroute("**/_next/static/chunks/*.js");
    await page.reload();
    await page.waitForSelector("[data-tz-rsvp=ready]");
    await page.waitForSelector("[data-tz-announcements=ready]");
    await expect(actions.getByRole("button", { name: "RSVP", exact: true })).toBeVisible();
    await expect(form).toBeVisible();
    expect(await boxes()).toEqual(before);
    await expectClean(page, errors);
  });

  test.describe("without JavaScript", () => {
    test.use({ javaScriptEnabled: false });

    test("each RSVP button and the signup form give way to a line offering email", async ({ page }) => {
      const errors = trackPageErrors(page);
      await page.goto("/events/");
      for (const id of [FIXTURE_IDS.open, FIXTURE_IDS.limited, FIXTURE_IDS.started]) {
        const event = card(page, id);
        await expect(event.locator("button.tz-event__rsvp")).toHaveCount(1);
        await expect(event.locator("button.tz-event__rsvp")).toBeHidden();
        const note = event.locator(".tz-event__noscript");
        await expect(note).toBeVisible();
        await expect(note).toHaveText(TEXT.rsvpByEmail);
        await expect(note.getByRole("link", { name: "tzionbreslovproject@gmail.com", exact: true })).toHaveAttribute("href", EMAIL_LINK);
      }
      // "No RSVP": nothing to offer.
      await expect(card(page, FIXTURE_IDS.noRsvp).locator(".tz-event__noscript, button")).toHaveCount(0);

      const region = signup(page);
      await expect(region.getByRole("heading", { name: "Get event announcements" })).toBeVisible();
      await expect(region.locator("form")).toBeHidden();
      const note = region.locator(".tz-announce__noscript");
      await expect(note).toBeVisible();
      await expect(note).toHaveText(TEXT.announcementsByEmail);
      await expect(note.getByRole("link", { name: "tzionbreslovproject@gmail.com", exact: true })).toHaveAttribute("href", EMAIL_LINK);
      await expectClean(page, errors);
    });
  });
});

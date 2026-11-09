import { expect, test, type Locator, type Page, type Route } from "@playwright/test";
import { cspViolations, expectClean, scrollIntoViewAndSettle, trackPageErrors } from "./helpers";

// The covered contact details (owner, 2026-11-08/09): lib/contact-details.mjs renders them, lib/client/contact-details.ts
// reveals them. Two builds:
// - the default one (forms off, as the github.io preview is until switch day): the details covered, with no
//   "Show" buttons, with or without JavaScript;
// - TZ_E2E_EVENTS=1, the fixture build CI makes with NEXT_PUBLIC_API_BASE_URL=https://api.tzionbreslov.org and
//   Turnstile's always-pass test key (.github/workflows/ci.yml): the buttons, one Turnstile check, every slot
//   filled. Turnstile and the forms API are stubbed here, with a fake 555 number (the real one is never in the
//   repository); the enforced CSP still checks both origins before a stub answers.

const FORMS_ON = process.env.TZ_E2E_EVENTS === "1";
const API = "https://api.tzionbreslov.org";
const DETAILS = {
  ok: true,
  phone: { display: "(+1) 555-555-0123", tel: "+15555550123" },
  whatsapp: "https://wa.me/15555550123",
  email: "tzionbreslovproject@gmail.com"
};
const COVERED = { phone: "(+1) 347-•••-••••", email: "tzion••••••@gmail.com", articleEmail: "Tzion••••••@gmail.com" };
// The owner-approved words (content/copy/en.json `contactDetails`).
const TEXT = {
  showNumber: "Show number",
  showNumberName: "Show number (phone and WhatsApp)",
  showEmail: "Show email",
  showEmailName: "Show email address",
  checking: "Checking…",
  failed: "We couldn’t check that you’re a person. Please try again.",
  rateLimited: "Too many tries. Please wait a minute and try again.",
  whatsapp: "WhatsApp"
};
const STORAGE_KEY = "tz:contact-details";

/** Every page with a covered detail besides its footer, and what it covers ("inline" = in a sentence). */
const PAGES: Array<{ path: string; slots: Array<[kind: "phone" | "email", variant: "card" | "inline", covered: string]> }> = [
  { path: "/", slots: [] },
  { path: "/contact/", slots: [["phone", "card", COVERED.phone], ["email", "card", COVERED.email]] },
  { path: "/privacy/", slots: [["email", "inline", COVERED.email]] },
  { path: "/classes/", slots: [["email", "inline", COVERED.email]] },
  { path: "/articles/", slots: [["email", "inline", COVERED.email]] },
  { path: "/articles/page/2/", slots: [["email", "inline", COVERED.email]] },
  { path: "/parshas-toldos-nov-5-6-2021/", slots: [["email", "inline", COVERED.articleEmail]] },
  { path: "/no-such-page/", slots: [] }
];

const footer = (page: Page) => page.locator("#genesis-footer-widgets");
const slot = (scope: Locator, kind: "phone" | "email") => scope.locator(`[data-tz-contact="${kind}"]`);
/** The slots outside the footer, in page order. */
const bodySlots = (page: Page) => page.locator("[data-tz-contact]").filter({ hasNot: page.locator("xpath=ancestor::*[@id='genesis-footer-widgets']") });

/** What a bot could use, anywhere in the page's links or visible text. */
const usable = (page: Page) => page.evaluate(() => ({
  links: [...document.querySelectorAll<HTMLAnchorElement>('a[href^="mailto:" i], a[href^="tel:" i], a[href*="wa.me" i], a[href*="whatsapp.com" i]')]
    .map((a) => a.getAttribute("href")),
  text: ["54-671-3013", "tzionbreslovproject@gmail.com", "555-0123"].filter((t) => document.body.innerText.toLowerCase().includes(t))
}));

async function expectCovered(page: Page, slots: (typeof PAGES)[number]["slots"]) {
  await expect(slot(footer(page), "email").locator(".tz-contact__value")).toHaveText(COVERED.email);
  await expect(slot(footer(page), "phone").locator(".tz-contact__value")).toHaveText(COVERED.phone);
  await expect(footer(page).locator("[data-tz-contact]")).toHaveClass(["tz-contact tz-contact--footer", "tz-contact tz-contact--footer"]);
  const others = bodySlots(page);
  await expect(others).toHaveCount(slots.length);
  for (const [i, [kind, variant, covered]] of slots.entries()) {
    await expect(others.nth(i)).toHaveAttribute("data-tz-contact", kind);
    await expect(others.nth(i)).toHaveClass(`tz-contact tz-contact--${variant}`);
    await expect(others.nth(i).locator(".tz-contact__value")).toHaveText(covered);
    await expect(others.nth(i).locator(".tz-contact__value")).toHaveAttribute("aria-live", "polite");
  }
  expect(await usable(page)).toEqual({ links: [], text: [] });
}

test.describe("with the forms off (the default build)", () => {
  test.skip(FORMS_ON, "the default build: no forms API or Turnstile key");

  test("every place shows the details covered, with no Show button and nothing a bot could use", async ({ page }) => {
    const errors = trackPageErrors(page);
    for (const { path, slots } of PAGES) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await expectCovered(page, slots);
      // No buttons at all: nothing could reveal them (Ruling R13).
      await expect(page.locator("[data-tz-reveal], .tz-contact__show, [data-tz-reveal-slot]")).toHaveCount(0);
      await expect(page.getByRole("button", { name: /^Show (number|email)/ })).toHaveCount(0);
    }
    await expectClean(page, errors);
  });

  test.describe("without JavaScript", () => {
    test.use({ javaScriptEnabled: false });

    test("every place shows the details covered, with no Show button", async ({ page }) => {
      for (const { path, slots } of PAGES) {
        await page.goto(path);
        await expectCovered(page, slots);
        await expect(page.locator("[data-tz-reveal]")).toHaveCount(0);
      }
    });
  });
});

/** A minimal Turnstile: renders nothing and hands out a token at once (or `token`). It records its calls (window.tzTurnstile). */
const turnstileStub = (token = "test-token") => `window.tzTurnstile = { renders: [], resets: 0, removes: 0 };
window.turnstile = {
  render: function (container, options) {
    window.tzTurnstile.renders.push({ action: options.action, size: options.size, appearance: options.appearance,
      inRevealSlot: !!container.closest("[data-tz-reveal-slot]") });
    return "stub-widget-" + window.tzTurnstile.renders.length;
  },
  getResponse: function () { return ${JSON.stringify(token)}; },
  reset: function () { window.tzTurnstile.resets += 1; },
  remove: function () { window.tzTurnstile.removes += 1; }
};`;
type TurnstileCalls = { renders: Array<{ action: string; size: string; appearance: string; inRevealSlot: boolean }>; resets: number; removes: number };
const turnstileCalls = (page: Page) => page.evaluate(() => (window as unknown as { tzTurnstile: TurnstileCalls }).tzTurnstile);
const revealWidgets = async (page: Page) => (await turnstileCalls(page)).renders.filter((r) => r.action === "contact-details");

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Content-Type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const reply = (status: number, body: unknown) => (route: Route) =>
  route.fulfill({ status, contentType: "application/json", headers: cors, body: JSON.stringify(body) });

/** Stubs Turnstile, POST /v1/contact-details and the Contact page's Google map (as e2e/contact.spec.ts does); returns the bodies POSTed. */
async function stubServices(page: Page, answer: (route: Route) => Promise<void> = reply(200, DETAILS), token?: string) {
  const posts: Array<Record<string, unknown>> = [];
  await page.route("https://www.google.com/maps**", (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Map</title><p>Map</p>" }));
  await page.route("https://challenges.cloudflare.com/**", (route) => route.fulfill({ contentType: "application/javascript", body: turnstileStub(token) }));
  await page.route(`${API}/v1/contact-details`, async (route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
    posts.push(route.request().postDataJSON() as Record<string, unknown>);
    return answer(route);
  });
  return posts;
}

/** Opens `path` and waits until its "Show" buttons are ready (visible). */
async function open(page: Page, path: string) {
  const response = await page.goto(path);
  expect(response?.status()).toBe(path === "/no-such-page/" ? 404 : 200);
  await expect(footer(page).locator("[data-tz-reveal]").first()).toBeVisible();
}

const showButton = (scope: Locator, kind: "phone" | "email") =>
  scope.getByRole("button", { name: kind === "phone" ? TEXT.showNumberName : TEXT.showEmailName, exact: true });

/**
 * Waits until nothing around `target` is still lifted by the theme's entrance animation. The Contact page's form and
 * cards row is `.animate` (global.js): GSAP sets each column to y: 45 and eases it to 0 over 2 s (expo, 0.25 s apart,
 * once it scrolls into view), and the last part of that moves by fractions of a pixel, longer than
 * scrollIntoViewAndSettle's 120 frames on a slow machine (CI). So first every ancestor's transform must have no
 * vertical offset left (the target's own may move: the theme's
 * `button:focus, button:hover` rule lifts every button by 0.3em).
 */
async function untilPlaced(target: Locator) {
  await target.scrollIntoViewIfNeeded();
  await target.evaluate((node) => new Promise<void>((resolve, reject) => {
    const started = performance.now();
    const lifted = () => {
      for (let el = node.parentElement; el; el = el.parentElement) {
        const transform = getComputedStyle(el).transform;
        if (transform !== "none" && new DOMMatrixReadOnly(transform).m42 !== 0) return el;
      }
      return null;
    };
    const tick = () => {
      const el = lifted();
      if (!el) return resolve();
      if (performance.now() - started > 15_000) return reject(new Error(`untilPlaced: ${el.className} is still lifted after 15 s`));
      requestAnimationFrame(tick);
    };
    tick();
  }));
}

async function tap(button: Locator) {
  await untilPlaced(button);
  await scrollIntoViewAndSettle(button);
  await button.click();
}

/** Every slot on the page shows the details as links, with no button, check or message left. */
async function expectRevealed(page: Page) {
  const phones = page.locator('[data-tz-contact="phone"]');
  const emails = page.locator('[data-tz-contact="email"]');
  for (const phone of await phones.all()) {
    const call = phone.locator('.tz-contact__value a[href^="tel:"]');
    await expect(call).toHaveAttribute("href", "tel:+15555550123");
    await expect(call).toHaveText("(+1) 555-555-0123");
    const chat = phone.getByRole("link", { name: TEXT.whatsapp, exact: true });
    await expect(chat).toHaveAttribute("href", "https://wa.me/15555550123");
    await expect(chat).toHaveAttribute("target", "_blank");
    await expect(chat).toHaveAttribute("rel", "noopener noreferrer");
    await expect(chat.locator("svg")).toHaveAttribute("aria-hidden", "true");
  }
  for (const email of await emails.all()) {
    const write = email.locator(".tz-contact__value a");
    await expect(write).toHaveCount(1);
    await expect(write).toHaveAttribute("href", "mailto:tzionbreslovproject@gmail.com");
    await expect(write).toHaveText("tzionbreslovproject@gmail.com");
  }
  await expect(page.locator("[data-tz-reveal], [data-tz-reveal-slot], .tz-contact__message")).toHaveCount(0);
  await expect(page.locator(".tz-contact__value").filter({ hasText: "•" })).toHaveCount(0);
}

const stored = (page: Page) => page.evaluate((key) => window.sessionStorage.getItem(key), STORAGE_KEY);

test.describe("with the forms API (TZ_E2E_EVENTS=1)", () => {
  test.skip(!FORMS_ON, "needs the forms-on fixture build (TZ_E2E_EVENTS=1, see .github/workflows/ci.yml)");

  test("the buttons are named as the owner approved, and say what they show", async ({ page }) => {
    const errors = trackPageErrors(page);
    await stubServices(page);
    await open(page, "/contact/");
    for (const scope of [footer(page), page.locator(".box-shadow")]) {
      await expect(showButton(scope, "phone")).toHaveText(TEXT.showNumber);
      await expect(showButton(scope, "email")).toHaveText(TEXT.showEmail);
    }
    await expect(page.getByRole("button", { name: /^Show (number|email)/ })).toHaveCount(4);
    // Each covered value is still there, as it was without the forms.
    await expectCovered(page, PAGES[1].slots);
    await expectClean(page, errors);
  });

  test("one footer \"Show number\" runs one check and reveals every detail on the page: phone, WhatsApp and email", async ({ page }) => {
    const errors = trackPageErrors(page);
    const posts = await stubServices(page);
    await open(page, "/contact/");
    await tap(showButton(footer(page), "phone"));
    await expectRevealed(page);
    // The footer, the Contact cards: two phones (each with its WhatsApp link) and two emails.
    await expect(page.locator('a[href="tel:+15555550123"]')).toHaveCount(2);
    await expect(page.getByRole("link", { name: TEXT.whatsapp, exact: true })).toHaveCount(2);
    await expect(page.locator('a[href="mailto:tzionbreslovproject@gmail.com"]')).toHaveCount(2);
    // One POST: a fresh request id and the token, nothing else.
    expect(posts).toHaveLength(1);
    expect(Object.keys(posts[0]).sort()).toEqual(["cf-turnstile-response", "requestId"]);
    expect(posts[0]["cf-turnstile-response"]).toBe("test-token");
    expect(posts[0].requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    // One compact widget, mounted in the tapped button's own place, with the reveal's action.
    expect(await revealWidgets(page)).toEqual([{ action: "contact-details", size: "compact", appearance: "interaction-only", inRevealSlot: true }]);
    expect(JSON.parse((await stored(page))!)).toEqual(DETAILS);
    await expectClean(page, errors);
  });

  test("the details stay for the visit: a reload and the next page show them at once, with no check", async ({ page }) => {
    const errors = trackPageErrors(page);
    const posts = await stubServices(page);
    await open(page, "/privacy/");
    await tap(showButton(page.locator(".tz-legal"), "email"));
    await expectRevealed(page);
    expect(posts).toHaveLength(1);
    await page.reload();
    await expect(page.locator('.tz-legal a[href="mailto:tzionbreslovproject@gmail.com"]')).toHaveText(DETAILS.email);
    await expectRevealed(page);
    await page.goto("/contact/");
    await expect(page.locator('.box-shadow a[href="tel:+15555550123"]')).toHaveText(DETAILS.phone.display);
    await expectRevealed(page);
    expect(posts).toHaveLength(1);
    expect(await revealWidgets(page)).toEqual([]);
    await expectClean(page, errors);
  });

  for (const [name, script] of [
    // The page itself only: an init script runs in every frame.
    ["setItem throws", "if (window.top === window) Storage.prototype.setItem = function () { throw new DOMException('blocked', 'QuotaExceededError'); };"],
    ["sessionStorage itself throws", "if (window.top === window) Object.defineProperty(window, 'sessionStorage', { configurable: true, get: function () { throw new DOMException('blocked', 'SecurityError'); } });"]
  ]) {
    test(`with storage blocked (${name}) the reveal still fills the page, with no error, and nothing is kept`, async ({ page }) => {
      const errors = trackPageErrors(page);
      await page.addInitScript(script);
      const posts = await stubServices(page);
      await open(page, "/contact/");
      await tap(showButton(page.locator(".box-shadow"), "email"));
      await expectRevealed(page);
      expect(posts).toHaveLength(1);
      // Nothing was kept, so the next page is covered again, its buttons ready.
      await page.goto("/privacy/");
      await expect(showButton(page.locator(".tz-legal"), "email")).toBeVisible();
      await expectCovered(page, PAGES[2].slots);
      await expectClean(page, errors);
    });
  }

  test("a Turnstile that never gives a token waits a minute for the visitor, then brings the button back with the failed message, never stuck on Checking…", async ({ page }) => {
    // About 62 s: the reveal gives its check a minute (lib/client/contact-details.ts, CHECK_TIMEOUT_MS).
    test.slow();
    const errors = trackPageErrors(page);
    const posts = await stubServices(page, reply(200, DETAILS), "");
    await open(page, "/contact/");
    const button = showButton(footer(page), "email");
    await tap(button);
    const checking = footer(page).getByRole("button", { name: TEXT.checking, exact: true });
    await expect(checking).toBeVisible();
    const alert = slot(footer(page), "email").getByRole("alert");
    // Well past the forms' 15 s, an older visitor may still be finding the box to tick: still checking, and the box
    // not reset under them.
    await page.waitForTimeout(20_000);
    await expect(checking).toBeVisible();
    await expect(slot(footer(page), "email").locator(".tz-contact__message")).toBeEmpty();
    expect((await turnstileCalls(page)).resets).toBe(0);
    await expect(alert).toHaveText(TEXT.failed, { timeout: 60_000 });
    await expect(button).toHaveText(TEXT.showEmail);
    await expect(button).toBeEnabled();
    await expect(button).not.toHaveAttribute("aria-disabled", "true");
    await expect(page.locator('[aria-disabled="true"]')).toHaveCount(0);
    expect(posts).toHaveLength(0);
    expect((await turnstileCalls(page)).resets).toBeGreaterThanOrEqual(1);
    await expectCovered(page, PAGES[1].slots);
    await expectClean(page, errors);
  });

  test("a Turnstile script that fails to load brings the button back with the failed message, and a later tap loads it again", async ({ page }) => {
    const errors = trackPageErrors(page);
    const posts = await stubServices(page);
    // Turnstile unreachable at first (a brief network drop): this route runs before stubServices' own.
    const unreachable = (route: Route) => route.abort("failed");
    await page.route("https://challenges.cloudflare.com/**", unreachable);
    await page.goto("/privacy/");
    const button = showButton(page.locator(".tz-legal"), "email");
    await tap(button);
    await expect(slot(page.locator(".tz-legal"), "email").getByRole("alert")).toHaveText(TEXT.failed);
    await expect(button).toHaveText(TEXT.showEmail);
    await expect(page.locator('[aria-disabled="true"]')).toHaveCount(0);
    expect(posts).toHaveLength(0);
    // Back online: the next tap loads Turnstile afresh (a failed load isn't kept) and reveals, with no reload.
    await page.unroute("https://challenges.cloudflare.com/**", unreachable);
    await tap(button);
    await expectRevealed(page);
    expect(posts).toHaveLength(1);
    expect(await revealWidgets(page)).toHaveLength(1);
    // The footer's sign-up form (lib/client/forms.ts) can't load Turnstile either, and leaves its own
    // TURNSTILE_LOAD_FAILED unobserved (it reads it only on submit): at most that one, never a second from the reveal,
    // which observes its own (docs/superpowers/follow-ups.md).
    const isLoadFailure = (error: Error) => /TURNSTILE_LOAD_FAILED/.test(String(error));
    expect(errors().filter(isLoadFailure).length).toBeLessThanOrEqual(1);
    const own = errors().filter((error) => !isLoadFailure(error));
    expect({ pageErrors: own, cspViolations: await cspViolations(page) }).toEqual({ pageErrors: [], cspViolations: [] });
  });

  test("a double tap, or a second Show while a check runs, makes one POST and mounts one widget", async ({ page }) => {
    const errors = trackPageErrors(page);
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const posts = await stubServices(page, async (route) => {
      await held;
      return reply(200, DETAILS)(route);
    });
    await open(page, "/contact/");
    const phone = showButton(page.locator(".box-shadow"), "phone");
    await untilPlaced(phone);
    await scrollIntoViewAndSettle(phone);
    await phone.dblclick();
    // While it runs: the tapped button says Checking…, every button is disabled, and another tap does nothing.
    await expect(page.locator(".box-shadow").getByRole("button", { name: TEXT.checking, exact: true })).toBeVisible();
    await expect(page.locator('[data-tz-reveal][aria-disabled="true"]')).toHaveCount(4);
    // A tap on a disabled-looking button still reaches it (aria-disabled, not disabled): it must do nothing.
    await showButton(page.locator(".box-shadow"), "email").click({ force: true });
    await showButton(page.locator(".box-shadow"), "email").dispatchEvent("click");
    await expect.poll(() => posts.length).toBe(1);
    release();
    await expectRevealed(page);
    expect(posts).toHaveLength(1);
    expect(await revealWidgets(page)).toHaveLength(1);
    await expectClean(page, errors);
  });

  for (const [name, value] of [
    ["not JSON", "{not json"],
    ["an old shape", JSON.stringify({ phone: "(+1) 555-555-0123", email: "tzionbreslovproject@gmail.com" })],
    ["a script link", JSON.stringify({ ...DETAILS, whatsapp: "javascript:alert(1)" })],
    ["a bad number", JSON.stringify({ ...DETAILS, phone: { display: "(+1) 555-555-0123", tel: "javascript:alert(1)" } })]
  ]) {
    test(`a kept value that is ${name} is ignored: the page stays covered and the buttons still work`, async ({ page }) => {
      const errors = trackPageErrors(page);
      await page.addInitScript(([key, kept]) => window.sessionStorage.setItem(key, kept), [STORAGE_KEY, value]);
      const posts = await stubServices(page);
      await open(page, "/contact/");
      await expectCovered(page, PAGES[1].slots);
      await expect(page.locator("[data-tz-reveal]")).toHaveCount(4);
      await tap(showButton(footer(page), "email"));
      await expectRevealed(page);
      expect(posts).toHaveLength(1);
      expect(JSON.parse((await stored(page))!)).toEqual(DETAILS);
      await expectClean(page, errors);
    });
  }

  for (const [name, status, body] of [
    ["a 503 (CONTACT_PHONE missing)", 503, { ok: false, error: "SERVICE_NOT_CONFIGURED", correlationId: "c0ffee00-0000-4000-8000-000000000000" }],
    ["a failed check", 400, { ok: false, error: "BOT_CHALLENGE_FAILED", correlationId: "c0ffee00-0000-4000-8000-000000000000" }],
    ["a 200 with a script link", 200, { ...DETAILS, whatsapp: "javascript:alert(1)" }],
    ["a 200 with a bad email", 200, { ...DETAILS, email: "<img src=x onerror=alert(1)>" }],
    ["a 200 with a long display", 200, { ...DETAILS, phone: { ...DETAILS.phone, display: "x".repeat(40) } }],
    ["a 200 that is not JSON", 200, "not json"]
  ] as const) {
    test(`${name} shows the failed message, keeps nothing and links nothing`, async ({ page }) => {
      const errors = trackPageErrors(page);
      const posts = await stubServices(page, typeof body === "string"
        ? (route) => route.fulfill({ status, contentType: "application/json", headers: cors, body })
        : reply(status, body));
      await open(page, "/contact/");
      const button = showButton(page.locator(".box-shadow"), "phone");
      await tap(button);
      await expect(slot(page.locator(".box-shadow"), "phone").getByRole("alert")).toHaveText(TEXT.failed);
      expect(posts).toHaveLength(1);
      await expect(button).toHaveText(TEXT.showNumber);
      await expect(page.locator('[aria-disabled="true"]')).toHaveCount(0);
      expect(await stored(page)).toBeNull();
      await expectCovered(page, PAGES[1].slots);
      expect((await turnstileCalls(page)).resets).toBeGreaterThanOrEqual(1);
      // Another try runs a new check.
      await tap(button);
      await expect.poll(() => posts.length).toBe(2);
      await expect(slot(page.locator(".box-shadow"), "phone").getByRole("alert")).toHaveText(TEXT.failed);
      await expectClean(page, errors);
    });
  }

  test("RATE_LIMITED says to wait a minute", async ({ page }) => {
    const errors = trackPageErrors(page);
    await stubServices(page, reply(429, { ok: false, error: "RATE_LIMITED", correlationId: "c0ffee00-0000-4000-8000-000000000000" }));
    await open(page, "/privacy/");
    await tap(showButton(page.locator(".tz-legal"), "email"));
    await expect(slot(page.locator(".tz-legal"), "email").getByRole("alert")).toHaveText(TEXT.rateLimited);
    await expect(showButton(page.locator(".tz-legal"), "email")).toHaveText(TEXT.showEmail);
    expect(await stored(page)).toBeNull();
    await expectClean(page, errors);
  });

  test("by keyboard: Tab to \"Show email\", Enter, and the focus lands on the revealed address", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "a keyboard");
    const errors = trackPageErrors(page);
    await stubServices(page);
    await open(page, "/privacy/");
    const button = showButton(page.locator(".tz-legal"), "email");
    // A focusable start right before the slot, then Tab: the next stop is the button.
    await button.evaluate((node) => {
      const before = document.createElement("a");
      before.href = "#";
      before.textContent = "start";
      before.id = "tz-test-start";
      node.closest(".tz-contact")!.before(before);
    });
    await page.locator("#tz-test-start").focus();
    await page.keyboard.press("Tab");
    await expect(button).toBeFocused();
    await expect(button).toHaveCSS("outline-style", "solid");
    await page.keyboard.press("Enter");
    const address = page.locator('.tz-legal a[href="mailto:tzionbreslovproject@gmail.com"]');
    await expect(address).toBeFocused();
    await expectRevealed(page);
    await expectClean(page, errors);
  });

  test("the buttons and the WhatsApp link are at least 24 × 24 px, and the footer's contact column never overflows", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "sets its own viewport sizes");
    const errors = trackPageErrors(page);
    await stubServices(page);
    await open(page, "/contact/");
    const sizes = (selector: string) => page.locator(selector).evaluateAll((nodes) =>
      nodes.map((node) => node.getBoundingClientRect()).map((box) => [Math.round(box.width), Math.round(box.height)]));
    // Nothing in a slot (the value, its links, the button) reaches past its paragraph's content box, nor the column.
    const overflow = () => page.locator("#genesis-footer-widgets .wp-block-column:has([data-tz-contact])").evaluate((column) => ({
      column: column.scrollWidth > column.clientWidth,
      slots: [...column.querySelectorAll(".tz-contact")].flatMap((slot) => {
        const paragraph = slot.closest("p")!;
        const box = paragraph.getBoundingClientRect();
        const style = getComputedStyle(paragraph);
        const left = box.left + parseFloat(style.paddingLeft);
        const right = box.right - parseFloat(style.paddingRight);
        return [...slot.querySelectorAll(".tz-contact__value, .tz-contact__value a, .tz-contact__show")]
          .filter((node) => { const r = node.getBoundingClientRect(); return r.left < left - 0.5 || r.right > right + 0.5; })
          .map((node) => `${slot.getAttribute("data-tz-contact")} ${node.className || node.tagName}`);
      })
    }));
    for (const width of [1440, 1280, 1024, 1000, 960, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      const buttons = await sizes("[data-tz-reveal]");
      expect(buttons).toHaveLength(4);
      for (const [w, h] of buttons) {
        expect(w, `${width}px: a Show button`).toBeGreaterThanOrEqual(24);
        expect(h, `${width}px: a Show button`).toBeGreaterThanOrEqual(24);
      }
      expect(await overflow(), `${width}px covered`).toEqual({ column: false, slots: [] });
    }
    await tap(showButton(footer(page), "phone"));
    await expectRevealed(page);
    for (const width of [1440, 1280, 1024, 1000, 960, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      const icons = await sizes(".tz-contact__whatsapp");
      expect(icons).toHaveLength(2);
      for (const [w, h] of icons) {
        expect(w, `${width}px: the WhatsApp link`).toBeGreaterThanOrEqual(24);
        expect(h, `${width}px: the WhatsApp link`).toBeGreaterThanOrEqual(24);
      }
      expect(await overflow(), `${width}px revealed`).toEqual({ column: false, slots: [] });
    }
    await expectClean(page, errors);
  });

  test.describe("without JavaScript", () => {
    test.use({ javaScriptEnabled: false });

    test("the buttons are in the page but never shown (Ruling R13): the details covered, nothing to press", async ({ page }) => {
      for (const { path, slots } of PAGES) {
        await page.goto(path);
        await expectCovered(page, slots);
        const buttons = page.locator("[data-tz-reveal]");
        await expect(buttons).toHaveCount(2 + slots.length);
        for (const button of await buttons.all()) await expect(button).toBeHidden();
        await expect(page.getByRole("button", { name: /^Show (number|email)/ })).toHaveCount(0);
      }
    });
  });
});

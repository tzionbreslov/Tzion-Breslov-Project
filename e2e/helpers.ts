import { expect, type Page } from "@playwright/test";
import { violatesOurPolicy } from "../scripts/lib/csp-console.mjs";

// A pre-existing bug in the original theme, kept for fidelity: its number
// counter (isScrolledIntoView in global.js) throws on scroll on pages without
// `.numbers`. Only that function is tolerated — any other error from global.js
// (menu toggles, header scroll class, GSAP setup) still fails the test.
const KNOWN_THEME_SCRIPT = "/themes/tzionbreslov/js/global.js";
const KNOWN_THEME_FUNCTION = "isScrolledIntoView";
const isKnownThemeError = (error: Error) => {
  const stack = error.stack ?? "";
  return stack.includes(KNOWN_THEME_SCRIPT) && stack.includes(KNOWN_THEME_FUNCTION);
};

// Which console messages are violations of our CSP (and not, say, the YouTube
// player's own report-only policy): scripts/lib/csp-console.mjs.

// page.consoleMessages() keeps only the last 200 messages, and a YouTube embed
// alone can log ~200, so a tracked page records our violations as they happen.
const recorded = new WeakMap<Page, string[]>();

/** Collects the page's uncaught errors (minus the known theme bug), and its CSP violations. Call before the first goto. */
export function trackPageErrors(page: Page): () => Error[] {
  const errors: Error[] = [];
  page.on("pageerror", (error) => {
    if (!isKnownThemeError(error)) errors.push(error);
  });
  const violations: string[] = [];
  recorded.set(page, violations);
  page.on("console", (message) => {
    if (violatesOurPolicy(message.text())) violations.push(message.text());
  });
  return () => errors;
}

/** Every violation of the site's CSP that Chromium reported on this page so far (all navigations). */
export async function cspViolations(page: Page): Promise<string[]> {
  const violations = recorded.get(page);
  if (violations) {
    // A round trip to the page first, so messages it logged before now have arrived.
    await page.evaluate(() => 0).catch(() => undefined);
    return [...violations];
  }
  // Untracked page: fall back to the console's (capped) history.
  const messages = await page.consoleMessages({ filter: "all" });
  return messages.map((message) => message.text()).filter((text) => violatesOurPolicy(text));
}

/** No page errors and no CSP violations. Every spec calls this at the end. */
export async function expectClean(page: Page, errors: () => Error[]): Promise<void> {
  expect({
    pageErrors: errors().map((error) => error.stack ?? String(error)),
    cspViolations: await cspViolations(page)
  }).toEqual({ pageErrors: [], cspViolations: [] });
}

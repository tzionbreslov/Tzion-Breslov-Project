import { expect, type Locator, type Page } from "@playwright/test";
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
  // The console's own history is capped, so an untracked page's violations can't be trusted.
  if (!violations) throw new Error("cspViolations: call trackPageErrors first");
  // A round trip to the page first, so messages it logged before now have arrived.
  await page.evaluate(() => 0).catch(() => undefined);
  return [...violations];
}

// How long scrollIntoViewAndSettle waits for a still box: about 2 s at 60 frames a second.
const SETTLE_MAX_FRAMES = 120;

/**
 * Scrolls `target` into view and waits until it has stopped moving, so a click on it (or on
 * anything near it) doesn't scroll the page itself. A target that holds still for two frames
 * but never for three (one that pauses between moves) fails after SETTLE_MAX_FRAMES frames with
 * "target kept moving". One that never holds still for two frames doesn't get that far: it
 * waits in Playwright's own stable check inside scrollIntoViewIfNeeded until the test timeout.
 *
 * On desktop (1280 px and up) the theme's header (global.js) turns `position: fixed` on the
 * first scroll event at 100 px or more, one frame after the scroll, and everything under it moves
 * up by the header's height (89 px). When a click's own scroll crosses 100 px, that jump can land
 * between its mousedown and its mouseup: the click then goes to a common ancestor, not the
 * target, and does nothing. A replay of that timing matches the e2e/classes.spec.ts and
 * e2e/rsvp.spec.ts desktop failures in CI, though it was never seen to happen on its own.
 */
export async function scrollIntoViewAndSettle(target: Locator): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  // The same box in three animation frames in a row: the scroll event and the header's switch
  // run before the first of them.
  await target.evaluate((node, maxFrames) => new Promise<void>((resolve, reject) => {
    let last = "";
    let same = 0;
    let frames = 0;
    const tick = () => {
      frames++;
      const { top, left, width, height } = node.getBoundingClientRect();
      const box = `${top},${left},${width},${height}`;
      same = box === last ? same + 1 : 0;
      last = box;
      if (same >= 2) resolve();
      else if (frames >= maxFrames) {
        reject(new Error(`scrollIntoViewAndSettle: target kept moving (not still for 3 frames in a row within ${frames}; last box top,left,width,height = ${box})`));
      } else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), SETTLE_MAX_FRAMES);
}

/** No page errors and no CSP violations. Every spec calls this at the end. */
export async function expectClean(page: Page, errors: () => Error[]): Promise<void> {
  expect({
    pageErrors: errors().map((error) => error.stack ?? String(error)),
    cspViolations: await cspViolations(page)
  }).toEqual({ pageErrors: [], cspViolations: [] });
}

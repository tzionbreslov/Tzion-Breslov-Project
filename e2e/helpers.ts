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

/**
 * Safari before 14.1 has no flex `gap`, so app/*.css spaces the new pieces' flex items with margins there instead,
 * in `@supports not (inset: 0)` blocks: @supports can't ask for flex gap (that Safari knows `gap` from grid), but
 * those browsers also lack `inset`, which came with it. This browser has both: these are the blocks' rules as one
 * stylesheet, to apply unconditionally. Null in a browser without inset or gap.
 *
 * Limit: an @media inside a block is kept, but one around a block is dropped (`@media (…) { @supports not (inset: 0)
 * { … } }` comes back as the block's rules alone, at every width). No app/*.css nests a block that way today: write
 * the block outside the @media, or teach this walker to keep the outer condition first.
 */
export function gapFallbackRules(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    if (!CSS.supports("inset: 0") || !CSS.supports("gap: 1px")) return null;
    const rules: string[] = [];
    const walk = (list: CSSRuleList, inside: boolean) => {
      for (const rule of list) {
        if (rule instanceof CSSSupportsRule) walk(rule.cssRules, rule.conditionText.replace(/\s+/g, "") === "not(inset:0)");
        else if (rule instanceof CSSMediaRule) {
          const inner: string[] = [];
          for (const child of rule.cssRules) if (inside) inner.push(child.cssText);
          if (inner.length) rules.push(`@media ${rule.conditionText} { ${inner.join(" ")} }`);
          else walk(rule.cssRules, inside);
        } else if (inside) rules.push(rule.cssText);
      }
    };
    for (const sheet of document.styleSheets) {
      try { walk(sheet.cssRules, false); } catch { /* another origin's sheet */ }
    }
    return rules.join("\n");
  });
}

/** What `layoutOf` measures: each match's own box (`boxes`), or its box and everything inside it (`contents`). */
export type LayoutTargets = { boxes?: string[]; contents?: string[] };

/**
 * Where each target lies, to 1/100 px, once the page's finite animations (the theme's fade-in, a dialog opening)
 * have run: for `boxes`, each match's own border box; for `contents`, also every element box and line of text inside
 * it (a Range over its contents), so a flex item or a text run that moves shows. A hidden match has empty boxes.
 */
export function layoutOf(page: Page, { boxes = [], contents = [] }: LayoutTargets) {
  return page.evaluate(async ({ boxes, contents }) => {
    const finite = document.getAnimations().filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity);
    await Promise.all(finite.map((animation) => animation.finished.catch(() => undefined)));
    const round = (n: number) => Math.round(n * 100) / 100;
    const rect = ({ x, y, width, height }: DOMRect) => [x, y, width, height].map(round);
    const inside = (node: Element) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      return [...range.getClientRects()].map(rect);
    };
    const all = (selector: string) => [...document.querySelectorAll(selector)];
    return {
      boxes: boxes.map((selector) => [selector, all(selector).map((node) => rect(node.getBoundingClientRect()))]),
      contents: contents.map((selector) => [selector, all(selector).map((node) => [rect(node.getBoundingClientRect()), ...inside(node)])])
    };
  }, { boxes, contents });
}

/**
 * The proof for the margins `gapFallbackRules` returns: lays the page out at each width with the gaps, applies the
 * fallback's rules (they take each container's gap away and put margins in its place), lays it out again, and
 * expects every target exactly where it was. Each of `containers` must be a flex container that has a gap before and
 * none after, so a container the fallback forgets fails instead of passing on its own gap; `prepare` runs after each
 * resize, before measuring. Desktop project only: it sets its own viewport sizes. Each width is laid out twice, so a
 * proof took up to 37 s under 10 local workers: every test that calls this marks itself `test.slow()`.
 *
 * Limit: the rules are appended after every stylesheet (as e2e/contact.spec.ts does too), so here they win every tie
 * of equal specificity. In a real old Safari each block applies where it sits in app/*.css, and the theme's and
 * WordPress's stylesheets and every app/*.css rule after the block come later: one of those with the same
 * specificity that sets the same margin or gap would win there, and this proof can't see it. So each block's
 * selectors must outrank such rules, and that is checked by hand: the Group 9 review found
 * none on 2026-11-08.
 */
export async function expectGapFallbackLayout(page: Page, { containers, targets, widths, height = 900, prepare }: {
  containers: string[];
  targets: LayoutTargets;
  widths: number[];
  height?: number;
  prepare?: (width: number) => Promise<void>;
}): Promise<void> {
  const fallback = await gapFallbackRules(page);
  expect(fallback, "the fallback's rules (and a browser with inset and gap)").toBeTruthy();
  const gaps = () => page.evaluate((selectors) => selectors.map((selector) => {
    const nodes = [...document.querySelectorAll(selector)];
    return [selector, nodes.length, nodes.map((node) => {
      const style = getComputedStyle(node);
      return [style.display, style.rowGap, style.columnGap].join(" ");
    })];
  }), containers);
  const lay = async (width: number) => {
    await page.setViewportSize({ width, height });
    await prepare?.(width);
    // Measured at the top of the page, a few frames on: from 1280px the theme's header turns fixed (and moves
    // everything under it) once the page scrolls past 100px, so both runs must see it in the same place.
    await page.evaluate(() => {
      window.scrollTo(0, 0);
      return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    });
    // Read once the layout has stopped changing (the theme and the islands also react to a resize).
    let layout = await layoutOf(page, targets);
    for (let tries = 0; tries < 20; tries++) {
      await page.waitForTimeout(100);
      const again = await layoutOf(page, targets);
      if (JSON.stringify(again) === JSON.stringify(layout)) break;
      layout = again;
    }
    return { gaps: await gaps(), layout };
  };
  const withGap = [];
  for (const width of widths) {
    const before = await lay(width);
    for (const [selector, count, styles] of before.gaps as [string, number, string[]][]) {
      expect(count, `${selector} at ${width}px`).toBeGreaterThan(0);
      for (const style of styles) expect(style, `${selector} at ${width}px: a flex container with a gap`).toMatch(/^(inline-)?flex (?!(normal|0px) (normal|0px)$)/);
    }
    withGap.push(before.layout);
  }
  await page.addStyleTag({ content: fallback! });
  for (const [i, width] of widths.entries()) {
    const after = await lay(width);
    for (const [selector, , styles] of after.gaps as [string, number, string[]][]) {
      for (const style of styles) expect(style, `${selector} at ${width}px: the fallback takes its gap away`).toMatch(/^(inline-)?flex (normal|0px) (normal|0px)$/);
    }
    expect(after.layout, `${width}px`).toEqual(withGap[i]);
  }
}

/** No page errors and no CSP violations. Every spec calls this at the end. */
export async function expectClean(page: Page, errors: () => Error[]): Promise<void> {
  expect({
    pageErrors: errors().map((error) => error.stack ?? String(error)),
    cspViolations: await cspViolations(page)
  }).toEqual({ pageErrors: [], cspViolations: [] });
}

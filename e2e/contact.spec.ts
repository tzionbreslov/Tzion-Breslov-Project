import { expect, test, type Page } from "@playwright/test";
import { expectClean, gapFallbackRules, trackPageErrors } from "./helpers";

// The map on the Contact page (lib/pages/contact-map.ts): pinned on Bet Shemesh, Israel (owner).
const EMBED = "https://www.google.com/maps?q=Bet%20Shemesh%2C%20Israel&z=13&output=embed";
const DIRECTIONS = "https://www.google.com/maps/dir/?api=1&destination=Bet%20Shemesh%2C%20Israel";
const OPEN_IN_MAPS = "https://www.google.com/maps/search/?api=1&query=Bet%20Shemesh%2C%20Israel";
const CARDS = ["(+972) 54-671-3013", "tzionbreslovproject@gmail.com", "Beit Shemesh, Israel"];

const FRAME = "section.tz-map iframe";
const section = (page: Page) => page.locator("section.tz-map");
const mapFrame = (page: Page) => page.locator(FRAME);
const columns = (page: Page) => page.locator(".wp-block-columns.is-style-col-spread");
const cards = (page: Page) => columns(page).locator(".wp-block-group.box-shadow");
const link = (page: Page, name: string) => section(page).getByRole("link", { name, exact: true });
/** The phone layout (the theme's own breakpoint for stacked buttons). */
const isPhone = (page: Page) => page.viewportSize()!.width <= 600;

// The map itself is Google's: answer its embed locally, so these tests never
// depend on Google (CSP still checks the frame's origin before the route
// answers). scripts/check-csp.mjs loads the real one.
const MAPS = "https://www.google.com/maps**";
const STUB = { contentType: "text/html", body: "<!doctype html><title>Map</title><p>Map</p>" };
const stubMap = (page: Page) => page.route(MAPS, (route) => route.fulfill(STUB));

async function openContact(page: Page, waitUntil: "load" | "domcontentloaded" = "load") {
  const response = await page.goto("/contact/", { waitUntil });
  expect(response?.status()).toBe(200);
}

test("the map comes right after the contact columns, after the Beit Shemesh card; the form and the three cards are unchanged", async ({ page }) => {
  const errors = trackPageErrors(page);
  await stubMap(page);
  await openContact(page);

  await expect(section(page)).toHaveCount(1);
  await expect(section(page)).toHaveAttribute("aria-labelledby", "tz-map-title");
  await expect(section(page).locator("h2#tz-map-title")).toHaveText("Find us in Bet Shemesh");
  // A labelled section is a landmark, named by its heading.
  await expect(page.getByRole("region", { name: "Find us in Bet Shemesh", exact: true })).toHaveCount(1);

  // The form and the three cards are where they were, and the map is not among them.
  await expect(columns(page)).toHaveCount(1);
  await expect(columns(page).locator("form#gform_3")).toHaveCount(1);
  await expect(page.locator("form#gform_3")).toHaveCount(1);
  await expect(cards(page)).toHaveText(CARDS);
  await expect(columns(page).locator("section.tz-map, iframe")).toHaveCount(0);

  const order = await section(page).evaluate((map) => {
    const cols = document.querySelector(".wp-block-columns.is-style-col-spread")!;
    const beitShemesh = [...cols.querySelectorAll(".wp-block-group.box-shadow")].find((card) => card.textContent!.includes("Beit Shemesh, Israel"))!;
    const group = map.parentElement!;
    return {
      afterCard: !!(beitShemesh.compareDocumentPosition(map) & Node.DOCUMENT_POSITION_FOLLOWING),
      afterForm: !!(document.querySelector("form#gform_3")!.compareDocumentPosition(map) & Node.DOCUMENT_POSITION_FOLLOWING),
      // Immediately after the columns block, the last thing in their group…
      previous: map.previousElementSibling === cols,
      last: map.nextElementSibling === null,
      // …which is still followed by the page's closing spacer.
      next: group.nextElementSibling?.className ?? null
    };
  });
  expect(order).toEqual({ afterCard: true, afterForm: true, previous: true, last: true, next: "wp-block-spacer spacer-medium-height " });
  await expectClean(page, errors);
});

test("the map is Google Maps pinned on Bet Shemesh, with links to directions and to Google Maps", async ({ page }) => {
  const errors = trackPageErrors(page);
  await stubMap(page);
  await openContact(page);

  const frame = mapFrame(page);
  await expect(frame).toHaveCount(1);
  const src = (await frame.getAttribute("src"))!;
  expect(src).toContain("maps?q=Bet%20Shemesh%2C%20Israel");
  expect(src).toContain("output=embed");
  expect(src).toBe(EMBED);
  await expect(frame).toHaveAttribute("title", "Map of Bet Shemesh, Israel");
  await expect(frame).toHaveAttribute("loading", "lazy");
  await expect(frame).toHaveAttribute("referrerpolicy", "strict-origin-when-cross-origin");
  await expect(frame).toHaveAttribute("allowfullscreen", "");
  await expect(section(page).getByTitle("Map of Bet Shemesh, Israel", { exact: true })).toHaveCount(1);

  await expect(section(page).getByRole("link")).toHaveCount(2);
  for (const [name, href, style] of [["Get directions", DIRECTIONS, "is-style-turquoise"], ["Open in Google Maps", OPEN_IN_MAPS, "is-style-outline"]]) {
    const a = link(page, name);
    await expect(a).toHaveAttribute("href", href);
    await expect(a).toHaveAttribute("target", "_blank");
    await expect(a).toHaveAttribute("rel", "noopener noreferrer");
    // The theme's own button styles.
    await expect(a).toHaveClass("wp-block-button__link wp-element-button");
    await expect(a.locator("xpath=..")).toHaveClass(`wp-block-button ${style}`);
  }
  await expectClean(page, errors);
});

test("both map links carry the external-link icon the Classes channel link has", async ({ page }) => {
  const errors = trackPageErrors(page);
  await stubMap(page);
  await page.goto("/classes/");
  const channelIcon = await page.locator("a.tz-vl__channel > svg").evaluate((svg) => svg.outerHTML);
  expect(channelIcon).toContain('aria-hidden="true"');
  await openContact(page);
  for (const name of ["Get directions", "Open in Google Maps"]) {
    const icons = link(page, name).locator("svg");
    await expect(icons, name).toHaveCount(1);
    expect(await icons.evaluate((svg) => svg.outerHTML), name).toBe(channelIcon);
    // Drawn as on Classes: a 16px outline in the link's own colour, after the label.
    expect(await icons.evaluate((svg) => {
      const style = getComputedStyle(svg);
      const box = svg.getBoundingClientRect();
      return { size: `${box.width}x${box.height}`, fill: style.fill, stroke: style.stroke === getComputedStyle(svg.parentElement!).color, width: style.strokeWidth, last: svg === svg.parentElement!.lastChild };
    }), name).toEqual({ size: "16x16", fill: "none", stroke: true, width: "2px", last: true });
  }
  await expectClean(page, errors);
});

test("both map links lift on hover and focus as the theme's buttons do, and not with reduced motion", async ({ page, isMobile }) => {
  test.skip(isMobile, "hovering needs a mouse");
  const errors = trackPageErrors(page);
  await stubMap(page);
  await openContact(page);
  // The theme lifts its buttons by .3em (16px text: 4.8px) over its .25s transition.
  const LIFTED = "matrix(1, 0, 0, 1, 0, -4.8)";
  for (const motion of ["no-preference", "reduce"] as const) {
    await page.emulateMedia({ reducedMotion: motion });
    for (const name of ["Get directions", "Open in Google Maps"]) {
      const a = link(page, name);
      await a.scrollIntoViewIfNeeded();
      await a.hover();
      await expect(a, `${name} hovered, ${motion}`).toHaveCSS("transform", motion === "reduce" ? "none" : LIFTED);
      await page.mouse.move(5, 300);
      await expect(a, `${name} at rest, ${motion}`).toHaveCSS("transform", "none");
      await a.focus();
      await expect(a, `${name} focused, ${motion}`).toHaveCSS("transform", motion === "reduce" ? "none" : LIFTED);
      await a.blur();
      await expect(a, `${name} at rest, ${motion}`).toHaveCSS("transform", "none");
    }
  }
  await expectClean(page, errors);
});

// Safari before 14.1 has no flex `gap`: app/pages.css then spaces the map card's parts and its buttons with
// margins (@supports not (inset: 0), which those browsers also lack). This browser has both, so the fallback's
// rules are applied here as they are, unconditionally, and must lay everything out exactly as the gaps do.
test("without flex gap the margins space the map card and its buttons exactly as the gaps do", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "sets its own viewport sizes");
  const errors = trackPageErrors(page);
  await stubMap(page);
  await openContact(page);
  const fallback = await gapFallbackRules(page);
  expect(fallback, "the fallback's rules (and a browser with inset and gap)").toBeTruthy();
  expect(fallback).toContain(".tz-map");

  const boxes = () => section(page).evaluate(async (map) => {
    map.getBoundingClientRect();
    await Promise.all(map.getAnimations({ subtree: true }).map((animation) => animation.finished));
    // The card, its heading and map, each button and its icon (the buttons' row box itself is where the margins go).
    return [".tz-map__card", ".tz-map__title", ".tz-map__frame", ".wp-block-button:first-child a", ".wp-block-button:last-child a",
      ".wp-block-button:first-child svg", ".wp-block-button:last-child svg"].map((selector) => {
      const { x, y, width, height } = map.querySelector(selector)!.getBoundingClientRect();
      return [x, y, width, height].map((n) => Math.round(n * 100) / 100);
    });
  });
  const widths = [320, 390, 600, 601, 640, 668, 722, 768, 1440];
  const withGap = [];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 800 });
    withGap.push(await boxes());
  }
  await page.addStyleTag({ content: fallback! });
  for (const [i, width] of widths.entries()) {
    await page.setViewportSize({ width, height: 800 });
    expect(await boxes(), `${width}px`).toEqual(withGap[i]);
  }
  await expectClean(page, errors);
});

test("the map card has the Contact cards' look, and the map keeps its full height before it loads", async ({ page }) => {
  const errors = trackPageErrors(page);
  // Hold Google's answer, so the frame is measured while it is still empty.
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route(MAPS, async (route) => { await held; await route.fulfill(STUB); });
  await openContact(page, "domcontentloaded");
  const height = isPhone(page) ? "300px" : "420px";
  const frame = mapFrame(page);
  await expect(frame).toHaveCSS("height", height);
  await expect(section(page).locator(".tz-map__frame")).toHaveCSS("height", height);

  // The card: the Contact cards' background, border, corners and shadow, read from the page itself.
  const LOOK = ["background-color", "border-top-color", "border-right-color", "border-bottom-color", "border-left-color",
    "border-top-width", "border-right-width", "border-bottom-width", "border-left-width", "border-top-style",
    "border-top-left-radius", "border-top-right-radius", "border-bottom-right-radius", "border-bottom-left-radius", "box-shadow"];
  const look = (selector: string) => page.locator(selector).first().evaluate((el, props) => {
    const style = getComputedStyle(el);
    return Object.fromEntries(props.map((prop) => [prop, style.getPropertyValue(prop)]));
  }, LOOK);
  const contactCard = await look(".wp-block-columns.is-style-col-spread .wp-block-group.box-shadow");
  expect(contactCard).toMatchObject({ "background-color": "rgb(242, 249, 255)", "border-top-color": "rgb(30, 97, 161)", "border-top-width": "1px", "border-bottom-right-radius": "0px", "box-shadow": "rgba(0, 0, 0, 0.16) 3px 5px 15px 0px" });
  expect(await look("section.tz-map .tz-map__card")).toEqual(contactCard);

  // The map carries the card's corners (square bottom-right), clipped by its frame.
  const frameBox = await section(page).locator(".tz-map__frame").evaluate((el) => {
    const style = getComputedStyle(el);
    return { radius: style.borderRadius, overflow: style.overflow };
  });
  expect(frameBox).toEqual({ radius: "30px 30px 0px", overflow: "hidden" });
  await expect(frame).toHaveCSS("border-radius", "30px 30px 0px");
  await expect(frame).toHaveCSS("border-top-width", "0px");
  await expect(frame).toHaveCSS("display", "block");
  // The map fills its frame.
  const sizes = await section(page).locator(".tz-map__frame").evaluate((el) => [el.getBoundingClientRect().width, el.querySelector("iframe")!.getBoundingClientRect().width]);
  expect(sizes[1]).toBe(sizes[0]);

  // Tzion's heading font and colours; the theme's turquoise button, and an outline one in dark blue.
  const title = section(page).locator("h2#tz-map-title");
  expect(await title.evaluate((el) => getComputedStyle(el).fontFamily)).toContain("Newsreader");
  await expect(title).toHaveCSS("color", "rgb(30, 97, 161)");
  await expect(link(page, "Get directions")).toHaveCSS("background-color", "rgb(112, 185, 188)");
  await expect(link(page, "Get directions")).toHaveCSS("color", "rgb(255, 255, 255)");
  const outline = link(page, "Open in Google Maps");
  await expect(outline).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  await expect(outline).toHaveCSS("color", "rgb(30, 97, 161)");
  await expect(outline).toHaveCSS("border-top", "2px solid rgb(30, 97, 161)");

  // Still empty and still full height; then it loads at the same size.
  await frame.scrollIntoViewIfNeeded();
  const before = await frame.boundingBox();
  expect(before!.height).toBe(parseInt(height));
  release();
  await expect(page.frameLocator(FRAME).locator("p")).toHaveText("Map");
  expect((await frame.boundingBox())!.height).toBe(before!.height);
  await expectClean(page, errors);
});

test("both map links show a keyboard focus ring", async ({ page }) => {
  const errors = trackPageErrors(page);
  await stubMap(page);
  await openContact(page);
  const ring = (name: string) => link(page, name).evaluate((el) => {
    const style = getComputedStyle(el);
    return { focusVisible: el.matches(":focus-visible"), style: style.outlineStyle, width: parseFloat(style.outlineWidth) };
  });
  const shown = { focusVisible: true, style: "solid", width: 3 };
  // Reach both links with the keyboard: Tab from the first to the second, then back.
  await link(page, "Get directions").focus();
  await page.keyboard.press("Tab");
  await expect(link(page, "Open in Google Maps")).toBeFocused();
  expect(await ring("Open in Google Maps")).toEqual(shown);
  await page.keyboard.press("Shift+Tab");
  await expect(link(page, "Get directions")).toBeFocused();
  expect(await ring("Get directions")).toEqual(shown);
  await expectClean(page, errors);
});

// Phones, both sides of the theme's 600px breakpoint, landscape phones (640, 667), around the width where both
// buttons first fit on one row (722 ± 1, measured with their icons), a tablet and desktop; and either side of 390px,
// where the icons start.
const WIDTHS = [320, 360, 389, 390, 412, 414, 600, 601, 640, 667, 668, 721, 722, 723, 768, 1024, 1440];

test("at every width the buttons are spaced and centred in the card, nothing scrolls sideways, and \"Bet Shemesh\" stays on one line", async ({ page }) => {
  const errors = trackPageErrors(page);
  await stubMap(page);
  await openContact(page);
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 800 });
    const fit = await section(page).evaluate(async (map) => {
      // The theme's buttons transition every property (.25s): measure the layout they settle in.
      map.getBoundingClientRect();
      await Promise.all(map.getAnimations({ subtree: true }).map((animation) => animation.finished));
      const card = map.querySelector(".tz-map__card")!.getBoundingClientRect();
      const inner = [...map.querySelectorAll("h2, .tz-map__frame, a")].map((el) => el.getBoundingClientRect());
      const [first, second] =[...map.querySelectorAll(".tz-map__links a")].map((el) => el.getBoundingClientRect());
      const middle = (left: number, right: number) => (left + right) / 2;
      const cardMiddle = middle(card.left, card.right);
      const oneRow = Math.abs(first.top - second.top) < 1;
      // The heading's words "Bet" and "Shemesh" share a line.
      const title = map.querySelector("h2")!.firstChild as Text;
      const lineOf = (word: string) => {
        const range = document.createRange();
        const at = title.data.indexOf(word);
        range.setStart(title, at);
        range.setEnd(title, at + word.length);
        return Math.round(range.getClientRects()[0].top);
      };
      // Each button's label and the icon after it: the label's lines, and the icon beside its end, centred on it.
      const labels = [...map.querySelectorAll(".tz-map__links a")].map((a) => {
        const range = document.createRange();
        range.selectNodeContents(a.firstChild!);
        const rects = [...range.getClientRects()];
        const svg = a.querySelector("svg")!;
        const icon = svg.getBoundingClientRect();
        const text = range.getBoundingClientRect();
        const style = getComputedStyle(a);
        const room = a.getBoundingClientRect().width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) -
          parseFloat(style.borderLeftWidth) - parseFloat(style.borderRightWidth);
        return {
          lines: new Set(rects.map((rect) => Math.round(rect.top))).size,
          // For the failure message: the label's own width, and the room in the pill.
          measure: `label ${text.width.toFixed(1)}px in ${room.toFixed(1)}px`,
          iconShown: getComputedStyle(svg).display !== "none",
          iconAfter: icon.left >= Math.max(...rects.map((rect) => rect.right)) - 0.5,
          iconCentred: Math.abs(icon.top + icon.height / 2 - (text.top + text.height / 2)) <= 1.5,
          iconInside: icon.right <= a.getBoundingClientRect().right
        };
      });
      return {
        layout: {
          scroll: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
          inside: inner.every((box) => box.left >= card.left && box.right <= card.right),
          cardInView: card.left >= 0 && card.right <= document.documentElement.clientWidth,
          betShemeshTogether: lineOf("Bet") === lineOf("Shemesh")
        },
        labels,
        oneRow,
        // Side by side: the space between them; stacked: the space between the rows.
        gap: oneRow ? second.left - first.right : second.top - first.bottom,
        // Side by side: the pair; stacked: each pill.
        offCentre: oneRow
          ? Math.abs(middle(first.left, second.right) - cardMiddle)
          : Math.max(Math.abs(middle(first.left, first.right) - cardMiddle), Math.abs(middle(second.left, second.right) - cardMiddle))
      };
    });
    expect(fit.layout, `${width}px`).toEqual({ scroll: true, inside: true, cardInView: true, betShemeshTogether: true });
    // From 390px the external-link icon follows each label, both on one line (below that a phone's pill has no
    // room for both, and the icon is left out: those pills are as they were).
    for (const [i, { lines, measure, iconShown, ...icon }] of fit.labels.entries()) {
      if (width >= 390) expect(lines, `${width}px: button ${i + 1}'s label lines (${measure})`).toBe(1);
      expect(iconShown, `${width}px: button ${i + 1}'s icon shown`).toBe(width >= 390);
      if (iconShown) expect(icon, `${width}px: button ${i + 1}'s icon`).toEqual({ iconAfter: true, iconCentred: true, iconInside: true });
    }
    // Never touching (the theme's .5em = 9px), and centred to the pixel.
    expect(fit.gap, `${width}px: gap between the buttons`).toBeGreaterThanOrEqual(8);
    expect(fit.offCentre, `${width}px: buttons off-centre by`).toBeLessThanOrEqual(1);
    // Stacked on phones, side by side from tablets up.
    if (width <= 600) expect(fit.oneRow, `${width}px: stacked`).toBe(false);
    if (width >= 768) expect(fit.oneRow, `${width}px: one row`).toBe(true);
    await expect(mapFrame(page), `${width}px`).toHaveCSS("height", width <= 600 ? "300px" : "420px");
  }
  await expectClean(page, errors);
});

test("after scrolling to the map there are no CSP violations", async ({ page }) => {
  const errors = trackPageErrors(page);
  await stubMap(page);
  await openContact(page);
  await mapFrame(page).scrollIntoViewIfNeeded();
  // Wait until the frame has navigated (to the map, or to an error page if CSP blocked it)…
  await expect.poll(async () => (await (await mapFrame(page).elementHandle())!.contentFrame())?.url() ?? "", { timeout: 15_000 })
    .toMatch(/^(?:https:\/\/www\.google\.com\/maps|chrome-error:)/);
  await page.waitForTimeout(300);
  await expectClean(page, errors);
  // …and it really is the map: a lazy frame that never loaded would prove nothing.
  await expect(page.frameLocator(FRAME).locator("p")).toHaveText("Map");
});

import { expect, test, type Page } from "@playwright/test";
import { expectClean, trackPageErrors } from "./helpers";

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
// buttons first fit on one row (668 ± 1, measured), a tablet and desktop.
const WIDTHS = [320, 360, 390, 412, 414, 600, 601, 640, 667, 668, 669, 768, 1024, 1440];

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
      return {
        layout: {
          scroll: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
          inside: inner.every((box) => box.left >= card.left && box.right <= card.right),
          cardInView: card.left >= 0 && card.right <= document.documentElement.clientWidth,
          betShemeshTogether: lineOf("Bet") === lineOf("Shemesh")
        },
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

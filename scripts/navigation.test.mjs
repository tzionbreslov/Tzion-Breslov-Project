import { strict as assert } from "node:assert";
import fs from "node:fs";
import test from "node:test";
import { load } from "cheerio";
import { stripRemovedUrls } from "../config/site-structure.mjs";
import { NAV, ORIGINAL_NAV, renderNavigation, rewriteLinks } from "../lib/navigation.mjs";

const read = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const fragment = (hash) => read(`content/fragments/${hash}.html`);

// Each page's header and footer, with the path of the page that uses them.
const PAIRS = [
  { header: "d07fb20f0762", footer: "5b8a845aead8", path: "/" },
  { header: "fde8b8aab1cd", footer: "c215e6be2de2", path: "/about-us/" },
  { header: "edb0eacaaf8f", footer: "eacacdcdfaec", path: "/contact/" },
  { header: "e051e670d406", footer: "b3b875b5ee47", path: "/donate/" },
  { header: "8c0a880ace6b", footer: "0deaa75ac4e9", path: "/resources/" }
];

for (const { header, footer, path } of PAIRS) {
  test(`the original menu renders the ${path} header and footer byte for byte`, () => {
    assert.equal(renderNavigation(fragment(header), path, ORIGINAL_NAV), fragment(header));
    assert.equal(renderNavigation(fragment(footer), path, ORIGINAL_NAV), fragment(footer));
  });
}

// The Resources page's header and footer: the composed pages (/classes/, /articles/) use them.
const RESOURCES_HEADER = fragment("8c0a880ace6b");
const RESOURCES_FOOTER = fragment("0deaa75ac4e9");
const page = (path) => load(renderNavigation(RESOURCES_HEADER, path, NAV) + renderNavigation(RESOURCES_FOOTER, path, NAV));
const text = ($, el) => $(el).text().trim();
const labels = ($, list, selector) => $(list).find(selector).toArray().map((el) => text($, el));

test("on /classes/ only Classes is current, and Resources is its current ancestor", () => {
  const $ = page("/classes/");
  for (const list of ["#menu-main-menu-links", "#menu-mobile-menu", "#menu-mobile-menu-1"]) {
    const current = $(list).find("[aria-current]");
    assert.equal(current.length, 1, list);
    assert.equal(current.attr("aria-current"), "page");
    assert.equal(current.attr("href"), "/classes/");
    assert.equal(text($, current), "Classes");
    // The footer reuses the mobile menu's ids, as WordPress did (menu-item-343…).
    assert.match(current.parent().attr("class"), list === "#menu-main-menu-links"
      ? /^menu-item current-menu-item current_page_item menu-item-tz-classes$/
      : /^menu-item current-menu-item current_page_item menu-item-tz-classes-mobile$/);
    assert.equal($(list).find(".current-menu-item").length, 1, list);
    const ancestors = $(list).find(".current-menu-ancestor");
    assert.equal(ancestors.length, 1, list);
    assert.ok(ancestors.is(".tz-menu-parent, .tz-menu-group"), list);
    assert.equal(ancestors.find("[aria-current]").length, 1, list);
  }
  assert.equal($("#menu-item-33").attr("class"), "menu-item tz-menu-parent current-menu-ancestor menu-item-33");
  assert.equal($("#menu-main-menu-buttons [aria-current], #menu-main-menu-buttons .current-menu-item").length, 0);
});

test("the desktop menu reads Home, About, Resources, Classes, Articles, Gallery, Contact", () => {
  const $ = page("/");
  assert.deepEqual(labels($, "#menu-main-menu-links", "a, button"), ["Home", "About", "Resources", "Classes", "Articles", "Gallery", "Contact"]);
  // Resources is a toggle for its panel, not a link.
  const toggle = $("#menu-item-33 > button.tz-submenu-toggle");
  assert.equal(toggle.attr("type"), "button");
  assert.equal(toggle.attr("aria-expanded"), "false");
  assert.equal(toggle.attr("aria-controls"), "tz-sub-resources");
  assert.equal($("#tz-sub-resources").is("ul.tz-sub-menu"), true);
  assert.equal($("#menu-item-33").next().is("#menu-item-tz-gallery"), true);
  assert.equal($("#menu-item-tz-gallery").next().is("#menu-item-32"), true);
  assert.equal($("#menu-item-tz-gallery > a").attr("href"), "/gallery/");
  // The theme's dropdown scripts (global.js slideToggle, a11y-menu) only look for these.
  assert.equal($(".menu-item-has-children, .sub-menu").length, 0);
});

test("the mobile menu reads Home, About, Resources, Classes, Articles, Gallery, Contact, Donate, Taste a Class", () => {
  const $ = page("/");
  assert.deepEqual(labels($, "#menu-mobile-menu", "a, button"), ["Home", "About", "Resources", "Classes", "Articles", "Gallery", "Contact", "Donate", "Taste a Class"]);
  assert.equal($("#menu-item-tz-gallery-mobile > a").attr("href"), "/gallery/");
  assert.equal($("#menu-item-342 > button").attr("aria-controls"), "tz-sub-resources-mobile");
  assert.equal($("#tz-sub-resources-mobile").is("ul.tz-sub-menu"), true);
});

test("the footer Quick Links read Home, About, Resources, Classes, Articles, Gallery, Contact, Donate, Taste a Class", () => {
  const $ = page("/");
  assert.deepEqual(labels($, "#menu-mobile-menu-1", "a, .tz-menu-group-label"), ["Home", "About", "Resources", "Classes", "Articles", "Gallery", "Contact", "Donate", "Taste a Class"]);
  // Resources is a heading over its two pages here, not a link or a button, and it names their list.
  const label = $("#menu-mobile-menu-1 .tz-menu-group > .tz-menu-group-label");
  assert.equal(label.text(), "Resources");
  assert.equal(label.attr("id"), "tz-group-resources");
  assert.equal($("#menu-mobile-menu-1 .tz-menu-group > ul.tz-sub-menu").attr("aria-labelledby"), "tz-group-resources");
  assert.equal($("#menu-mobile-menu-1 button").length, 0);
});

test("a fragment whose menu or header button has moved fails loudly, naming the marker", () => {
  const change = (html, from, to) => {
    assert.ok(html.includes(from), from);
    return html.replace(from, to);
  };
  const cases = [
    [RESOURCES_HEADER, '<ul id="menu-main-menu-links"', '<ul id="menu-main"'],
    [RESOURCES_HEADER, '<ul id="menu-mobile-menu"', '<ul id="menu-mobile"'],
    [RESOURCES_HEADER, '<li id="menu-item-504" class="', '<li class="'],
    [RESOURCES_HEADER, '<li id="menu-item-11" class="nav-button', '<li id="menu-item-11" data-x="1" class="nav-button'],
    [RESOURCES_FOOTER, '<ul id="menu-mobile-menu-1"', '<ul id="menu-footer"']
  ];
  for (const [html, from, to] of cases) {
    const marker = from.startsWith("<ul") ? from : `<li id="${from.match(/menu-item-\d+/)[0]}" class="…"><a …>`;
    assert.throws(() => renderNavigation(change(html, from, to), "/"), { message: `navigation: marker not found: ${marker}` }, from);
    assert.throws(() => renderNavigation(change(html, from, to), "", ORIGINAL_NAV), { message: `navigation: marker not found: ${marker}` }, from);
  }
  assert.throws(() => renderNavigation(RESOURCES_HEADER.replace("</ul></nav></div></header>", '</ul></nav><ul id="menu-mobile-menu"></ul></div></header>'), "/"),
    { message: 'navigation: marker not unique: <ul id="menu-mobile-menu"' });
  assert.throws(() => renderNavigation("<div>no menu here</div>", "/"),
    { message: 'navigation: marker not found: <header class="site-header" or id="genesis-footer-widgets"' });
});

test("the header buttons still read Taste A Class and Donate, and only their current marking changes", () => {
  const buttons = ($) => $("#menu-main-menu-buttons").toString();
  const original = load(RESOURCES_HEADER);
  assert.deepEqual(labels(original, "#menu-main-menu-buttons", "a"), ["Taste A Class", "Donate"]);
  assert.equal(buttons(load(renderNavigation(RESOURCES_HEADER, "/classes/"))), buttons(original));
  const donate = load(renderNavigation(RESOURCES_HEADER, "/donate/"));
  assert.deepEqual(labels(donate, "#menu-main-menu-buttons", "a"), ["Taste A Class", "Donate"]);
  assert.equal(buttons(donate), buttons(load(fragment("e051e670d406"))));
  // The Donate page's own header loses the marking on any other page.
  assert.equal(buttons(load(renderNavigation(fragment("e051e670d406"), "/"))), buttons(original));
});

test("every new id in the header is unique", () => {
  const $ = load(renderNavigation(RESOURCES_HEADER, "/"));
  const ids = $("[id]").toArray().map((el) => el.attribs.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("Home is current on /, Articles on both Articles pages, Gallery on /gallery/, and nothing on a page outside the menu", () => {
  const current = (path) => labels(page(path), "#menu-main-menu-links, #menu-mobile-menu, #menu-mobile-menu-1", "[aria-current]");
  assert.deepEqual(current("/"), ["Home", "Home", "Home"]);
  assert.deepEqual(current("/articles/"), ["Articles", "Articles", "Articles"]);
  assert.deepEqual(current("/articles/page/2/"), ["Articles", "Articles", "Articles"]);
  assert.deepEqual(current("/gallery/"), ["Gallery", "Gallery", "Gallery"]);
  assert.deepEqual(current("/donate/"), ["Donate", "Donate"]);
  // The 404 page and the Parasha posts.
  for (const path of ["", "/parshat-noach-october-8-9-2021/"]) {
    const $ = page(path);
    assert.equal($("[aria-current], .current-menu-item, .current-menu-ancestor").length, 0, path);
  }
});

test("rendering twice gives the same menus", () => {
  const once = renderNavigation(RESOURCES_HEADER, "/classes/");
  assert.equal(renderNavigation(once, "/classes/"), once);
  const footer = renderNavigation(RESOURCES_FOOTER, "/classes/");
  assert.equal(renderNavigation(footer, "/classes/"), footer);
});

test("rewriteLinks points the old Resources and /about/ links at their new homes", () => {
  assert.equal(rewriteLinks('<a href="/resources/">ENRICH YOUR LIFE</a>'), '<a href="/classes/">ENRICH YOUR LIFE</a>');
  assert.equal(rewriteLinks('<a class="b" href="/about/">Read my full story</a>'), '<a class="b" href="/about-us/">Read my full story</a>');
  // Exact matches only.
  const others = '<a href="/about-us/">x</a><a href="/resources/page/2/">y</a><img src="/resources/">';
  assert.equal(rewriteLinks(others), others);
});

test("stripRemovedUrls points the Parasha author's removed archive (escaped slashes) at the site root", () => {
  const post = JSON.parse(read("content/pages/parshat-noach-october-8-9-2021.json"));
  const json = post.head.find((item) => item.t === "jsonld").json;
  assert.ok(json.includes('"url": "https:\\/\\/tzionbreslov.com\\/author\\/esti-wolo\\/"'));
  const stripped = stripRemovedUrls(json);
  assert.ok(!stripped.includes("esti-wolo\\/"));
  const person = JSON.parse(stripped)["@graph"].find((node) => node["@type"] === "Person");
  assert.equal(person.url, "https://tzionbreslov.com/");
  // Everything else is left as it was.
  assert.equal(stripped, json.replace("https:\\/\\/tzionbreslov.com\\/author\\/esti-wolo\\/", "https:\\/\\/tzionbreslov.com\\/"));
  assert.equal(stripRemovedUrls('{"u":"https://tzionbreslov.com/resources/page/2/","v":"https://tzionbreslov.com/about-us/"}'),
    '{"u":"https://tzionbreslov.com/","v":"https://tzionbreslov.com/about-us/"}');
});

// The site's menus: the header's desktop and mobile menus and the footer's
// Quick Links, rendered from one list into the imported header and footer HTML
// (content/fragments) for the page being built. ORIGINAL_NAV is the WordPress
// menu exactly as imported (scripts/navigation.test.mjs proves it renders every
// fragment byte for byte); NAV is the site's menu now. Existing labels stay
// as they were; new ones come from content/copy/en.json.
import copy from "../content/copy/en.json" with { type: "json" };
import { LINK_REWRITES } from "../config/site-structure.mjs";

const TASTE_A_CLASS = "https://youtu.be/MELvfMA8_Uc";

const ABOUT = {
  key: "about", href: "/about-us/", pageId: 26, type: "post_type",
  desktop: { id: 34, label: "About" }, mobile: { id: 343, label: "About" }, footer: { label: "About" }
};
const CONTACT = {
  key: "contact", href: "/contact/", pageId: 29, type: "post_type",
  desktop: { id: 32, label: "Contact" }, mobile: { id: 341, label: "Contact" }, footer: { label: "Contact" }
};
// In the desktop header these two are the buttons (menu-item-504, menu-item-11), outside the menu.
const DONATE = {
  key: "donate", href: "/donate/", pageId: 345, type: "post_type",
  mobile: { id: 347, label: "Donate" }, footer: { label: "Donate" }
};
const TASTE = {
  key: "taste-a-class", href: TASTE_A_CLASS, type: "custom", target: "_blank",
  mobile: { id: 348, label: "Taste a Class" }, footer: { label: "Taste a Class" }
};

/** The WordPress menu as imported. */
export const ORIGINAL_NAV = [
  ABOUT,
  {
    key: "resources", href: "/resources/", pageId: 28, type: "post_type",
    desktop: { id: 33, label: "Resources" }, mobile: { id: 342, label: "Resources" }, footer: { label: "Resources" }
  },
  CONTACT,
  DONATE,
  TASTE
];

const { nav } = copy;
// New items get their own ids, a different one in the mobile menu (both menus are in the same header).
const page = (key, href, label) => ({
  key, href, type: "custom",
  desktop: { id: `tz-${key}`, label }, mobile: { id: `tz-${key}-mobile`, label }, footer: { label }
});

/** The site's menu. */
export const NAV = [
  page("home", "/", nav.home),
  ABOUT,
  {
    key: "resources", type: "custom",
    desktop: { id: 33, label: "Resources" }, mobile: { id: 342, label: "Resources" }, footer: { label: "Resources" },
    children: [page("classes", "/classes/", nav.classes), page("articles", "/articles/", nav.articles)]
  },
  CONTACT,
  DONATE,
  TASTE
];

/** The three menus, by the id of their list. */
const MENUS = [
  { list: "menu-main-menu-links", view: "desktop" },
  { list: "menu-mobile-menu", view: "mobile" },
  { list: "menu-mobile-menu-1", view: "footer" }
];
/** The desktop header's buttons: only their current marking is managed here. */
const HEADER_BUTTONS = [{ id: 11, key: "taste-a-class" }, { id: 504, key: "donate" }];

const TYPE_CLASSES = { post_type: "menu-item-type-post_type menu-item-object-page", custom: "menu-item-type-custom menu-item-object-custom" };
const CURRENT_MARK = / current-menu-item(?: page_item page-item-\d+)? current_page_item(?= )/;

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** "/articles/page/2/" is part of "/articles/". */
const pageOf = (path) => path.replace(/page\/\d+\/$/, "");
const isCurrent = (item, path) => item.href !== undefined && item.href === pageOf(path);
const currentClasses = (item) =>
  item.pageId === undefined ? "current-menu-item current_page_item" : `current-menu-item page_item page-item-${item.pageId} current_page_item`;
const classes = (...names) => names.filter(Boolean).join(" ");

/** Desktop labels sit in a <span>; mobile and footer labels don't. */
function link(item, label, current, span) {
  const target = item.target ? ` target="${item.target}"` : "";
  const aria = current ? ' aria-current="page"' : "";
  return `<a${target} href="${esc(item.href)}"${aria}>${span ? `<span>${esc(label)}</span>` : esc(label)}</a>`;
}

/** The id WordPress gave the item in this menu (footer items reuse the mobile menu's, without an id attribute). */
const itemId = (item, view) => (view === "desktop" ? item.desktop.id : item.mobile?.id ?? `tz-${item.key}`);

function renderChild(item, view, path) {
  const current = isCurrent(item, path);
  const label = item[view]?.label;
  if (!label) return "";
  return `<li class="${classes("menu-item", current && currentClasses(item), `menu-item-${itemId(item, view)}`)}">${link(item, label, current, view !== "footer")}</li>\n`;
}

function renderParent(item, view, path) {
  const ancestor = item.children.some((child) => isCurrent(child, path)) && "current-menu-ancestor";
  const children = item.children.map((child) => renderChild(child, view, path)).join("");
  const label = esc(item[view].label);
  if (view === "footer") {
    return `<li class="${classes("menu-item tz-menu-group", ancestor)}"><span class="tz-menu-group-label">${label}</span><ul class="tz-sub-menu">${children}</ul></li>\n`;
  }
  const id = itemId(item, view);
  const panel = `tz-sub-${item.key}${view === "mobile" ? "-mobile" : ""}`;
  return `<li id="menu-item-${id}" class="${classes("menu-item tz-menu-parent", ancestor, `menu-item-${id}`)}">` +
    `<button type="button" class="tz-submenu-toggle" aria-expanded="false" aria-controls="${panel}"><span>${label}</span></button>` +
    `<ul id="${panel}" class="tz-sub-menu">${children}</ul></li>\n`;
}

function renderItem(item, view, path) {
  if (!item[view]) return "";
  if (item.children) return renderParent(item, view, path);
  const id = itemId(item, view);
  const current = isCurrent(item, path);
  const idAttr = view === "footer" ? "" : ` id="menu-item-${id}"`;
  const cls = classes("menu-item", TYPE_CLASSES[item.type], current && currentClasses(item), `menu-item-${id}`);
  return `<li${idAttr} class="${cls}">${link(item, item[view].label, current, view === "desktop")}</li>\n`;
}

/** Where the `<ul>` whose content starts at `from` closes (nested lists balanced). */
function listEnd(html, from, list) {
  const tags = /<ul\b|<\/ul>/g;
  tags.lastIndex = from;
  let depth = 1;
  for (let tag = tags.exec(html); tag; tag = tags.exec(html)) {
    depth += tag[0] === "</ul>" ? -1 : 1;
    if (depth === 0) return tag.index;
  }
  throw new Error(`navigation: #${list} never closes`);
}

/** Re-marks one header button: current on its own page, plain everywhere else. */
function markButton(html, id, item, path) {
  const open = new RegExp(`<li id="menu-item-${id}" class="([^"]*)"><a ([^>]*)>`);
  return html.replace(open, (_, cls, attrs) => {
    const current = Boolean(item) && isCurrent(item, path);
    let plain = cls.replace(CURRENT_MARK, "");
    if (current) plain = plain.replace(new RegExp(`(^| )(menu-item-${id})$`), `$1${currentClasses(item)} $2`);
    const a = attrs.replace(/ aria-current="page"/, "") + (current ? ' aria-current="page"' : "");
    return `<li id="menu-item-${id}" class="${plain}"><a ${a}>`;
  });
}

/**
 * Renders `items` into every menu in `html` (a header or footer fragment) for
 * the page at `currentPath`: the desktop menu (ul#menu-main-menu-links), the
 * mobile menu (ul#menu-mobile-menu) and the footer Quick Links
 * (ul#menu-mobile-menu-1) are rebuilt; the desktop buttons keep their markup
 * and only get or lose the current marking. A path that is in no menu (the 404
 * page passes "") marks nothing.
 */
export function renderNavigation(html, currentPath, items = NAV) {
  let out = html;
  let found = 0;
  for (const { list, view } of MENUS) {
    const marker = `<ul id="${list}"`;
    const at = out.indexOf(marker);
    if (at < 0) continue;
    if (out.includes(marker, at + 1)) throw new Error(`navigation: #${list} occurs twice`);
    found++;
    const start = out.indexOf(">", at) + 1;
    const end = listEnd(out, start, list);
    out = out.slice(0, start) + items.map((item) => renderItem(item, view, currentPath)).join("") + out.slice(end);
  }
  if (!found) throw new Error("navigation: no menu found to render");
  const all = items.flatMap((item) => [item, ...(item.children ?? [])]);
  for (const { id, key } of HEADER_BUTTONS) out = markButton(out, id, all.find((item) => item.key === key), currentPath);
  return out;
}

/** Points links at removed pages (exact `href` values, LINK_REWRITES) at their new homes. */
export function rewriteLinks(html) {
  return html.replace(/(?<![\w-])href="([^"]*)"/g, (match, url) =>
    Object.hasOwn(LINK_REWRITES, url) ? `href="${LINK_REWRITES[url]}"` : match);
}

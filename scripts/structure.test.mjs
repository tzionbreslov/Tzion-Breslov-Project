import { strict as assert } from "node:assert";
import fs from "node:fs";
import test from "node:test";
import { isRemovedPath, LINK_REWRITES, NEW_ROUTES, REMOVED_PATHS, REMOVED_SECTIONS, REMOVED_SITEMAPS, siteRoutes } from "../config/site-structure.mjs";

const routesJson = () => JSON.parse(fs.readFileSync(new URL("../content/routes.json", import.meta.url), "utf8"));
const paths = (index) => index.routes.map((route) => route.path);
// The module's lists switched off, for tests about one list at a time.
const none = { removed: [], sections: [], newRoutes: [] };

test("the removed pages are exactly the ones the owner asked to remove", () => {
  assert.deepEqual(REMOVED_PATHS, [
    "/resources/", "/resources/page/2/", "/resources/page/3/",
    ...Array.from({ length: 27 }, (_, i) => `/video/video-${i + 1}/`),
    "/category/uncategorized/", "/category/uncategorized/page/2/",
    "/author/esti-wolo/", "/author/esti-wolo/page/2/",
    "/about/"
  ]);
  assert.deepEqual(REMOVED_SECTIONS, ["/video/", "/category/", "/author/", "/resources/"]);
  assert.deepEqual(LINK_REWRITES, { "/resources/": "/classes/", "/about/": "/about-us/" });
  assert.deepEqual(REMOVED_SITEMAPS, ["video-sitemap.xml", "category-sitemap.xml", "author-sitemap.xml"]);
});

test("siteRoutes serves the imported pages that are kept, then the new pages", () => {
  const raw = routesJson();
  const index = siteRoutes(raw);
  const kept = paths(raw).filter((path) => !isRemovedPath(path));
  assert.deepEqual(paths(index), [...kept, "/articles/", "/articles/page/2/", "/classes/", "/gallery/", "/events/", "/privacy/"]);
  assert.deepEqual(index.routes.slice(-6), [
    { path: "/articles/", key: "tz:articles" },
    { path: "/articles/page/2/", key: "tz:articles__page__2" },
    { path: "/classes/", key: "tz:classes" },
    { path: "/gallery/", key: "tz:gallery" },
    { path: "/events/", key: "tz:events" },
    { path: "/privacy/", key: "tz:privacy" }
  ]);
  // Home, About, Contact, Donate and the 18 Parasha posts.
  assert.equal(kept.length, 22);
  assert.ok(paths(index).every((path) => !/^\/(resources|video|category|author)\//.test(path)));
  assert.equal(index.site, raw.site);
  // /about/ was the only redirect page; it is removed, not forwarded.
  assert.deepEqual(index.redirects, {});
});

test("siteRoutes never duplicates a path; the routes.json entry wins", () => {
  const raw = routesJson();
  const newRoutes = [
    { path: "/contact/", key: "tz:contact" },
    { path: "/articles/", key: "tz:articles" },
    { path: "/articles/", key: "tz:articles-again" }
  ];
  const index = siteRoutes(raw, { ...none, newRoutes });
  const all = paths(index);
  assert.equal(new Set(all).size, all.length);
  assert.equal(index.routes.find((route) => route.path === "/contact/").key, "contact");
  assert.equal(index.routes.find((route) => route.path === "/articles/").key, "tz:articles");
  assert.equal(all.length, raw.routes.length + 1);
});

test("siteRoutes drops a removed path from the routes and the redirects", () => {
  const raw = routesJson();
  const index = siteRoutes(raw, { ...none, removed: ["/about/", "/about-us/"] });
  assert.ok(!paths(index).includes("/about-us/"));
  assert.ok(!paths(index).includes("/about/"));
  assert.ok(!("/about/" in index.redirects));
  assert.equal(index.routes.length, raw.routes.length - 1);
  // The input is left untouched (the scripts and Next share it).
  assert.ok(paths(raw).includes("/about-us/"));
  assert.equal(raw.redirects["/about/"], "/about-us/");
});

test("siteRoutes with only /about/ removed keeps every page but drops its redirect", () => {
  const raw = routesJson();
  const index = siteRoutes(raw, { ...none, removed: ["/about/"] });
  assert.deepEqual(paths(index), paths(raw));
  assert.deepEqual(index.redirects, {});
});

test("isRemovedPath follows the lists given", () => {
  assert.equal(isRemovedPath("/video/video-3/", [], []), false);
  assert.equal(isRemovedPath("/video/video-3/", ["/video/video-3/"], []), true);
  assert.equal(isRemovedPath("/video/video-3/", ["/video/video-1/", "/resources/"], []), false);
  assert.equal(isRemovedPath("/video/video-3/", [], ["/video/"]), true);
});

test("isRemovedPath covers the listed pages and anything under a removed section", () => {
  for (const path of REMOVED_PATHS) assert.equal(isRemovedPath(path), true, path);
  for (const path of ["/video/", "/video/video-28/", "/category/news/", "/author/someone/page/3/", "/resources/page/4/"]) {
    assert.equal(isRemovedPath(path), true, path);
  }
  for (const path of ["/", "/about-us/", "/about/team/", "/classes/", "/articles/", "/articles/page/2/", "/gallery/", "/contact/", "/donate/",
    "/parshat-noach-october-8-9-2021/", "/videos/", "/resources-old/"]) {
    assert.equal(isRemovedPath(path), false, path);
  }
});

test("composed pages use tz: keys", () => {
  assert.ok(NEW_ROUTES.every((route) => route.key.startsWith("tz:")));
});

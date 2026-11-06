import { strict as assert } from "node:assert";
import fs from "node:fs";
import test from "node:test";
import { isRemovedPath, NEW_ROUTES, REMOVED_PATHS, siteRoutes } from "../config/site-structure.mjs";

const routesJson = () => JSON.parse(fs.readFileSync(new URL("../content/routes.json", import.meta.url), "utf8"));
const paths = (index) => index.routes.map((route) => route.path);

test("siteRoutes appends the new pages after the routes.json routes", () => {
  const raw = routesJson();
  const index = siteRoutes(raw);
  assert.deepEqual(paths(index), [...paths(raw), "/articles/", "/articles/page/2/"]);
  assert.deepEqual(index.routes.slice(-2), [
    { path: "/articles/", key: "tz:articles" },
    { path: "/articles/page/2/", key: "tz:articles__page__2" }
  ]);
  assert.equal(index.site, raw.site);
  assert.deepEqual(index.redirects, raw.redirects);
});

test("siteRoutes never duplicates a path; the routes.json entry wins", () => {
  const raw = routesJson();
  const newRoutes = [
    { path: "/contact/", key: "tz:contact" },
    { path: "/articles/", key: "tz:articles" },
    { path: "/articles/", key: "tz:articles-again" }
  ];
  const index = siteRoutes(raw, { newRoutes });
  const all = paths(index);
  assert.equal(new Set(all).size, all.length);
  assert.equal(index.routes.find((route) => route.path === "/contact/").key, "contact");
  assert.equal(index.routes.find((route) => route.path === "/articles/").key, "tz:articles");
  assert.equal(all.length, raw.routes.length + 1);
});

test("siteRoutes drops a removed path from the routes and the redirects", () => {
  const raw = routesJson();
  const removed = ["/about/", "/about-us/"];
  const index = siteRoutes(raw, { removed, newRoutes: [] });
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
  const index = siteRoutes(raw, { removed: ["/about/"], newRoutes: [] });
  assert.deepEqual(paths(index), paths(raw));
  assert.deepEqual(index.redirects, {});
});

test("isRemovedPath follows the list given", () => {
  assert.deepEqual(REMOVED_PATHS, []);
  assert.equal(isRemovedPath("/video/video-3/"), false);
  assert.equal(isRemovedPath("/video/video-3/", ["/video/video-3/"]), true);
  assert.equal(isRemovedPath("/video/video-3/", ["/video/video-1/", "/resources/"]), false);
});

test("composed pages use tz: keys", () => {
  assert.ok(NEW_ROUTES.every((route) => route.key.startsWith("tz:")));
});

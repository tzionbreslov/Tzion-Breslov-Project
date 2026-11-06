import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { classifyGraphError, mapMedia, mediaUrl, parseMediaPage } from "./lib/instagram-feed.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

test("builds the media URL and rejects bad configuration", () => {
  const url = new URL(mediaUrl({ version: "v27.0", userId: "17841400000000000" }));
  assert.equal(url.origin + url.pathname, "https://graph.facebook.com/v27.0/17841400000000000/media");
  assert.match(url.searchParams.get("fields"), /children\{id,media_type,media_url,thumbnail_url\}/);
  assert.equal(url.searchParams.has("access_token"), false);
  assert.throws(() => mediaUrl({ version: "27", userId: "17841400000000000" }), /INSTAGRAM_API_VERSION/);
  assert.throws(() => mediaUrl({ version: "v27.0", userId: "@tzion" }), /INSTAGRAM_USER_ID/);
  assert.throws(() => mediaUrl({ host: "evil.example", version: "v27.0", userId: "17841400000000000" }), /INSTAGRAM_API_HOST/);
});

test("classifies Graph errors: dead token vs outage vs bad data", () => {
  assert.equal(classifyGraphError(400, { error: { code: 190 } }), "token");
  assert.equal(classifyGraphError(403, { error: { code: 10 } }), "token");
  assert.equal(classifyGraphError(400, { error: { code: 4 } }), "outage");
  assert.equal(classifyGraphError(400, { error: { code: 80002 } }), "outage");
  assert.equal(classifyGraphError(503, null), "outage");
  assert.equal(classifyGraphError(400, { error: { code: 100 } }), "malformed");
});

test("validates pages", () => {
  assert.deepEqual(parseMediaPage({ data: [] }), { items: [], next: null });
  assert.throws(() => parseMediaPage({}), /no data array/);
  assert.throws(() => parseMediaPage({ data: [], paging: { next: "https://evil.example/x" } }), /paging\.next/);
});

test("maps images, carousels (incl. video children) and reels", () => {
  const image = mapMedia({ id: "17900000000000001", media_type: "IMAGE", media_url: "https://cdn/1.jpg", permalink: "https://www.instagram.com/p/AAA/?igsh=x", timestamp: "2026-11-01T10:00:00+0000", caption: "Hi", alt_text: "alt" });
  assert.equal(image.post.type, "image");
  assert.equal(image.post.permalink, "https://www.instagram.com/p/AAA/");
  assert.equal(image.post.alt, "alt");
  assert.deepEqual(image.remote, [{ key: "17900000000000001", url: "https://cdn/1.jpg" }]);

  const album = mapMedia({ id: "17900000000000002", media_type: "CAROUSEL_ALBUM", permalink: "https://www.instagram.com/p/BBB/", timestamp: "2026-10-28T10:00:00Z",
    children: { data: [{ id: "17900000000000021", media_type: "IMAGE", media_url: "https://cdn/21.jpg" }, { id: "17900000000000022", media_type: "VIDEO", thumbnail_url: "https://cdn/22.jpg", media_url: "https://cdn/22.mp4" }] } });
  assert.equal(album.post.type, "carousel");
  assert.deepEqual(album.remote.map((r) => r.url), ["https://cdn/21.jpg", "https://cdn/22.jpg"]);
  assert.equal(album.post.caption, "");

  const reel = mapMedia({ id: "17900000000000003", media_type: "VIDEO", thumbnail_url: "https://cdn/3.jpg", permalink: "https://www.instagram.com/reel/CCC/", timestamp: "2026-10-20T10:00:00Z" });
  assert.equal(reel.post.type, "reel");
  assert.deepEqual(reel.remote.map((r) => r.url), ["https://cdn/3.jpg"]);
});

test("skips posts it cannot show safely", () => {
  assert.match(mapMedia({ id: "17900000000000009", media_type: "IMAGE", media_url: "https://cdn/x.jpg", permalink: "https://evil.example/p/x/", timestamp: "2026-01-01T00:00:00Z" }).skip, /permalink/);
  assert.match(mapMedia({ id: "17900000000000009", media_type: "VIDEO", permalink: "https://www.instagram.com/reel/X/", timestamp: "2026-01-01T00:00:00Z" }).skip, /no usable image/);
  assert.throws(() => mapMedia({ id: "abc" }), /valid id/);
});

// End-to-end: the real script against a fake Graph API (scripts/fixtures/mock-graph.mjs).
function runSync(scenario, extraEnv = {}, args = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tz-ig-"));
  fs.mkdirSync(path.join(dir, "content"));
  fs.mkdirSync(path.join(dir, "public", "media", "instagram"), { recursive: true });
  const seed = { username: "tzionbreslovproject", name: "R David Kalmus", profileUrl: "https://www.instagram.com/tzionbreslovproject/", avatar: "/media/instagram/avatar.jpg", perPage: 9, syncedAt: "previous", posts: [{ id: "1", permalink: "https://www.instagram.com/p/OLD/", type: "image", caption: "old", timestamp: "2025-01-01T00:00:00.000Z", media: [] }] };
  fs.writeFileSync(path.join(dir, "content", "instagram.json"), JSON.stringify(seed));
  fs.writeFileSync(path.join(dir, "public", "media", "instagram", "stale.webp"), "x");
  const summary = path.join(dir, "summary.md");
  const env = { ...process.env, INSTAGRAM_SYNC_ROOT: dir, MOCK_GRAPH: scenario, INSTAGRAM_ACCESS_TOKEN: "test-token-not-real", INSTAGRAM_USER_ID: "17841400000000000", INSTAGRAM_API_VERSION: "v27.0", GITHUB_STEP_SUMMARY: summary, INSTAGRAM_RETRY_DELAY_MS: "0", ...extraEnv };
  const res = spawnSync(process.execPath, ["--import", pathToFileURL(path.join(here, "fixtures", "mock-graph.mjs")).href, path.join(here, "sync-instagram.mjs"), ...args], { env, encoding: "utf8" });
  const data = JSON.parse(fs.readFileSync(path.join(dir, "content", "instagram.json"), "utf8"));
  const files = fs.readdirSync(path.join(dir, "public", "media", "instagram")).sort();
  const out = { code: res.status, stdout: res.stdout + res.stderr, data, files, summary: fs.existsSync(summary) ? fs.readFileSync(summary, "utf8") : "" };
  fs.rmSync(dir, { recursive: true, force: true });
  return out;
}

test("sync: downloads, converts and writes posts; prunes stale images; never prints the token", () => {
  const r = runSync("ok");
  assert.equal(r.code, 0, r.stdout);
  assert.deepEqual(r.data.posts.map((p) => p.type), ["image", "carousel", "reel"]);
  assert.equal(r.data.posts[0].media[0].alt, "Rabbi teaching");
  assert.deepEqual(r.data.posts[0].media[0], { src: "/media/instagram/17900000000000001.webp", width: 1080, height: 1350, alt: "Rabbi teaching" });
  assert.equal(r.data.posts[1].media.length, 2);
  assert.deepEqual(r.files, ["17900000000000001.webp", "17900000000000003.webp", "17900000000000021.webp", "17900000000000022.webp"]);
  assert.match(r.stdout, /skipped post 17900000000000004: unexpected permalink/);
  assert.doesNotMatch(r.stdout, /test-token-not-real/);
});

test("sync: dead token keeps data, exits 0 and writes the step summary", () => {
  const r = runSync("token");
  assert.equal(r.code, 0, r.stdout);
  assert.equal(r.data.syncedAt, "previous");
  assert.match(r.summary, /Instagram token must be regenerated/);
  assert.doesNotMatch(r.stdout + r.summary, /test-token-not-real/);
});

test("sync: outage keeps data and exits 0; --strict makes it fatal", () => {
  const r = runSync("outage");
  assert.equal(r.code, 0, r.stdout);
  assert.equal(r.data.syncedAt, "previous");
  assert.match(r.stdout, /unavailable/);
  const strict = runSync("outage", {}, ["--strict"]);
  assert.equal(strict.code, 1);
  assert.equal(strict.data.syncedAt, "previous");
});

test("sync: malformed payload fails; missing token skips", () => {
  assert.equal(runSync("malformed").code, 1);
  const skipped = runSync("ok", { INSTAGRAM_ACCESS_TOKEN: "" });
  assert.equal(skipped.code, 0);
  assert.equal(skipped.data.syncedAt, "previous");
  assert.match(skipped.stdout, /not set/);
});

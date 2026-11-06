#!/usr/bin/env node
// Refreshes content/instagram.json + public/media/instagram/*.webp from Meta's
// official Instagram API, at build time only (visitors never contact Meta).
//
//   INSTAGRAM_ACCESS_TOKEN=… INSTAGRAM_USER_ID=… INSTAGRAM_API_VERSION=v27.0 npm run sync:instagram
//   npm run sync:instagram -- --strict      # every problem is fatal (local checks)
//
// Optional: INSTAGRAM_API_HOST (graph.facebook.com | graph.instagram.com), INSTAGRAM_MAX_POSTS (default 60).
// Setup steps: docs/instagram-setup.md. Failure policy (same spirit as the YouTube sync):
//   no token → skip · outage/rate limit → warn, keep data · dead token → ::error + step summary,
//   keep data · malformed payload → fail. The token and any URL containing it are never printed.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { classifyGraphError, localImagePath, mapMedia, mediaUrl, parseMediaPage } from "./lib/instagram-feed.mjs";

// INSTAGRAM_SYNC_ROOT exists for scripts/instagram-sync.test.mjs (runs against a temp copy).
const root = process.env.INSTAGRAM_SYNC_ROOT ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataFile = path.join(root, "content", "instagram.json");
const mediaDir = path.join(root, "public", "media", "instagram");
const strict = process.argv.includes("--strict");
const gha = Boolean(process.env.GITHUB_ACTIONS);

const token = process.env.INSTAGRAM_ACCESS_TOKEN?.trim();
const userId = process.env.INSTAGRAM_USER_ID?.trim();
const version = process.env.INSTAGRAM_API_VERSION?.trim() || "v27.0";
const host = process.env.INSTAGRAM_API_HOST?.trim() || "graph.facebook.com";
const maxPosts = Math.min(Math.max(Number(process.env.INSTAGRAM_MAX_POSTS ?? 60) || 60, 1), 200);
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const RETRY_MS = Number(process.env.INSTAGRAM_RETRY_DELAY_MS ?? 4_000);

const notice = (m) => console.log(gha ? `::notice title=Instagram feed::${m}` : `notice: ${m}`);
const warn = (m) => console.warn(gha ? `::warning title=Instagram feed::${m}` : `warning: ${m}`);
const tokenError = (m) => {
  console.error(gha ? `::error title=Instagram token::${m}` : `error: ${m}`);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n### Instagram token must be regenerated\n${m}\nSee docs/instagram-setup.md → "When the token stops working". The site kept its last good posts.\n`);
};
/** Ends the run without changing anything; fatal only with --strict. */
const keep = (kind, message) => {
  if (strict) throw new Error(message);
  (kind === "token" ? tokenError : kind === "skip" ? notice : warn)(`${message} — kept the current Instagram data.`);
  process.exit(0);
};

class GraphError extends Error {
  constructor(kind, message) { super(message); this.kind = kind; }
}

async function getJson(url) {
  const withToken = new URL(url);
  withToken.searchParams.set("access_token", token);
  let last;
  for (let attempt = 1; attempt <= 3; attempt++) {
    let res;
    try {
      res = await fetch(withToken, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
    } catch (error) {
      last = new GraphError("outage", `network error (${error instanceof Error ? error.name : "unknown"})`);
      await new Promise((r) => setTimeout(r, attempt * RETRY_MS));
      continue;
    }
    const body = await res.json().catch(() => null);
    if (res.ok) return body;
    const kind = classifyGraphError(res.status, body);
    // Meta's message/type/code are safe to print; the request URL is not.
    last = new GraphError(kind, `HTTP ${res.status} ${body?.error?.type ?? ""} code ${body?.error?.code ?? "?"}: ${String(body?.error?.message ?? "").slice(0, 200)}`.trim());
    if (kind !== "outage") break;
    await new Promise((r) => setTimeout(r, attempt * RETRY_MS));
  }
  throw last;
}

async function download(key, url) {
  const file = path.join(mediaDir, `${key}.webp`);
  if (fs.existsSync(file)) {
    const meta = await sharp(file).metadata();
    return { src: localImagePath(key), width: meta.width, height: meta.height };
  }
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new GraphError("outage", `image ${key}: HTTP ${res.status}`);
  if (!/^image\//.test(res.headers.get("content-type") ?? "")) throw new GraphError("malformed", `image ${key}: not an image`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > MAX_IMAGE_BYTES) throw new GraphError("malformed", `image ${key}: larger than 20 MB`);
  const tmp = `${file}.tmp`;
  const info = await sharp(bytes).rotate().resize({ width: 1080, height: 1350, fit: "inside", withoutEnlargement: true }).webp({ quality: 80 }).toFile(tmp);
  fs.renameSync(tmp, file);
  return { src: localImagePath(key), width: info.width, height: info.height };
}

async function main() {
  if (!token || !userId) return keep("skip", "INSTAGRAM_ACCESS_TOKEN / INSTAGRAM_USER_ID not set (see docs/instagram-setup.md)");
  const current = JSON.parse(fs.readFileSync(dataFile, "utf8"));

  const items = [];
  try {
    let next = mediaUrl({ host, version, userId, limit: Math.min(maxPosts, 50) });
    while (next && items.length < maxPosts) {
      const page = parseMediaPage(await getJson(next));
      items.push(...page.items);
      next = page.next;
    }
  } catch (error) {
    if (error instanceof GraphError && error.kind !== "malformed") return keep(error.kind, `Instagram API ${error.kind === "token" ? "rejected the token" : "unavailable"}: ${error.message}`);
    throw error;
  }

  fs.mkdirSync(mediaDir, { recursive: true });
  const posts = [];
  for (const item of items.slice(0, maxPosts)) {
    const mapped = mapMedia(item);
    if (mapped.skip) { warn(`skipped ${mapped.skip}`); continue; }
    try {
      const media = [];
      for (const r of mapped.remote) media.push(await download(r.key, r.url));
      if (mapped.post.alt && media[0]) media[0].alt = mapped.post.alt;
      // alt_text belongs on the cover image, not the post.
      const post = { ...mapped.post, media };
      delete post.alt;
      posts.push(post);
    } catch (error) {
      if (error instanceof GraphError && error.kind === "outage") return keep("outage", error.message);
      throw error;
    }
  }
  if (items.length && !posts.length) throw new Error("Instagram returned posts but none could be used.");

  // Drop images no post references any more (keeps the committed avatar).
  const used = new Set(posts.flatMap((p) => p.media.map((m) => path.basename(m.src))));
  for (const f of fs.readdirSync(mediaDir)) if (f.endsWith(".webp") && !used.has(f)) fs.rmSync(path.join(mediaDir, f));

  const out = `${JSON.stringify({ ...current, syncedAt: new Date().toISOString(), posts }, null, 2)}\n`;
  fs.writeFileSync(`${dataFile}.tmp`, out);
  fs.renameSync(`${dataFile}.tmp`, dataFile);
  const newest = posts[0]?.timestamp?.slice(0, 10) ?? "none";
  console.log(`instagram.json: ${posts.length} posts (newest ${newest}), ${used.size} images`);
}

main().catch((error) => {
  console.error(gha ? `::error title=Instagram feed::${error.message}` : `error: ${error.message}`);
  process.exit(1);
});

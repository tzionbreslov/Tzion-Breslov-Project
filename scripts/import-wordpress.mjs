#!/usr/bin/env node
// Converts the crawled WordPress snapshot (../golden, produced from the local
// Docker copy of tzionbreslov.com) into the static content this Next.js app
// renders. Output is committed, so builds never need WordPress.
//
//   node scripts/import-wordpress.mjs [--golden ../golden]
//
// Writes:
//   content/routes.json            every route + its page file
//   content/pages/<key>.json       per-route head, body class, main HTML, scripts
//   content/fragments/<hash>.html  shared HTML (header, footer, skip links)
//   content/styles/<hash>.css      inline <style> blocks, de-duplicated
//   content/scripts/<hash>.js      kept inline <script> blocks, de-duplicated
//   content/youtube.json           seed for the Resources YouTube feed
//   public/wp-content, public/wp-includes, public/vendor   referenced assets only

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { load } from "cheerio";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argGolden = process.argv.indexOf("--golden");
const golden = path.resolve(root, argGolden > -1 ? process.argv[argGolden + 1] : "../golden");
const pagesDir = path.join(golden, "pages");
const siteDir = path.join(golden, "site");
const contentDir = path.join(root, "content");
const publicDir = path.join(root, "public");

const LOCAL = "http://localhost:8088";
const PRODUCTION = "https://tzionbreslov.com";

// Scripts that drive visible behaviour and work without WordPress.
const KEEP_SCRIPT = /^(jquery-core|jquery-migrate|a11y-menu|gsap|scrollTrigger|skip-links|global|uagb-[a-z-]+|uag-script-\d+|carousel-block-[a-z-]+)-js(-extra|-before|-after)?$/;
// Stylesheets that only existed for replaced WordPress features.
const DROP_STYLESHEET = new Set(["gravityformsppcp_gravity_theme-css"]);
const DROP_LINK_REL = new Set(["alternate", "EditURI", "pingback", "shortlink", "https://api.w.org/", "wlwmanifest"]);
const DROP_META = new Set(["generator", "viewport"]);
const VENDOR = {
  "//cdnjs.cloudflare.com/ajax/libs/gsap/3.11.5/gsap.min.js": "/vendor/gsap/3.11.5/gsap.min.js",
  "//cdnjs.cloudflare.com/ajax/libs/gsap/3.11.5/ScrollTrigger.min.js": "/vendor/gsap/3.11.5/ScrollTrigger.min.js"
};
// WordPress 301s observed while crawling; emitted as static redirect pages.
const REDIRECTS = { "/about/": "/about-us/" };
const FORM_ISLANDS = { 2: "signup", 3: "contact", 4: "donate" };

const hash = (s) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 12);
// The designer's staging host (tzionbreslov.estiwolo.com) is gone; WordPress still
// pointed the Parasha hero images at it, so they 404 on the live site. The same
// files are in the uploads backup, so serve them locally.
const STAGING = "https://tzionbreslov.estiwolo.com/wp-content/";
const toRelative = (s) => s.replaceAll(STAGING, "/wp-content/").replaceAll(`${LOCAL}/`, "/").replaceAll(LOCAL, "/").replaceAll("http:\\/\\/localhost:8088\\/", "\\/").replaceAll("http:\\/\\/localhost:8088", "\\/");
const toAbsolute = (s) => s.replaceAll(LOCAL, PRODUCTION).replaceAll("http:\\/\\/localhost:8088", "https:\\/\\/tzionbreslov.com");

function resetDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

function writeShared(kind, ext, text) {
  const id = `${hash(text)}${ext}`;
  const file = path.join(contentDir, kind, id);
  if (!fs.existsSync(file)) fs.writeFileSync(file, text);
  return `${kind}/${id}`;
}

function listPages() {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === "index.html") out.push(full);
    }
  };
  walk(pagesDir);
  return out;
}

function routeOf(file) {
  const rel = path.relative(pagesDir, path.dirname(file)).split(path.sep).filter(Boolean);
  if (rel.length === 1 && rel[0] === "404") return { path: null, key: "404" };
  return { path: rel.length ? `/${rel.join("/")}/` : "/", key: rel.length ? rel.join("__") : "index" };
}

function attrs(el) {
  return { ...el.attribs };
}

function scriptId(el) {
  return el.attribs.id ?? "";
}

/** Replace a Gravity Form with a placeholder or a cleaned, API-ready form. */
function processForms($, islands) {
  $(".gform_wrapper").each((_, wrapper) => {
    const id = Number((wrapper.attribs.id ?? "").replace("gform_wrapper_", ""));
    const kind = FORM_ISLANDS[id];
    $(`#gform_ajax_frame_${id}`).remove();
    if (!kind) {
      $(wrapper).remove();
      return;
    }
    islands.add(kind);
    if (kind === "donate") {
      $(wrapper).replaceWith(`<div class="tz-island tz-donate" data-tz-island="donate"></div>`);
      return;
    }
    const form = $(wrapper).find("form");
    for (const attr of ["action", "target", "enctype", "data-formid"]) form.removeAttr(attr);
    form.attr("data-tz-form", kind).attr("novalidate", "novalidate");
    form.find("input[type=hidden]").remove();
    form.find(".gform_validation_container").remove();
    form.find("[onclick]").removeAttr("onclick");
    form.find("[onkeypress]").removeAttr("onkeypress");
    form.find(".gform_ajax_spinner").remove();
  });
  // Spinner + init scripts that Gravity Forms prints next to its forms.
  $("script").each((_, el) => {
    if (!el.attribs.src && /gform|GF_AJAX_POSTBACK/.test($(el).html() ?? "")) $(el).remove();
  });
}

/** Swap the (stale) Smash Balloon YouTube feed for a token rendered from content/youtube.json. */
function processYoutube($, islands) {
  $(".sb_youtube").each((_, el) => {
    islands.add("youtube-feed");
    $(el).replaceWith("<!--tz:youtube-feed-->");
  });
}

/** Spectra post grids paginate via admin-ajax; mark them for the static pagination enhancer. */
function processPostGrids($, islands) {
  $(".uagb-post-grid").each((_, el) => {
    if ($(el).find(".uagb-post-pagination-wrap").length) {
      islands.add("post-grid");
      $(el).attr("data-tz-post-grid", "");
    }
  });
}

/**
 * Owner-requested addition (2026-11-06, not on the WordPress site): a 4th
 * "Instagram" tab on the Resources tabs, rendered from content/instagram.json.
 * Spectra's tab script is index-based, so tab 3 just needs matching markup.
 */
function addInstagramTab($, islands) {
  const tabs = $(".wp-block-uagb-tabs.uagb-block-a64ce816");
  if (!tabs.length) return;
  const nav = tabs.find("ul.uagb-tabs__panel");
  const body = tabs.find(".uagb-tabs__body-wrap");
  const index = nav.children("li.uagb-tab").length;
  nav.append(`<li class="uagb-tab " role="none"><a href="#uagb-tabs__tab${index}" class="uagb-tabs-list uagb-tabs__icon-position-left" data-tab="${index}" role="tab">Instagram</a></li>`);
  body.append(`<div class="wp-block-uagb-tabs-child uagb-tabs__body-container uagb-inner-tab-${index}" aria-labelledby="uagb-tabs__tab${index}"><!--tz:instagram-feed--></div>`);
  islands.add("instagram-feed");
}

function processPage(file) {
  const route = routeOf(file);
  const $ = load(fs.readFileSync(file, "utf8"));
  const islands = new Set();

  const head = [];
  const headScripts = [];
  $("head").children().each((_, el) => {
    const tag = el.tagName;
    const a = attrs(el);
    if (tag === "title") head.push({ t: "title", text: $(el).text() });
    else if (tag === "meta") {
      if (a.charset || DROP_META.has(a.name ?? "")) return;
      head.push({ t: "meta", attrs: Object.fromEntries(Object.entries(a).map(([k, v]) => [k, toAbsolute(v)])) });
    } else if (tag === "link") {
      if (DROP_LINK_REL.has(a.rel) || DROP_STYLESHEET.has(a.id ?? "")) return;
      if (a.rel === "dns-prefetch" && a.href.includes("cdnjs")) return;
      const href = a.rel === "canonical" ? toAbsolute(a.href) : toRelative(a.href);
      head.push({ t: "link", attrs: { ...a, href } });
    } else if (tag === "style") {
      head.push({ t: "style", id: a.id ?? null, ref: writeShared("styles", ".css", toRelative($(el).html() ?? "")) });
    } else if (tag === "script") {
      if (a.type === "application/ld+json") head.push({ t: "jsonld", json: toAbsolute($(el).html() ?? "").trim() });
      else if (KEEP_SCRIPT.test(scriptId(el))) headScripts.push(scriptEntry($, el));
    }
  });
  // Scripts keep their original relative order, head ones first.
  for (const s of headScripts) head.push({ t: "script", ...s });

  const bodyScripts = [];
  $("body script").each((_, el) => {
    if (KEEP_SCRIPT.test(scriptId(el))) bodyScripts.push(scriptEntry($, el));
    $(el).remove();
  });

  processForms($, islands);
  processYoutube($, islands);
  processPostGrids($, islands);
  addInstagramTab($, islands);
  $("noscript").each((_, el) => { if (/gform|sby_/.test($(el).html() ?? "")) $(el).remove(); });

  const container = $(".site-container");
  const fragment = (selector) => {
    const el = container.children(selector);
    return el.length ? writeShared("fragments", ".html", toRelative($.html(el))) : null;
  };
  const page = {
    path: route.path,
    htmlAttrs: attrs($("html")[0]),
    bodyClass: $("body").attr("class") ?? "",
    siteContainerClass: container.attr("class") ?? "site-container",
    head,
    skipLinks: fragment("ul.genesis-skip-link"),
    header: fragment("header.site-header"),
    main: toRelative($.html(container.children("div.site-inner"))),
    footer: fragment("#genesis-footer-widgets"),
    footerExtra: toRelative(container.children().not("ul.genesis-skip-link, header.site-header, div.site-inner, #genesis-footer-widgets").toArray().map((el) => $.html(el)).join("")),
    bodyScripts,
    islands: [...islands].sort()
  };
  return { route, page };
}

function scriptEntry($, el) {
  const a = attrs(el);
  if (a.src) {
    const bare = a.src.replace(/\?.*$/, "");
    const src = VENDOR[bare] ?? toRelative(a.src);
    return { attrs: { ...a, src } };
  }
  return { attrs: a, ref: writeShared("scripts", ".js", toRelative($(el).html() ?? "")) };
}

// ---------------------------------------------------------------- assets
const ASSET_RE = /(?<![\w.])\/(wp-content|wp-includes)\/[^"'()\s,<>\\]+/g;

// The live theme CSS references a placeholder font that 404s on the real site too.
const KNOWN_MISSING = /^\/wp-content\/themes\/tzionbreslov\/fonts\/fontname\//;

function collectAssets(text, set) {
  const scannable = text.replace(/sourceURL=\S+/g, "");
  for (const m of scannable.matchAll(ASSET_RE)) set.add(decodeURIComponent(m[0].replace(/[?#].*$/, "")));
}

/** Prefer the crawled file; fall back to the extracted backup for assets the crawl never fetched. */
function assetSource(rel) {
  const crawled = path.join(siteDir, rel);
  if (fs.existsSync(crawled) && fs.statSync(crawled).isFile()) return crawled;
  const m = rel.match(/^\/wp-content\/(plugins|themes|uploads)\/(.+)$/);
  if (m) {
    const extracted = path.join(golden, "..", "wp-extracted", m[1], m[2]);
    if (fs.existsSync(extracted) && fs.statSync(extracted).isFile()) return extracted;
  }
  return null;
}

function copyAssets(seed) {
  const queue = [...seed];
  const done = new Set();
  const missing = [];
  while (queue.length) {
    const rel = queue.shift();
    if (done.has(rel)) continue;
    done.add(rel);
    const src = assetSource(rel);
    if (!src) {
      if (!KNOWN_MISSING.test(rel)) missing.push(rel);
      continue;
    }
    const dest = path.join(publicDir, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    if (rel.endsWith(".css")) {
      const css = fs.readFileSync(src, "utf8");
      for (const m of css.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) {
        const ref = m[1];
        if (/^(data:|https?:|\/\/|#)/.test(ref)) continue;
        const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(rel), ref.replace(/[?#].*$/, "")));
        queue.push(resolved);
      }
    }
  }
  return { copied: done.size - missing.length, missing };
}

async function vendorScripts() {
  for (const [remote, local] of Object.entries(VENDOR)) {
    const dest = path.join(publicDir, local);
    if (fs.existsSync(dest)) continue;
    const res = await fetch(`https:${remote}`);
    if (!res.ok) throw new Error(`vendor download failed ${res.status} ${remote}`);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  }
}

// ---------------------------------------------------------------- youtube seed
function seedYoutube() {
  const out = path.join(contentDir, "youtube.json");
  if (fs.existsSync(out)) return "kept existing";
  const live = path.join(golden, "live", "resources.html");
  if (!fs.existsSync(live)) return "no live snapshot";
  const $ = load(fs.readFileSync(live, "utf8"));
  const feed = $(".sb_youtube").first();
  const videos = feed.find(".sby_item").toArray().map((el) => ({
    id: el.attribs["data-video-id"],
    title: $(el).find(".sby_video_title").text().trim(),
    published: new Date(Number(el.attribs["data-date"]) * 1000).toISOString()
  }));
  const channelId = (feed.attr("data-feedid") ?? "").replace(/^sby_/, "").replace(/#.*/, "");
  fs.writeFileSync(out, `${JSON.stringify({
    channelId,
    channelUrl: `https://www.youtube.com/channel/${channelId}/`,
    perPage: Number(feed.attr("data-num") ?? 9),
    syncedAt: new Date().toISOString(),
    videos
  }, null, 2)}\n`);
  return `seeded ${videos.length} videos`;
}

// ---------------------------------------------------------------- sitemaps
/**
 * Keep Yoast's sitemaps and robots.txt (same URLs, so Search Console keeps working)
 * as templates in content/site-files; scripts/write-site-files.mjs renders them into
 * public/ at build time with the configured site URL.
 */
function publishSitemaps() {
  const dir = path.join(golden, "sitemaps");
  if (!fs.existsSync(dir)) return "none in snapshot";
  const files = fs.readdirSync(dir);
  for (const name of files) {
    let text = fs.readFileSync(path.join(dir, name), "utf8").replaceAll(LOCAL, PRODUCTION).replaceAll("//localhost:8088", "//tzionbreslov.com");
    // The XSL stylesheet lives in the Yoast plugin, which no longer exists.
    text = text.replace(/<\?xml-stylesheet[^>]*\?>/, "");
    fs.writeFileSync(path.join(contentDir, "site-files", name), text);
  }
  return files.join(", ");
}

// ---------------------------------------------------------------- main
async function main() {
  if (!fs.existsSync(pagesDir)) throw new Error(`Snapshot not found at ${pagesDir}`);
  const keepYoutube = fs.existsSync(path.join(contentDir, "youtube.json")) ? fs.readFileSync(path.join(contentDir, "youtube.json")) : null;
  for (const dir of ["pages", "fragments", "styles", "scripts", "site-files"]) resetDir(path.join(contentDir, dir));
  if (keepYoutube) fs.writeFileSync(path.join(contentDir, "youtube.json"), keepYoutube);
  for (const dir of ["wp-content", "wp-includes"]) fs.rmSync(path.join(publicDir, dir), { recursive: true, force: true });

  const routes = [];
  const assets = new Set();
  for (const file of listPages()) {
    const { route, page } = processPage(file);
    fs.writeFileSync(path.join(contentDir, "pages", `${route.key}.json`), `${JSON.stringify(page, null, 1)}\n`);
    if (route.path) routes.push({ path: route.path, key: route.key });
    // Head tags and JSON-LD keep absolute production URLs (og:image, schema logo…);
    // they must exist on our own host once the site URL is switched, so collect
    // them as root-relative paths too.
    const own = (s) => s.replaceAll(`${PRODUCTION}/`, "/").replaceAll("http://tzionbreslov.com/", "/");
    collectAssets(own(JSON.stringify(page).replaceAll("\\/", "/")), assets);
    for (const h of page.head) {
      if (h.t === "meta" || h.t === "link") for (const v of Object.values(h.attrs)) collectAssets(own(String(v)), assets);
      // Parsing drops Yoast's \/ escaping, which the stringified page keeps.
      else if (h.t === "jsonld") collectAssets(own(JSON.stringify(JSON.parse(h.json))), assets);
    }
  }
  for (const kind of ["fragments", "styles", "scripts"]) {
    for (const f of fs.readdirSync(path.join(contentDir, kind))) collectAssets(fs.readFileSync(path.join(contentDir, kind, f), "utf8").replaceAll("\\/", "/"), assets);
  }
  routes.sort((a, b) => a.path.localeCompare(b.path));
  fs.writeFileSync(path.join(contentDir, "routes.json"), `${JSON.stringify({ site: PRODUCTION, routes, redirects: REDIRECTS }, null, 1)}\n`);

  const { copied, missing } = copyAssets(assets);
  await vendorScripts();
  const sitemaps = publishSitemaps();
  const yt = seedYoutube();

  const count = (d) => fs.readdirSync(path.join(contentDir, d)).length;
  console.log(`routes ${routes.length} (+404) | fragments ${count("fragments")} | styles ${count("styles")} | scripts ${count("scripts")}`);
  console.log(`assets copied ${copied}, missing ${missing.length}${missing.length ? `:\n  ${missing.join("\n  ")}` : ""}`);
  console.log(`youtube: ${yt} | sitemaps: ${sitemaps}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

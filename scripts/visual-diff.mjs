#!/usr/bin/env node
// Pixel-compares a reference with the Next export: the local WordPress copy (Docker), or a checkpoint
// build served by scripts/serve-out.mjs (`npm run baseline -- checkpoint-001`, AGENTS.md).
//
//   REF=http://localhost:8088 NEXT=http://localhost:3100 node scripts/visual-diff.mjs [--mask-nav] [/path/ ...]
//
// --mask-nav hides the header, mobile menu and footer widgets on both sides and
// compares only the part above the reference page's footer widgets — for
// structure work, where the menu and footer links change on purpose.
//
// --crop-footer compares only the part above the reference page's footer widgets,
// hiding nothing (the header is compared) — for work that changes the footer alone.
//
// A page that is new (404 on REF, 200 on NEXT) is listed as "no reference" and
// left out of the worst mismatch; a page that is 404 on both sides is compared.
//
// Writes ref/next/diff PNGs to .tmp/visual/ and prints the mismatch per page.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

const REF = process.env.REF ?? "http://localhost:8088";
const NEXT = process.env.NEXT ?? "http://localhost:3100";
const OUT = path.resolve(".tmp/visual");
const args = process.argv.slice(2);
const MASK_NAV = args.includes("--mask-nav");
const CROP_FOOTER = MASK_NAV || args.includes("--crop-footer");
const pageArgs = args.filter((arg) => !arg.startsWith("--"));
const NAV_SELECTORS = ["header.site-header", ".mobile-menu-wrap", "#genesis-footer-widgets"];
// Each container and everything in it: a descendant with its own `visibility: visible` (an
// open menu panel, say) would still paint inside a hidden container.
const NAV_MASK = `${NAV_SELECTORS.flatMap((selector) => [selector, `${selector} *`]).join(", ")}{visibility:hidden!important}`;
// One of each template the site serves (the removed pages are gone: config/site-structure.mjs).
const PAGES = pageArgs.length ? pageArgs : [
  "/", "/about-us/", "/contact/", "/donate/", "/articles/", "/classes/",
  "/parshat-noach-october-8-9-2021/", "/no-such-page/"
];
const VIEWPORTS = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } };

const status = async (url) => (await fetch(url)).status;
const NO_REFERENCE = new Set();
for (const p of PAGES) if ((await status(REF + p)) === 404 && (await status(NEXT + p)) === 200) NO_REFERENCE.add(p);

async function capture(page, url) {
  await page.goto(url, { waitUntil: "load" });
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
  // The theme's ScrollTriggers reset when scrolled back above them, so finish
  // every animation and detach the triggers before the full-page capture.
  await page.evaluate(async () => {
    document.querySelectorAll("img[loading=lazy]").forEach((img) => { img.loading = "eager"; });
    await Promise.all([...document.images].map((img) => Promise.race([img.decode().catch(() => null), new Promise((r) => setTimeout(r, 10000))])));
    for (let y = 0; y < document.body.scrollHeight; y += 400) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 40));
    }
    const w = window;
    w.ScrollTrigger?.getAll().forEach((st) => { st.animation?.progress(1); st.kill(false); });
    w.gsap?.globalTimeline.getChildren(true, true, false).forEach((t) => t.progress(1));
    window.scrollTo(0, 0);
    window.dispatchEvent(new Event("scroll"));
    await new Promise((r) => setTimeout(r, 300));
    // Anything GSAP left mid-tween: show it in its final, resting state.
    document.querySelectorAll("[style*='opacity'], [style*='transform'], [style*='translate']").forEach((el) => {
      if (el.closest(".slick-slider, .uagb-modal-popup")) return;
      el.style.opacity = "";
      el.style.transform = "";
      el.style.translate = "";
      el.style.visibility = "";
    });
  });
  await page.evaluate(() => Promise.all([...document.images].map((img) => img.decode().catch(() => null))));
  await page.waitForTimeout(800);
  // Third-party embeds and the feed thumbnails render differently per load.
  await page.addStyleTag({ content: "iframe{visibility:hidden!important}" });
  let footerTop = null;
  if (MASK_NAV) await page.addStyleTag({ content: NAV_MASK });
  if (CROP_FOOTER) {
    // Where the footer widgets start, in page coordinates (null if the page has none).
    footerTop = await page.evaluate(() => {
      const footer = document.querySelector("#genesis-footer-widgets");
      return footer ? Math.round(footer.getBoundingClientRect().top + window.scrollY) : null;
    });
  }
  return { png: PNG.sync.read(await page.screenshot({ fullPage: true, animations: "disabled" })), footerTop };
}

// Keeps the top `height` pixels of a capture (all of it when height is null).
function cropTo(png, height) {
  if (height == null || height <= 0 || height >= png.height) return png;
  const out = new PNG({ width: png.width, height });
  PNG.bitblt(png, out, 0, 0, png.width, height, 0, 0);
  return out;
}

function compare(a, b) {
  const width = Math.max(a.width, b.width);
  const height = Math.max(a.height, b.height);
  const pad = (img) => {
    const out = new PNG({ width, height });
    out.data.fill(255);
    PNG.bitblt(img, out, 0, 0, img.width, img.height, 0, 0);
    return out;
  };
  const pa = pad(a), pb = pad(b), diff = new PNG({ width, height });
  const changed = pixelmatch(pa.data, pb.data, diff.data, width, height, { threshold: 0.1 });
  return { diff, changed, ratio: changed / (width * height), sizes: `${a.width}x${a.height} vs ${b.width}x${b.height}` };
}

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
let worst = 0;
for (const [vpName, viewport] of Object.entries(VIEWPORTS)) {
  const context = await browser.newContext({ viewport, reducedMotion: "no-preference" });
  const page = await context.newPage();
  for (const p of PAGES) {
    const name = `${vpName}${p.replace(/\//g, "_") || "_"}`;
    if (NO_REFERENCE.has(p)) {
      console.log(`${"n/a".padStart(7)}  ${vpName.padEnd(7)} ${p.padEnd(36)} no reference (404 on REF)`);
      continue;
    }
    // Chromium's full-page capture occasionally drops images on very tall
    // pages (on either side), so keep the best of a few attempts.
    let best;
    for (let attempt = 0; attempt < 3 && !(best && best.ratio < 0.0005); attempt++) {
      const refShot = await capture(page, REF + p);
      const nextShot = await capture(page, NEXT + p);
      // With --mask-nav or --crop-footer both sides stop where the reference page's footer widgets start.
      const clip = CROP_FOOTER ? refShot.footerTop : null;
      const ref = cropTo(refShot.png, clip);
      const next = cropTo(nextShot.png, clip);
      const result = { ref, next, ...compare(ref, next) };
      if (!best || result.ratio < best.ratio) best = result;
    }
    const { ref, next, diff, ratio, sizes } = best;
    fs.writeFileSync(path.join(OUT, `${name}.ref.png`), PNG.sync.write(ref));
    fs.writeFileSync(path.join(OUT, `${name}.next.png`), PNG.sync.write(next));
    fs.writeFileSync(path.join(OUT, `${name}.diff.png`), PNG.sync.write(diff));
    worst = Math.max(worst, ratio);
    console.log(`${(ratio * 100).toFixed(2).padStart(6)}%  ${vpName.padEnd(7)} ${p.padEnd(36)} ${sizes}`);
  }
  await context.close();
}
await browser.close();
const unreferenced = NO_REFERENCE.size ? `; no reference: ${[...NO_REFERENCE].join(" ")}` : "";
console.log(`worst mismatch ${(worst * 100).toFixed(2)}%  (images in ${OUT})${unreferenced}`);

#!/usr/bin/env node
// Pixel-compares the WordPress reference (local Docker copy) with the Next export.
//
//   REF=http://localhost:8088 NEXT=http://localhost:3100 node scripts/visual-diff.mjs [/path/ ...]
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
const PAGES = process.argv.slice(2).length ? process.argv.slice(2) : [
  "/", "/about-us/", "/contact/", "/donate/", "/resources/", "/resources/page/2/",
  "/parshat-noach-october-8-9-2021/", "/video/video-1/", "/category/uncategorized/",
  "/author/esti-wolo/", "/no-such-page/"
];
const VIEWPORTS = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 } };

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
  return PNG.sync.read(await page.screenshot({ fullPage: true, animations: "disabled" }));
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
    // Chromium's full-page capture occasionally drops images on very tall
    // pages (on either side), so keep the best of a few attempts.
    let best;
    for (let attempt = 0; attempt < 3 && !(best && best.ratio < 0.0005); attempt++) {
      const ref = await capture(page, REF + p);
      const next = await capture(page, NEXT + p);
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
console.log(`worst mismatch ${(worst * 100).toFixed(2)}%  (images in ${OUT})`);

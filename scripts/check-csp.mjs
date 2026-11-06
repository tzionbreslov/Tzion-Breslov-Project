#!/usr/bin/env node
// Proves the security headers (config/security-headers.mjs) break nothing:
// visits every route, scrolls, exercises the interactive islands, and fails on
// any CSP violation (enforced or report-only).
//
// Local (default): serves ./out on a free port WITH the enforced headers.
//   npm run build && node scripts/check-csp.mjs
//   To also exercise Turnstile + the forms API origin, build AND run with
//   NEXT_PUBLIC_API_BASE_URL=https://api.tzionbreslov.org and
//   NEXT_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA (Cloudflare's
//   always-pass test key). The production key only allows tzionbreslov.org +
//   www, so on localhost no token is issued and no API request is ever sent.
//
// Live (switch day, README step 4): checks a deployed site as served by Cloudflare.
//   node scripts/check-csp.mjs https://tzionbreslov.org
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { CSP } from "../config/security-headers.mjs";
import { siteRoutes } from "../config/site-structure.mjs";
import { violatesOurPolicy } from "./lib/csp-console.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { routes } = siteRoutes(JSON.parse(fs.readFileSync(path.join(root, "content", "routes.json"), "utf8")));
const liveBase = process.argv[2]?.replace(/\/+$/, "");

let BASE = liveBase;
let server;
let stopping = false;
const stop = () => { stopping = true; server?.kill(); };
process.on("exit", stop);

if (!liveBase) {
  server = spawn(process.execPath, [path.join(root, "scripts", "serve-out.mjs"), path.join(root, "out")], {
    env: { ...process.env, PORT: "0", SECURITY_HEADERS: "1" },
    stdio: ["ignore", "pipe", "inherit"]
  });
  // Take the URL from the server's own output (so we never test a stray
  // process on a fixed port) and fail if it dies at any point.
  BASE = await new Promise((resolve, reject) => {
    let buf = "";
    server.stdout.on("data", (chunk) => {
      buf += chunk;
      const m = buf.match(/on (http:\/\/localhost:\d+)/);
      if (m) resolve(m[1]);
    });
    server.on("exit", (code) => { if (!stopping) reject(new Error(`serve-out exited early (code ${code})`)); });
  });
  server.on("exit", (code) => { if (!stopping) { console.error(`serve-out died during the check (code ${code})`); process.exit(1); } });
}

const first = await fetch(`${BASE}/`);
const enforced = first.headers.get("content-security-policy");
const reportOnly = first.headers.get("content-security-policy-report-only");
if (!liveBase && enforced !== CSP) throw new Error("local server is not sending the CSP from config/security-headers.mjs");
if (liveBase && !enforced && !reportOnly) throw new Error(`${liveBase} sends no Content-Security-Policy(-Report-Only) header`);
console.log(`checking ${BASE} (${enforced ? "enforced" : "report-only"} CSP)`);
// The policy actually served decides which console reports are ours (embedded
// frames such as the YouTube player log violations of their own policies).
const servedPolicy = [enforced, reportOnly].filter(Boolean).join("; ");

const violations = [];
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.addInitScript(() => {
  document.addEventListener("securitypolicyviolation", (e) => {
    (window.__csp ||= []).push(`${e.disposition} ${e.effectiveDirective} blocked ${e.blockedURI || "(inline)"} @ ${e.sourceFile || ""}:${e.lineNumber || ""}`);
  });
});
const page = await context.newPage();
page.on("console", (msg) => {
  const text = msg.text();
  // Our CSP, plus anything else the headers made the browser refuse (nosniff, X-Frame-Options).
  const refused = /Content Security Policy/i.test(text) ? violatesOurPolicy(text, servedPolicy) : /Refused to/i.test(text);
  if (refused) violations.push(`[console ${page.url()}] ${text.slice(0, 300)}`);
});

const visit = async (url, interact) => {
  await page.goto(url, { waitUntil: "load" });
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 30)); }
  });
  if (interact) {
    try { await interact(); } catch (error) { violations.push(`[${new URL(url).pathname}] interaction failed: ${error.message.split("\n")[0]}`); }
  }
  await page.waitForTimeout(400);
  for (const v of await page.evaluate(() => window.__csp ?? [])) violations.push(`[${new URL(url).pathname}] ${v}`);
};

for (const { path: route } of routes) await visit(BASE + route);
await visit(BASE + "/no-such-page/");

// Interactive islands pull in extra origins.
await visit(BASE + "/resources/", async () => {
  await page.click("[data-tz-youtube-feed] .sby_video_thumbnail");
  await page.waitForSelector(".tz-lightbox iframe");
  await page.waitForTimeout(2500);
  await page.keyboard.press("Escape");
  await page.click("[data-tz-youtube-feed] .sby_load_btn").catch(() => undefined);
  await page.click(".uagb-tab a >> nth=1");
  await page.click("[data-tz-post-grid] .uagb-post-pagination-wrap a.page-numbers >> nth=0");
  await page.waitForTimeout(1200);
  const igTile = page.locator(".tz-ig__tile").first();
  if (await igTile.count()) {
    await page.click(".uagb-tab a >> text=Instagram");
    await igTile.click();
    await page.waitForSelector(".tz-igv");
    await page.keyboard.press("Escape");
  }
});

await visit(BASE + "/classes/", async () => {
  await page.waitForSelector("[data-tz-video-library=ready]");
  await page.click(".tz-vl__grid[data-kind=video] .tz-vl__trigger >> nth=0");
  await page.waitForSelector(".tz-vl-player iframe");
  await page.waitForTimeout(2500);
  await page.keyboard.press("Escape");
});

const apiBase = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/+$/, "");
await visit(BASE + "/contact/", async () => {
  const contactForm = page.locator("form[data-tz-form=contact]");
  if (!apiBase || !(await contactForm.count())) return;
  // Never reach a deployed Worker: answer the forms API locally. A request
  // blocked by connect-src never reaches this route — it shows up as a violation.
  let apiCalled = false;
  await page.route(`${apiBase}/**`, (route) => {
    apiCalled = true;
    return route.fulfill({ status: 503, contentType: "application/json", body: '{"ok":false,"error":"SERVICE_NOT_CONFIGURED","correlationId":"csp-check"}' });
  });
  await page.fill("#input_3_4", "csp-check@example.com");
  await page.fill("#input_3_7", "CSP check message");
  await page.waitForTimeout(2500);
  await page.click("form[data-tz-form=contact] [type=submit]");
  await page.waitForTimeout(4000);
  if (!liveBase && !apiCalled) violations.push("[/contact/] the forms API request was never sent (build with the Turnstile test key to exercise connect-src)");
});
await visit(BASE + "/donate/", async () => {
  await page.click(".tz-donate__submit");
  await page.waitForTimeout(500);
});

await browser.close();
stop();

const unique = [...new Set(violations)];
if (unique.length) {
  console.error(`CSP violations (${unique.length}):\n  ${unique.join("\n  ")}`);
  process.exit(1);
}
console.log(`CSP OK: ${routes.length + 1} pages + interactions, zero violations.`);

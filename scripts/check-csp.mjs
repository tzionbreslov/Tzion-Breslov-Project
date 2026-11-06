#!/usr/bin/env node
// Proves the production security headers (config/security-headers.mjs) break
// nothing: serves ./out WITH the headers enforced, visits every route, scrolls,
// exercises the interactive islands, and fails on any CSP violation.
//
//   npm run build && node scripts/check-csp.mjs
//   (build with NEXT_PUBLIC_API_BASE_URL + NEXT_PUBLIC_TURNSTILE_SITE_KEY set to
//   also exercise the Turnstile + forms API origins)
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 3217;
const BASE = `http://localhost:${PORT}`;
const { routes } = JSON.parse(fs.readFileSync(path.join(root, "content", "routes.json"), "utf8"));

const server = spawn(process.execPath, [path.join(root, "scripts", "serve-out.mjs"), path.join(root, "out")], {
  env: { ...process.env, PORT: String(PORT), SECURITY_HEADERS: "1" },
  stdio: "ignore"
});
const stop = () => server.kill();
process.on("exit", stop);

for (let i = 0; i < 50; i++) {
  try { if ((await fetch(BASE + "/")).ok) break; } catch { /* starting */ }
  await new Promise((r) => setTimeout(r, 200));
}
const head = await fetch(BASE + "/");
if (!head.headers.get("content-security-policy")) throw new Error("server is not sending the CSP header");

const violations = [];
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await context.addInitScript(() => {
  document.addEventListener("securitypolicyviolation", (e) => {
    (window.__csp ||= []).push(`${e.effectiveDirective} blocked ${e.blockedURI || "(inline)"} @ ${e.sourceFile || ""}:${e.lineNumber || ""}`);
  });
});
const page = await context.newPage();
page.on("console", (msg) => {
  if (/Content Security Policy|Refused to/i.test(msg.text())) violations.push(`[console ${page.url()}] ${msg.text().slice(0, 300)}`);
});

const visit = async (url, interact) => {
  await page.goto(url, { waitUntil: "load" });
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => undefined);
  await page.evaluate(async () => {
    for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 30)); }
  });
  if (interact) await interact();
  await page.waitForTimeout(400);
  const found = await page.evaluate(() => window.__csp ?? []);
  for (const v of found) violations.push(`[${new URL(url).pathname}] ${v}`);
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
});
await visit(BASE + "/contact/", async () => {
  await page.fill("#input_3_4", "csp-check@example.com");
  await page.fill("#input_3_7", "CSP check message");
  await page.waitForTimeout(2500);
  await page.click("form[data-tz-form=contact] [type=submit]");
  await page.waitForTimeout(3000);
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

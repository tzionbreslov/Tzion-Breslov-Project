#!/usr/bin/env node
// Serves ./out like GitHub Pages does (dir -> index.html, unknown -> 404.html).
// SECURITY_HEADERS=1 adds the production security headers (config/security-headers.mjs).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { SECURITY_HEADERS } from "../config/security-headers.mjs";

const root = path.resolve(process.argv[2] ?? "out");
const port = Number(process.env.PORT ?? 3100);
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".woff2": "font/woff2", ".woff": "font/woff", ".ico": "image/x-icon", ".txt": "text/plain", ".xml": "application/xml", ".mp4": "video/mp4" };

http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  let file = path.join(root, decodeURIComponent(url.pathname));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
    if (!url.pathname.endsWith("/")) { res.writeHead(301, { Location: `${url.pathname}/${url.search}` }).end(); return; }
    file = path.join(file, "index.html");
  }
  let status = 200;
  if (!fs.existsSync(file)) { status = 404; file = path.join(root, "404.html"); }
  const extra = process.env.SECURITY_HEADERS === "1" ? SECURITY_HEADERS : {};
  res.writeHead(status, { ...extra, "Content-Type": types[path.extname(file)] ?? "application/octet-stream" });
  fs.createReadStream(file).pipe(res);
}).listen(port, () => console.log(`serving ${root} on http://localhost:${port}`));

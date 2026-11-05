import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
// Set when served from a sub-path (GitHub Pages project URL before the custom domain).
const configuredBasePath = process.env.NEXT_PUBLIC_BASE_PATH?.trim() ?? "";
const basePath = configuredBasePath ? `/${configuredBasePath.replace(/^\/+|\/+$/g, "")}` : "";

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  basePath,
  // WordPress URLs end in a slash (/about-us/); keep them identical.
  trailingSlash: true,
  allowedDevOrigins: ["localhost", "127.0.0.1"],
  images: {
    unoptimized: true
  },
  experimental: {
    globalNotFound: true
  },
  turbopack: {
    root: projectRoot
  }
};

export default nextConfig;

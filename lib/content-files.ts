import fs from "node:fs";
import path from "node:path";
import { cache } from "react";

/**
 * The content/ folder as files: the imported WordPress pages' JSON (see
 * scripts/import-wordpress.mjs), the other shared files, and the page shape.
 * A leaf (nothing from lib/pages), so the pages composed in code read the
 * Resources page here, not through lib/content.ts, which imports them through
 * lib/pages/registry.ts. Server-only.
 */

export type Attrs = Record<string, string>;

export type ScriptItem = { attrs: Attrs; ref?: string };

export type HeadItem =
  | { t: "title"; text: string }
  | { t: "meta"; attrs: Attrs }
  | { t: "link"; attrs: Attrs }
  | { t: "style"; id: string | null; ref: string }
  | { t: "jsonld"; json: string }
  | ({ t: "script" } & ScriptItem);

export type Island = "signup" | "contact" | "donate" | "youtube-feed" | "post-grid" | "instagram-feed" | "video-library" | "gallery" | "events";

export type PageContent = {
  path: string | null;
  htmlAttrs: Attrs;
  bodyClass: string;
  siteContainerClass: string;
  head: HeadItem[];
  skipLinks: string | null;
  header: string | null;
  main: string;
  footer: string | null;
  footerExtra: string;
  bodyScripts: ScriptItem[];
  islands: Island[];
};

const contentDir = path.join(process.cwd(), "content");

export const readShared = cache((ref: string) => fs.readFileSync(path.join(contentDir, ref), "utf8"));

/** An imported page (content/pages/{key}.json); lib/content.ts loadPage also builds the composed "tz:" ones. */
export const loadImportedPage = cache((key: string): PageContent => JSON.parse(readShared(`pages/${key}.json`)));

import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { REMOVED_PATHS } from "../config/site-structure.mjs";

// The pages the owner asked to remove are gone: no page and no forwarding page,
// only the site's 404 page (the edge redirects them after launch).
const NOT_FOUND = fs.readFileSync(path.join(__dirname, "..", "out", "404.html"), "utf8");

test.describe("removed pages", () => {
  test.skip(({ isMobile }) => isMobile, "plain requests: one project is enough");

  for (const removed of REMOVED_PATHS) {
    test(`${removed} is the 404 page`, async ({ request }) => {
      const response = await request.get(removed, { maxRedirects: 0 });
      expect(response.status()).toBe(404);
      expect(await response.text()).toBe(NOT_FOUND);
    });
  }
});

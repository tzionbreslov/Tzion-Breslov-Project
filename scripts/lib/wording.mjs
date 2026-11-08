// The site's wording as an ordered list, and the check that a page still says
// everything a baseline page said, in the same order (owner rule: never change
// existing wording); the form fields' placeholders are listed the same way.
// Used by scripts/check-wording.mjs.
import * as cheerio from "cheerio";

// Elements whose content is never shown as page text.
const SKIPPED = new Set(["script", "style", "noscript", "template"]);
const CONTEXT_SIZE = 5;

const collapse = (text) => text.replace(/\s+/g, " ").trim();

/**
 * `title:<document title>`, then every non-empty text node of <body> in
 * document order (hidden text included), with `alt:<value>` for each image
 * that has alt text, at its position.
 * @param {string} html
 * @returns {string[]}
 */
export function extractWording(html) {
  const $ = cheerio.load(html);
  const wording = [];
  const title = collapse($("head > title").first().text());
  if (title) wording.push(`title:${title}`);
  const walk = (nodes) => {
    for (const node of nodes) {
      if (node.type === "text") {
        const text = collapse(node.data);
        if (text) wording.push(text);
      } else if ("name" in node && !SKIPPED.has(node.name)) {
        if (node.name === "img") {
          const alt = collapse(node.attribs.alt ?? "");
          if (alt) wording.push(`alt:${alt}`);
        }
        walk(node.children);
      }
    }
  };
  walk($("body").contents().toArray());
  return wording;
}

/**
 * Every non-empty `placeholder` attribute in <body>, in document order (the hint
 * text in form fields, which extractWording doesn't read), skipping the same
 * elements as extractWording.
 * @param {string} html
 * @returns {string[]}
 */
export function extractPlaceholders(html) {
  const $ = cheerio.load(html);
  const placeholders = [];
  const walk = (nodes) => {
    for (const node of nodes) {
      if (!("name" in node) || SKIPPED.has(node.name)) continue;
      const placeholder = collapse(node.attribs?.placeholder ?? "");
      if (placeholder) placeholders.push(placeholder);
      walk(node.children ?? []);
    }
  };
  walk($("body").contents().toArray());
  return placeholders;
}

/**
 * Greedy in-order match: every baseline entry must appear in `current`, in the
 * same order (new entries in between are allowed). On failure, `index` is the
 * first baseline entry not found after the previous match, and `context` is up
 * to 5 entries of `current` from where it was expected.
 * @param {string[]} baseline
 * @param {string[]} current
 */
export function isOrderedSubsequence(baseline, current) {
  let next = 0;
  for (let index = 0; index < baseline.length; index++) {
    const found = current.indexOf(baseline[index], next);
    if (found === -1) {
      return { ok: false, index, expected: baseline[index], context: current.slice(next, next + CONTEXT_SIZE) };
    }
    next = found + 1;
  }
  return { ok: true };
}

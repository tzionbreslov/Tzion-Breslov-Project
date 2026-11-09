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
 * The owner-approved changes (tests/wording/owner-approved.json) applied to a baseline: on each of an entry's
 * routes, the one baseline text node that is exactly `text` becomes `to`, or is dropped when `to` is null. An entry
 * matches whole nodes only, and exactly one on each of its routes: none means it is stale (its text isn't there),
 * two or more that it would reach beyond its own node; either is a problem, as is a route the check doesn't read,
 * two changes for the same node, or an entry without its date or the owner's words. The baseline given is left as
 * it was.
 * @param {Record<string, string[]>} baseline
 * @param {Array<{ routes: string[], text: string, to: string | null, date: string, owner: string[] }>} changes
 * @param {(route: string) => boolean} isChecked the routes the check reads (removed pages are skipped)
 * @returns {{ baseline: Record<string, string[]>, problems: string[] }}
 */
export function applyApprovedChanges(baseline, changes, isChecked = () => true) {
  const problems = [];
  // route -> text -> its new text (null: removed)
  const byRoute = new Map();
  changes.forEach((change, i) => {
    const { routes, text, to, date, owner } = change ?? {};
    const name = `owner-approved change ${i + 1} (${JSON.stringify(text)})`;
    const invalid = [
      typeof text !== "string" || !text.trim() ? "no text" : null,
      !(to === null || (typeof to === "string" && to.trim())) ? "no new text (or null for a removed node)" : null,
      to === text ? "its new text is the same" : null,
      typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date) ? "no date" : null,
      !Array.isArray(owner) || !owner.length || owner.some((words) => typeof words !== "string" || !words.trim()) ? "no owner's words" : null,
      !Array.isArray(routes) || !routes.length ? "no routes" : null
    ].filter(Boolean);
    if (invalid.length) {
      problems.push(`${name}: ${invalid.join(", ")}`);
      return;
    }
    for (const route of routes) {
      if (!Object.hasOwn(baseline, route) || !isChecked(route)) {
        problems.push(`${name}: ${route} is not a page the check reads`);
        continue;
      }
      const found = baseline[route].filter((node) => node === text).length;
      if (found !== 1) {
        problems.push(found === 0 ? `${name}: not on ${route} (a stale entry)` : `${name}: matches ${found} nodes on ${route}, not one`);
        continue;
      }
      const texts = byRoute.get(route) ?? new Map();
      if (texts.has(text)) {
        problems.push(`${name}: ${route} already has a change for this text`);
        continue;
      }
      texts.set(text, to);
      byRoute.set(route, texts);
    }
  });
  const applied = {};
  for (const [route, nodes] of Object.entries(baseline)) {
    const texts = byRoute.get(route);
    applied[route] = texts ? nodes.flatMap((node) => (!texts.has(node) ? [node] : texts.get(node) === null ? [] : [texts.get(node)])) : [...nodes];
  }
  return { baseline: applied, problems };
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

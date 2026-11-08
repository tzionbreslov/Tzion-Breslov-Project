import { strict as assert } from "node:assert";
import fs from "node:fs";
import test from "node:test";
import { replaceOnce, swapHead } from "../lib/pages/edits.mjs";

const upper = (match) => match.toUpperCase();

test("replaceOnce keeps the caller's flags: i and s match as written", () => {
  assert.equal(replaceOnce('<P CLASS="x">a</P>', /<p class="x">/i, upper, "p"), '<P CLASS="X">a</P>');
  assert.equal(replaceOnce("<p>one\ntwo</p>", /one.two/s, () => "both", "dot"), "<p>both</p>");
  assert.equal(replaceOnce("aXb", /x/gi, () => "-", "x"), "a-b");
});

test("replaceOnce counts every match under the caller's flags, and drops sticky", () => {
  assert.throws(() => replaceOnce("<p></p><P></P>", /<p>/i, upper, "p"), /structure: marker not unique: p/);
  assert.throws(() => replaceOnce("<p></p>", /<P>/, upper, "P"), /structure: marker not found: P/);
  // y would only look at the very start: replaceOnce finds its one match anywhere.
  assert.equal(replaceOnce("xa", /a/y, () => "b", "a"), "xb");
});

test("replaceOnce gives the replacer the match and its groups", () => {
  assert.equal(replaceOnce("<h2>Old</h2>", /(<h2>)[^<]*(<\/h2>)/, (_, open, close) => `${open}New${close}`, "h2"), "<h2>New</h2>");
});

// compose.ts swaps the Resources page's own head tags for a composed page's: here on the real imported head.
const { head } = JSON.parse(fs.readFileSync(new URL("../content/pages/resources.json", import.meta.url), "utf8"));
const OWN = [{ t: "title", text: "Gallery - Tzion Breslov" }, { t: "meta", attrs: { name: "description", content: "Photos" } }];
const isOwn = (item) => item.t === "title" || item.t === "jsonld" ||
  /^(description|og:|twitter:|article:)/.test(item.attrs?.name ?? item.attrs?.property ?? "") ||
  ["canonical", "shortlink"].includes(item.attrs?.rel) || (item.attrs?.rel === "alternate" && /oembed/.test(item.attrs?.type ?? ""));

test("the fixture is the Resources head: robots, then its title and the rest of its own tags, then the stylesheets", () => {
  assert.equal(head[0].attrs.name, "robots");
  assert.deepEqual(head[1], { t: "title", text: "Resources - Tzion Breslov" });
  assert.equal(head.filter(isOwn).length, 16);
});

test("swapHead puts the new tags where the title was and drops every Resources-own tag", () => {
  const swapped = swapHead(head, OWN);
  assert.deepEqual(swapped, [head[0], ...OWN, ...head.slice(1).filter((item) => !isOwn(item))]);
  assert.equal(swapped.length, head.length - 16 + OWN.length);
  // The imported head is left as it was (the page cache shares it).
  assert.deepEqual(head[1], { t: "title", text: "Resources - Tzion Breslov" });
});

test("swapHead fails loudly when the Resources title is missing, even with its other tags there", () => {
  const without = (drop) => head.filter((item) => !drop(item));
  assert.throws(() => swapHead(without((item) => item.t === "title"), OWN), /structure: marker not found: Resources head title/);
  assert.throws(() => swapHead(without(isOwn), OWN), /structure: marker not found: Resources head title/);
  // The title must open the page's own tags: a re-import that moves it fails rather than placing the new tags elsewhere.
  const moved = [head[0], head[2], head[1], ...head.slice(3)];
  assert.throws(() => swapHead(moved, OWN), /structure: marker not found: Resources head title/);
});

import { strict as assert } from "node:assert";
import fs from "node:fs";
import test from "node:test";
import { swapHero } from "../lib/pages/edits.mjs";

// renderHero (lib/pages/parts.ts) = swapHero on the Resources hero: here on the real cover
// block of the imported Resources page, as WordPress wrote it.
const { main } = JSON.parse(fs.readFileSync(new URL("../content/pages/resources.json", import.meta.url), "utf8"));
const start = main.indexOf('<div class="wp-block-cover alignfull hero"');
const HERO = main.slice(start, main.indexOf('<div class="svg-img arrow-svg', start));
const IMAGE = ' src="/wp-content/uploads/2023/06/resources.png"';
const HEADING = "<strong>More purpose, passion and positivity</strong>";
const SUBHEADING = ">Resources for those seeking spiritual growth.</p>";
const SPACER_AND_SUBHEADING = /\s*<div aria-hidden="true" class="wp-block-spacer spacer-small-height "><\/div>\s*<p [^>]*>Resources for those seeking spiritual growth\.<\/p>/;

test("the fixture is the Resources hero: one image with a srcset, the heading, the spacer and the subheading", () => {
  for (const part of [IMAGE, " srcset=", " sizes=", HEADING, SUBHEADING]) assert.equal(HERO.split(part).length, 2, part);
  assert.match(HERO, SPACER_AND_SUBHEADING);
});

test("swapHero swaps the image (dropping srcset and sizes), the heading and the subheading, and nothing else", () => {
  const html = swapHero(HERO, { image: "/media/events-hero.webp", heading: "Events", subheading: "Join us" });
  const expected = HERO
    .replace(IMAGE, ' src="/media/events-hero.webp"')
    .replace(/ srcset="[^"]*"/, "")
    .replace(/ sizes="[^"]*"/, "")
    .replace(HEADING, "<strong>Events</strong>")
    .replace(SUBHEADING, ">Join us</p>");
  assert.equal(html, expected);
  assert.doesNotMatch(html, /srcset|sizes=|resources(-\d+x\d+)?\.png/);
});

test("without a subheading, the spacer and the subheading line are left out", () => {
  const html = swapHero(HERO, { image: "/media/gallery-hero.webp", heading: "Gallery" });
  assert.match(html, /<strong>Gallery<\/strong><\/h2>\s*<\/div><\/div>\s*$/);
  assert.doesNotMatch(html, /spacer-small-height|is-style-main|seeking spiritual growth/);
  assert.equal(html, swapHero(HERO, { image: "/media/gallery-hero.webp", heading: "Gallery", subheading: "x" }).replace(/\s*<div aria-hidden="true" class="wp-block-spacer[^]*?<\/p>/, ""));
});

test("swapHero can make the heading the page's h1, and changes nothing else", () => {
  const options = { image: "/media/gallery-hero.webp", heading: "Gallery" };
  const h2 = swapHero(HERO, options);
  const h1 = swapHero(HERO, { ...options, headingTag: "h1" });
  assert.equal(h1, h2.replace(/<h2 (class="wp-block-heading[^"]*"><strong>Gallery<\/strong>)<\/h2>/, "<h1 $1</h1>"));
  assert.equal(h1.match(/<h1\b/g)?.length, 1);
  assert.doesNotMatch(h1, /<\/?h2\b/);
  // h2 stays the default.
  assert.equal(swapHero(HERO, { ...options, headingTag: "h2" }), h2);
});

test("swapHero escapes the image path, the heading and the subheading", () => {
  const html = swapHero(HERO, { image: '/media/a"b&c.webp', heading: "Q & A <live>", subheading: '"Quoted" & <b>' });
  assert.ok(html.includes(' src="/media/a&quot;b&amp;c.webp"'));
  assert.ok(html.includes("<strong>Q &amp; A &lt;live&gt;</strong>"));
  assert.ok(html.includes(">&quot;Quoted&quot; &amp; &lt;b&gt;</p>"));
});

test("swapHero fails loudly when a re-import moves or repeats what it swaps", () => {
  assert.throws(() => swapHero(HERO.replace(HEADING, "<em>Moved</em>"), { image: "/x.webp", heading: "X" }), /structure: marker not found: hero heading/);
  assert.throws(() => swapHero(HERO + HERO, { image: "/x.webp", heading: "X" }), /structure: marker not unique: hero image/);
  assert.throws(() => swapHero(HERO.replace(SPACER_AND_SUBHEADING, ""), { image: "/x.webp", heading: "X" }), /structure: marker not found: hero subheading/);
});

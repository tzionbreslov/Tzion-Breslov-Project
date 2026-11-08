import { strict as assert } from "node:assert";
import test from "node:test";
import copy from "../content/copy/en.json" with { type: "json" };
import { renderEventsList } from "../lib/events.mjs";
import { exportGuard, withoutEventCards } from "./lib/export-guard.mjs";

const COM = "https://tzionbreslov.com";
const ORG = "https://tzionbreslov.org";
const BASE = "/Tzion-Breslov-Project";
// The builds CI checks: today's (.com), switch day's (.org) and the github.io preview's (base path).
const today = exportGuard({ production: COM });
const switched = exportGuard({ production: ORG });
const preview = exportGuard({ production: COM, base: BASE });

const page = (body, head = "") => `<!doctype html><html lang="en-US"><head>${head}</head><body>${body}</body></html>`;
/** `html` as Next's flight data carries it: a JSON string with <, > and & escaped, inside self.__next_f.push. */
const flight = (html) => `<script>self.__next_f.push([1,${JSON.stringify(html)
  .replaceAll("<", "\\u003c").replaceAll(">", "\\u003e").replaceAll("&", "\\u0026")}])</script>`;
/** The Events page's cards as lib/events.mjs renders them, with `fields` typed into the calendar. */
const cards = (fields) => renderEventsList([{
  id: "0ff0000000000000000000aa", title: "Talk", summary: "", location: "", rsvp: "off", limit: null,
  startsAt: "2026-11-09T06:00:00.000Z", endsAt: "2026-11-09T07:00:00.000Z", timeZone: "Asia/Jerusalem", allDay: false,
  ...fields
}], copy.events, copy.rsvp);
/** The Events page: its cards in the HTML and again in the flight data. */
const eventsPage = (fields) => page(cards(fields) + flight(cards(fields)));
/** Everything the events manager might paste into an event. */
const PASTED = {
  title: "Talk at https://tzionbreslov.com/about/",
  location: "Jerusalem, see https://tzionbreslov.org/video/video-1/",
  summary: "Details: https://tzionbreslov.com/resources/ and https://tzionbreslov.org/resources/ " +
    "(the talk: https://www.youtube.com/embed/abc123); <a href=\"/about/\">old page</a>"
};

test("withoutEventCards drops the cards from the HTML and from the flight data, and nothing else", () => {
  const html = page(`<p>before</p>${cards(PASTED)}<p>after</p>${flight(`<p>x</p>${cards(PASTED)}`)}`);
  const text = withoutEventCards(html);
  assert.ok(!text.includes("tz-event\""), "no card left in the HTML");
  assert.ok(!text.includes(String.raw`tz-event\"`), "no card left in the flight data");
  assert.ok(!text.includes("abc123"));
  assert.ok(text.includes("<p>before</p>") && text.includes("<p>after</p>") && text.includes(String.raw`\u003cp\u003ex\u003c/p\u003e`));
});

test("a clean page passes in every build", () => {
  const html = page(`<a href="/about-us/">About</a><a href="${COM}/classes/">Classes</a><img src="/wp-content/a.png">`,
    `<link rel="canonical" href="${COM}/about-us/">`);
  assert.deepEqual(today.pageProblems(html), []);
  assert.deepEqual(preview.pageProblems(html.replaceAll(`href="/`, `href="${BASE}/`).replaceAll(`src="/`, `src="${BASE}/`)), []);
  assert.deepEqual(switched.pageProblems(html.replaceAll(COM, ORG)), []);
});

test("a root-relative or site-origin href/src to a removed page fails", () => {
  assert.deepEqual(today.pageProblems(page(`<a href="/resources/">x</a>`)), ["links to the removed page /resources/"]);
  assert.deepEqual(today.pageProblems(page(`<a href="/video/video-3/#t">x</a>`)), ["links to the removed page /video/video-3/"]);
  assert.deepEqual(today.pageProblems(page(`<a href="${COM}/about/?x=1">x</a>`)), ["links to the removed page /about/"]);
  assert.deepEqual(switched.pageProblems(page(`<a href="${ORG}/author/esti-wolo/">x</a>`)), ["links to the removed page /author/esti-wolo/"]);
  assert.deepEqual(preview.pageProblems(page(`<a href="${BASE}/category/uncategorized/">x</a>`)), ["links to the removed page /category/uncategorized/"]);
});

test("a site-origin URL to a removed page anywhere in the text fails, plain or JSON-escaped", () => {
  const jsonLd = (url) => page("", `<script type="application/ld+json">{"url":"${url}"}</script>`);
  assert.deepEqual(today.pageProblems(jsonLd(`${COM}/resources/page/2/`)), ["links to the removed page /resources/page/2/"]);
  assert.deepEqual(today.pageProblems(jsonLd(String.raw`https:\/\/tzionbreslov.com\/video\/video-27\/`)), ["links to the removed page /video/video-27/"]);
  assert.deepEqual(switched.pageProblems(jsonLd(String.raw`https:\/\/tzionbreslov.org\/about\/`)), ["links to the removed page /about/"]);
});

test("live pages never match a removed one", () => {
  for (const path of ["/about-us/", "/about-us/team/", "/about/team/", "/classes/", "/videos/", "/resources-old/"]) {
    assert.deepEqual(today.pageProblems(page(`<a href="${path}">x</a><p>${COM}${path}</p>`)), [], path);
  }
});

test("sitemaps: removedRefs reads <loc> URLs; mentionsOldDomain only after the switch", () => {
  const sitemap = `<urlset><url><loc>${COM}/about-us/</loc></url><url><loc>${COM}/resources/page/3/</loc></url></urlset>`;
  assert.deepEqual(today.removedRefs(sitemap), ["/resources/page/3/"]);
  assert.equal(today.mentionsOldDomain(sitemap), false);
  assert.equal(switched.mentionsOldDomain(sitemap), true);
  assert.equal(switched.mentionsOldDomain(sitemap.replaceAll(COM, ORG)), false);
  assert.equal(switched.mentionsOldDomain(String.raw`{"url":"https:\/\/tzionbreslov.com\/"}`), true);
});

test("after the switch, tzionbreslov.com in the text fails; an email address on it doesn't", () => {
  assert.deepEqual(switched.pageProblems(page(`<meta property="og:url" content="${COM}/about-us/">`)), [
    "still references tzionbreslov.com after the site-URL switch"
  ]);
  assert.deepEqual(today.pageProblems(page(`<meta property="og:url" content="${COM}/about-us/">`)), []);
  assert.deepEqual(switched.pageProblems(page(`<a href="mailto:info@tzionbreslov.com">info@tzionbreslov.com</a>`)), []);
});

test("calendar text never fails the deploy: pasted removed pages, both domains, a YouTube embed (I1)", () => {
  for (const guard of [today, switched, preview]) assert.deepEqual(guard.pageProblems(eventsPage(PASTED)), []);
});

test("after the switch, an href/src on tzionbreslov.com fails even inside an Events card (r1)", () => {
  // Cards never link calendar text today; if one ever did, its link must still fail.
  const linked = cards({}).replace("</h2>", `</h2><a href="${COM}/about-us/">more</a>`);
  const image = cards({}).replace("</h2>", `</h2><img src="http://www.tzionbreslov.com/wp-content/a.png">`);
  assert.deepEqual(switched.pageProblems(page(linked)), [`links to ${COM}/about-us/ after the site-URL switch`]);
  assert.deepEqual(switched.pageProblems(page(image.replace("www.", ""))), ["links to http://tzionbreslov.com/wp-content/a.png after the site-URL switch"]);
  assert.deepEqual(today.pageProblems(page(linked)), []);
});

test("single-quoted href/src attributes are read too", () => {
  assert.deepEqual(today.pageProblems(page(`<a href='/resources/'>x</a>`)), ["links to the removed page /resources/"]);
  assert.deepEqual(today.pageProblems(page(`<a class='x' href='${COM}/about/'>x</a>`)), ["links to the removed page /about/"]);
  assert.deepEqual(preview.pageProblems(page(`<img src='${BASE}/video/video-2/a.png'>`)), ["links to the removed page /video/video-2/a.png"]);
  assert.deepEqual(switched.pageProblems(page(`<a href='${ORG}/author/esti-wolo/'>x</a>`)), ["links to the removed page /author/esti-wolo/"]);
  assert.deepEqual(switched.pageProblems(page(`<link rel='icon' href='${COM}/favicon.ico'>`)), [
    "still references tzionbreslov.com after the site-URL switch",
    `links to ${COM}/favicon.ico after the site-URL switch`
  ]);
  assert.deepEqual(today.pageProblems(page(`<a href='/about-us/'>x</a>`)), []);
});

test("calendar text that spells a single-quoted attribute doesn't fail the deploy", () => {
  // lib/events.mjs escapes the calendar's " but not its ', so these reach the card as text.
  const typed = { title: "See href='/about/'", location: "src='https://tzionbreslov.com/resources/'",
    summary: "<a href='/video/video-3/'>the talk</a>, <img src='https://tzionbreslov.org/about/'>" };
  for (const guard of [today, switched, preview]) assert.deepEqual(guard.pageProblems(eventsPage(typed)), []);
});

test("the importer's leftovers, a plain YouTube embed, a bare / under a base path and a foreign canonical fail", () => {
  assert.deepEqual(today.pageProblems(page(`<img src="http://localhost:8088/wp-content/a.png">`)), ["still references localhost:8088"]);
  assert.deepEqual(today.pageProblems(page(`<img src="https://estiwolo.com/wp-content/a.png">`)), ["still references the dead staging host"]);
  assert.deepEqual(today.pageProblems(page(`<script>fetch("/wp-admin/admin-ajax.php")</script>`)), ["references admin-ajax"]);
  assert.deepEqual(today.pageProblems(page(`<script>var uagb_data = {"ajax_url":"/wp-admin/admin-ajax.php"};</script>`)), []);
  assert.deepEqual(today.pageProblems(page(`<iframe src="https://www.youtube.com/embed/abc"></iframe>`)), ["still embeds a plain YouTube player"]);
  assert.deepEqual(today.pageProblems(page(`<iframe src="https://www.youtube-nocookie.com/embed/abc"></iframe>`)), []);
  assert.deepEqual(preview.pageProblems(page(`<a href="/">Home</a>`)), [`links to "/" without the base path ${BASE}`]);
  assert.deepEqual(switched.pageProblems(page("", `<link rel="canonical" href="https://example.org/">`)), ["canonical is https://example.org/"]);
});

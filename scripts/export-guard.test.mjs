import { strict as assert } from "node:assert";
import fs from "node:fs";
import test from "node:test";
import copy from "../content/copy/en.json" with { type: "json" };
import { emailSlot, phoneSlot } from "../lib/contact-details.mjs";
import { renderAnnouncements, renderEventsList } from "../lib/events.mjs";
import { CONTACT_OG_DESCRIPTION, contactDetailsProblems, exportGuard, withoutEventCards } from "./lib/export-guard.mjs";

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

test("an apostrophe inside a double-quoted href/src is part of its path", () => {
  // The cut-off at ' and \ is for URLs found in the text; an attribute value ends at its own quote.
  for (const guard of [today, switched]) {
    assert.deepEqual(guard.pageProblems(page(`<a href="/video's-page">x</a>`)), []);
    assert.deepEqual(guard.pageProblems(page(flight(`<a href="/video's-page">x</a>`))), []);
  }
  assert.deepEqual(preview.pageProblems(page(`<a href="${BASE}/video's-page">x</a>`)), []);
  // A removed page is still reported, with the whole path.
  assert.deepEqual(today.pageProblems(page(`<a href="/video/it's-here/">x</a>`)), ["links to the removed page /video/it's-here/"]);
});

test("calendar text that spells a single-quoted attribute doesn't fail the deploy", () => {
  // lib/events.mjs escapes the calendar's " but not its ', so these reach the card as text.
  const typed = { title: "See href='/about/'", location: "src='https://tzionbreslov.com/resources/'",
    summary: "<a href='/video/video-3/'>the talk</a>, <img src='https://tzionbreslov.org/about/'>" };
  for (const guard of [today, switched, preview]) assert.deepEqual(guard.pageProblems(eventsPage(typed)), []);
});

test("a removed page linked without its trailing slash fails", () => {
  assert.deepEqual(today.pageProblems(page(`<a href="/about">x</a>`)), ["links to the removed page /about"]);
  assert.deepEqual(today.pageProblems(page(`<a href="/resources?page=2">x</a>`)), ["links to the removed page /resources"]);
  assert.deepEqual(today.pageProblems(page(`<a href="/video">x</a>`)), ["links to the removed page /video"]);
  assert.deepEqual(today.pageProblems(page(`<a href="${COM}/about#team">x</a>`)), ["links to the removed page /about"]);
  assert.deepEqual(preview.pageProblems(page(`<a href="${BASE}/resources/page/2">x</a>`)), ["links to the removed page /resources/page/2"]);
  assert.deepEqual(switched.pageProblems(page(`<a href='${ORG}/category/uncategorized'>x</a>`)), ["links to the removed page /category/uncategorized"]);
  // Under a removed section it already failed.
  assert.deepEqual(today.pageProblems(page(`<a href="/video/video-3">x</a>`)), ["links to the removed page /video/video-3"]);
  // In the text (JSON-LD, sitemaps) too.
  assert.deepEqual(today.removedRefs(`<loc>${COM}/about</loc>`), ["/about"]);
  assert.deepEqual(today.pageProblems(page("", `<script type="application/ld+json">{"url":"https:\\/\\/tzionbreslov.com\\/resources"}</script>`)),
    ["links to the removed page /resources"]);
});

test("without the trailing slash, live pages and files still never match a removed page", () => {
  for (const path of ["/about-us", "/about-us/", "/about/team", "/aboutus", "/about.html", "/resources.pdf", "/videos",
    "/wp-content/uploads/about", `${BASE}`]) {
    assert.deepEqual(today.pageProblems(page(`<a href="${path}">x</a><p>${COM}${path}</p>`)), [], path);
  }
});

test("the site's origin is matched over http and https, with or without www (and protocol-relative)", () => {
  assert.deepEqual(today.pageProblems(page(`<a href="http://tzionbreslov.com/about/">x</a>`)), ["links to the removed page /about/"]);
  assert.deepEqual(today.pageProblems(page(`<a href="https://www.tzionbreslov.com/resources/">x</a>`)), ["links to the removed page /resources/"]);
  assert.deepEqual(today.pageProblems(page(`<a href='http://www.tzionbreslov.com/video/video-1'>x</a>`)), ["links to the removed page /video/video-1"]);
  assert.deepEqual(today.pageProblems(page(`<img src="//tzionbreslov.com/author/esti-wolo/a.png">`)), ["links to the removed page /author/esti-wolo/a.png"]);
  assert.deepEqual(switched.pageProblems(page(`<a href="http://www.tzionbreslov.org/about">x</a>`)), ["links to the removed page /about"]);
  assert.deepEqual(switched.pageProblems(page(`<p>See http://tzionbreslov.org/category/uncategorized/ for more.</p>`)),
    ["links to the removed page /category/uncategorized/"]);
  assert.deepEqual(switched.pageProblems(page("", `<script type="application/ld+json">{"url":"https:\\/\\/www.tzionbreslov.org\\/resources\\/"}</script>`)),
    ["links to the removed page /resources/"]);
});

test("after the switch, tzionbreslov.com with www fails too", () => {
  assert.deepEqual(switched.pageProblems(page(`<meta property="og:url" content="https://www.tzionbreslov.com/">`)),
    ["still references tzionbreslov.com after the site-URL switch"]);
  assert.equal(switched.mentionsOldDomain(String.raw`{"url":"http:\/\/www.tzionbreslov.com\/"}`), true);
  const linked = cards({}).replace("</h2>", `</h2><a href="http://www.tzionbreslov.com/donate/">give</a>`);
  assert.deepEqual(switched.pageProblems(page(linked)), ["links to http://www.tzionbreslov.com/donate/ after the site-URL switch"]);
});

test("a www site URL on the imported domain is no site-URL switch; a www one on another domain is", () => {
  const www = exportGuard({ production: "https://www.tzionbreslov.com" });
  assert.equal(www.switched, false);
  assert.deepEqual(www.pageProblems(page(`<a href="https://www.tzionbreslov.com/about-us/">x</a>`,
    `<link rel="canonical" href="https://www.tzionbreslov.com/about-us/">`)), []);
  assert.equal(www.mentionsOldDomain(`<loc>https://www.tzionbreslov.com/about-us/</loc>`), false);
  assert.deepEqual(www.pageProblems(page(`<a href="https://www.tzionbreslov.com/about/">x</a>`)), ["links to the removed page /about/"]);
  assert.equal(exportGuard({ production: "https://www.tzionbreslov.org" }).switched, true);
});

test("other hosts are never the site's origin: localhost:8088, subdomains, look-alikes", () => {
  assert.deepEqual(today.pageProblems(page(`<a href="http://localhost:8088/about/">x</a>`)), ["still references localhost:8088"]);
  for (const url of ["https://api.tzionbreslov.org/resources/", "https://tzionbreslov.org.example.com/about/", "https://nottzionbreslov.org/about/",
    "https://tzionbreslov.org:8443/about/", "https://example.org/?u=tzionbreslov.org/about/"]) {
    assert.deepEqual(switched.pageProblems(page(`<a href="${url}">x</a><p>${url}</p>`)), [], url);
  }
});

test("links in Next's flight data are read too: escaped href=\\\"…\\\" attributes and URLs ending in \\\"", () => {
  // Only in the flight data (the HTML never holds them in these tests).
  assert.deepEqual(today.pageProblems(page(flight(`<a href="/resources/">x</a>`))), ["links to the removed page /resources/"]);
  assert.deepEqual(today.pageProblems(page(flight(`<a href="/resources/?a=1&b=2">x</a>`))), ["links to the removed page /resources/"]);
  assert.deepEqual(preview.pageProblems(page(flight(`<a href="${BASE}/about">x</a>`))), ["links to the removed page /about"]);
  assert.deepEqual(today.pageProblems(page(flight(`<a href="${COM}/about/">x</a>`))), ["links to the removed page /about/"]);
  // A string inside a JSON row is escaped twice (href=\\\"…\\\").
  assert.deepEqual(today.pageProblems(page(flight(JSON.stringify(`<a href="/video/video-9/">x</a>`)))), ["links to the removed page /video/video-9/"]);
  const linked = cards({}).replace("</h2>", `</h2><a href="${COM}/about-us/">more</a>`);
  assert.deepEqual(switched.pageProblems(page(flight(linked))), [`links to ${COM}/about-us/ after the site-URL switch`]);
});

test("calendar text in the flight data still never fails the deploy, backslashes and all", () => {
  const typed = { title: String.raw`See href=\"/resources/\"`, location: String.raw`src=\"https://tzionbreslov.com/about/\"`,
    summary: String.raw`https://tzionbreslov.com/about/\" and <a href=\"/video/video-3/\">x</a> and <a href='/about/'>` };
  for (const guard of [today, switched, preview]) assert.deepEqual(guard.pageProblems(eventsPage(typed)), []);
  for (const guard of [today, switched, preview]) assert.deepEqual(guard.pageProblems(page(flight(cards(typed)))), []);
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

// ------------------------------------------------------------ The covered contact details (lib/contact-details.mjs)
// Nothing an exported page or its RSC payloads hold may give a bot the old number, the email address, or a mailto:,
// tel:, wa.me or api.whatsapp.com link: only the Contact page's link-preview text (owner: "leave as is") and the
// Events page's cards and no-JavaScript lines (owner: kept written out) may.
const EMAIL = "tzionbreslovproject@gmail.com";
/** The page's head metadata as an RSC payload (.txt) holds it, and as the HTML's flight data does. */
const metaRow = (content) => `["$","meta","h6",{"property":"og:description","content":${JSON.stringify(content)}}]`;
const announcementsLine = () => renderAnnouncements(copy.announcements);

test("a covered page passes, on any route, with or without its Show buttons, in the HTML and the flight data", () => {
  for (const formsOn of [false, true]) {
    const body = `<p>${emailSlot({ formsOn, variant: "footer" })}</p><p>${phoneSlot({ formsOn, variant: "card" })}</p>` +
      `<p>write to ${emailSlot({ formsOn, variant: "inline" })}.</p>`;
    for (const route of ["/", "/contact/", "/privacy/", "/events/", "/404/"]) {
      assert.deepEqual(contactDetailsProblems(route, page(body + flight(body))), [], `${route} ${formsOn}`);
    }
  }
  // Words like "hotel:" are not a tel: link.
  assert.deepEqual(contactDetailsProblems("/", page("<p>Hotel: the Inn. Motel: none.</p>")), []);
});

test("each detail fails, in the HTML, the flight data and an RSC payload, whatever its case", () => {
  const cases = [
    ["(+972) 54-671-3013", "holds the old phone number (1×)"],
    [`<a href="mailto:someone@example.com">write</a>`, "holds a mailto: link (1×)"],
    [`<a href="MAILTO:someone@example.com">write</a>`, "holds a mailto: link (1×)"],
    [`<a href="tel:+15555550123">call</a>`, "holds a tel: link (1×)"],
    [`<a href="https://wa.me/15555550123">chat</a>`, "holds a wa.me link (1×)"],
    [`<a href="https://api.whatsapp.com/send?phone=1">chat</a>`, "holds an api.whatsapp.com link (1×)"],
    [EMAIL, "holds the email address (1×)"],
    ["TzionBreslovProject@gmail.com", "holds the email address (1×)"]
  ];
  for (const [html, problem] of cases) {
    assert.deepEqual(contactDetailsProblems("/", page(`<p>${html}</p>`)), [problem], html);
    assert.deepEqual(contactDetailsProblems("/", page(flight(`<p>${html}</p>`))), [problem], `${html} (flight)`);
    assert.deepEqual(contactDetailsProblems("/about-us/", `1:${JSON.stringify(["$", "p", null, { children: html }])}`), [problem], `${html} (.txt)`);
  }
  // A mailto link to the address holds both, each counted.
  assert.deepEqual(contactDetailsProblems("/", page(`<a href="mailto:${EMAIL}">${EMAIL}</a><a href="mailto:${EMAIL}">${EMAIL}</a>`)),
    ["holds the email address (4×)", "holds a mailto: link (2×)"]);
});

test("the Contact page's link-preview text passes there, exactly as the owner left it, and nowhere else", () => {
  const head = `<meta property="og:description" content="${CONTACT_OG_DESCRIPTION}"/>`;
  const html = page(flight(metaRow(CONTACT_OG_DESCRIPTION)), head);
  assert.deepEqual(contactDetailsProblems("/contact/", html), []);
  assert.deepEqual(contactDetailsProblems("/contact/", `0:${metaRow(CONTACT_OG_DESCRIPTION)}\n`), []);
  // On any other page, it is the old number and the address.
  assert.deepEqual(contactDetailsProblems("/", html), ["holds the old phone number (2×)", "holds the email address (2×)"]);
  // Only that exact text: changed, or with its no-break space gone, it fails; so does a detail beside it.
  const changed = CONTACT_OG_DESCRIPTION.replace("Try Us!", "Call us!");
  assert.deepEqual(contactDetailsProblems("/contact/", page("", `<meta property="og:description" content="${changed}"/>`)),
    ["holds the old phone number (1×)", "holds the email address (1×)"]);
  const plain = CONTACT_OG_DESCRIPTION.replace("\u00a0", " ");
  assert.deepEqual(contactDetailsProblems("/contact/", `0:${metaRow(plain)}\n`), ["holds the old phone number (1×)", "holds the email address (1×)"]);
  assert.deepEqual(contactDetailsProblems("/contact/", page(`<p><strong>${EMAIL}</strong></p>`, head)), ["holds the email address (1×)"]);
  // Another tag with the same text is no exception.
  assert.deepEqual(contactDetailsProblems("/contact/", page("", `<meta name="description" content="${CONTACT_OG_DESCRIPTION}"/>`)),
    ["holds the old phone number (1×)", "holds the email address (1×)"]);
});

test("the exception is the Contact page's og:description as imported (content/pages/contact.json), no-break space and all", () => {
  const { head } = JSON.parse(fs.readFileSync(new URL("../content/pages/contact.json", import.meta.url), "utf8"));
  const og = head.filter((item) => item.t === "meta" && item.attrs.property === "og:description");
  assert.equal(og.length, 1);
  assert.equal(og[0].attrs.content, CONTACT_OG_DESCRIPTION);
  assert.ok(CONTACT_OG_DESCRIPTION.includes("tzionbreslovproject@gmail.com \u00a0Beit Shemesh"));
});

test("the Events page's cards and its no-JavaScript lines keep the address there, and only there", () => {
  const events = page(cards({ rsvp: "open" }) + announcementsLine() + flight(cards({ rsvp: "open" }) + announcementsLine()));
  assert.ok(events.includes(`mailto:${EMAIL}`));
  assert.deepEqual(contactDetailsProblems("/events/", events), []);
  assert.deepEqual(contactDetailsProblems("/events/", `0:"$Sreact.fragment"\n2:T80,${announcementsLine()}\n`), []);
  assert.notDeepEqual(contactDetailsProblems("/", events), []);
  // Anything else on the Events page still fails.
  assert.deepEqual(contactDetailsProblems("/events/", page(`${announcementsLine()}<p>${EMAIL}</p>`)), ["holds the email address (1×)"]);
});

import { strict as assert } from "node:assert";
import fs from "node:fs";
import test from "node:test";
import { isRemovedPath } from "../config/site-structure.mjs";
import { applyApprovedChanges, extractPlaceholders, extractWording, isOrderedSubsequence } from "./lib/wording.mjs";

test("extractWording lists the title, every text node in order and image alt text, skipping scripts", () => {
  const html = `<!doctype html><html><head><title>About - Tzion Breslov</title></head>
    <body><p>Enrich <strong>your</strong> life</p><img src="/a.png" alt="Rabbi"><script>var x="no"</script></body></html>`;
  assert.deepEqual(extractWording(html), ["title:About - Tzion Breslov", "Enrich", "your", "life", "alt:Rabbi"]);
});

test("extractWording collapses whitespace, decodes entities and keeps hidden text, but skips style/noscript/template/comments", () => {
  const html = `<html><head><title> Page &amp;  more </title><style>p{}</style></head><body>
    <h1>  Taste&nbsp;A
      Class </h1>
    <div hidden>Hidden &#8211; still wording</div>
    <style>.x{color:red}</style><noscript>Enable JS</noscript><template><p>Later</p></template><!-- a comment -->
    <img alt=""><img alt="  Logo  "><img src="/no-alt.png">
  </body></html>`;
  assert.deepEqual(extractWording(html), ["title:Page & more", "Taste A Class", "Hidden – still wording", "alt:Logo"]);
});

test("extractWording omits an empty title", () => {
  assert.deepEqual(extractWording("<html><head><title> </title></head><body><p>Hi</p></body></html>"), ["Hi"]);
});

test("extractPlaceholders lists every placeholder in <body> in order, collapsed, which extractWording leaves out", () => {
  const html = `<html><head><title>Contact</title></head><body>
    <form><input type="text" name="name" placeholder="Name"><input type="email" placeholder="  Email
      address "><textarea placeholder="Message"></textarea><input type="submit" value="Send"></form>
    <footer><input type="email" placeholder="Email address"></footer>
  </body></html>`;
  assert.deepEqual(extractPlaceholders(html), ["Name", "Email address", "Message", "Email address"]);
  assert.deepEqual(extractWording(html), ["title:Contact"]);
});

test("extractPlaceholders skips empty placeholders, the head and script/style/noscript/template", () => {
  const html = `<html><head><title>T</title></head><body>
    <input placeholder=""><input placeholder="   "><input>
    <template><input placeholder="Later"></template><noscript><input placeholder="No JS"></noscript>
    <script>document.write('<input placeholder="Scripted">')</script>
    <p>Text, no placeholder</p><input placeholder="Kept">
  </body></html>`;
  assert.deepEqual(extractPlaceholders(html), ["Kept"]);
  assert.deepEqual(extractPlaceholders("<html><body><p>None</p></body></html>"), []);
});

test("isOrderedSubsequence accepts new entries inserted around the baseline", () => {
  assert.deepEqual(
    isOrderedSubsequence(["About", "Resources", "Contact"], ["Home", "About", "Resources", "Classes", "Articles", "Contact"]),
    { ok: true }
  );
});

test("isOrderedSubsequence fails on a changed word", () => {
  const result = isOrderedSubsequence(["Enrich your life"], ["Enrich your lives"]);
  assert.equal(result.ok, false);
  assert.equal(result.index, 0);
  assert.equal(result.expected, "Enrich your life");
  assert.deepEqual(result.context, ["Enrich your lives"]);
});

test("isOrderedSubsequence fails when entries are reordered", () => {
  const result = isOrderedSubsequence(["About", "Contact"], ["Contact", "About"]);
  assert.equal(result.ok, false);
  assert.equal(result.index, 1);
  assert.equal(result.expected, "Contact");
});

test("isOrderedSubsequence fails when a relinked button loses its label", () => {
  const result = isOrderedSubsequence(["Read my full story"], ["Read more"]);
  assert.equal(result.ok, false);
  assert.equal(result.index, 0);
});

test("isOrderedSubsequence context shows up to 5 current entries from where the missing one was expected", () => {
  const result = isOrderedSubsequence(["A", "B", "Z"], ["A", "B", "c1", "c2", "c3", "c4", "c5", "c6"]);
  assert.equal(result.ok, false);
  assert.equal(result.index, 2);
  assert.deepEqual(result.context, ["c1", "c2", "c3", "c4", "c5"]);
});

// The owner-approved changes (tests/wording/owner-approved.json), applied to the baseline before the check compares.
const change = (overrides) => ({ date: "2026-11-08", owner: ["the owner's words"], routes: ["/"], ...overrides });
const BASELINE = {
  "/": ["Welcome", "© 2026 Tzion Beslov | Site by", "Esti Wolo", "Footer"],
  "/contact/": ["Card", "Card", "© 2026 Tzion Beslov | Site by", "Esti Wolo"],
  "/old-page/": ["Esti Wolo"]
};
const checked = (route) => route !== "/old-page/";

test("an approved change replaces its node, or drops it, and the page is then checked against that", () => {
  const changes = [
    change({ text: "© 2026 Tzion Beslov | Site by", to: "© 2026 Tzion Breslov", routes: ["/", "/contact/"] }),
    change({ text: "Esti Wolo", to: null, routes: ["/", "/contact/"] })
  ];
  const { baseline, problems } = applyApprovedChanges(BASELINE, changes, checked);
  assert.deepEqual(problems, []);
  assert.deepEqual(baseline, {
    "/": ["Welcome", "© 2026 Tzion Breslov", "Footer"],
    "/contact/": ["Card", "Card", "© 2026 Tzion Breslov"],
    "/old-page/": ["Esti Wolo"]
  });
  // The baseline it was given is left as it was.
  assert.deepEqual(BASELINE["/"], ["Welcome", "© 2026 Tzion Beslov | Site by", "Esti Wolo", "Footer"]);
  assert.deepEqual(isOrderedSubsequence(baseline["/"], ["Welcome", "© 2026 Tzion Breslov", "Footer"]), { ok: true });
  // The new text has to be there: a page that only lost the old line fails.
  assert.equal(isOrderedSubsequence(baseline["/"], ["Welcome", "Footer"]).ok, false);
});

test("a change that isn't listed still fails the check", () => {
  // Only the name is approved: a page whose credit line changed too still fails.
  const { baseline, problems } = applyApprovedChanges(BASELINE, [change({ text: "Esti Wolo", to: null })], checked);
  assert.deepEqual(problems, []);
  const result = isOrderedSubsequence(baseline["/"], ["Welcome", "© 2026 Tzion Breslov", "Footer"]);
  assert.equal(result.ok, false);
  assert.equal(result.expected, "© 2026 Tzion Beslov | Site by");
  // So does a listed text changed to something other than what was approved.
  const approved = applyApprovedChanges(BASELINE, [change({ text: "Welcome", to: "Hello" })], checked).baseline;
  assert.equal(isOrderedSubsequence(approved["/"], ["Hi", "© 2026 Tzion Beslov | Site by", "Esti Wolo", "Footer"]).ok, false);
  // And so does an approved change on a route the entry doesn't list.
  const one = applyApprovedChanges(BASELINE, [change({ text: "Esti Wolo", to: null, routes: ["/"] })], checked).baseline;
  assert.equal(isOrderedSubsequence(one["/contact/"], ["Card", "Card", "© 2026 Tzion Beslov | Site by"]).ok, false);
});

test("every entry must be used: one whose text isn't on a route is a stale entry", () => {
  const { problems } = applyApprovedChanges(BASELINE, [change({ text: "Gone", to: "New" })], checked);
  assert.deepEqual(problems, ['owner-approved change 1 ("Gone"): not on / (a stale entry)']);
  // One route of several is enough to fail.
  const partly = applyApprovedChanges(BASELINE, [change({ text: "Welcome", to: "Hello", routes: ["/", "/contact/"] })], checked);
  assert.deepEqual(partly.problems, ['owner-approved change 1 ("Welcome"): not on /contact/ (a stale entry)']);
});

test("an entry matches only its exact node: never part of a node, nor two nodes", () => {
  // Part of a node is not the node.
  assert.deepEqual(applyApprovedChanges(BASELINE, [change({ text: "Site by", to: null })], checked).problems,
    ['owner-approved change 1 ("Site by"): not on / (a stale entry)']);
  assert.deepEqual(applyApprovedChanges(BASELINE, [change({ text: "© 2026 Tzion Beslov", to: "© 2026 Tzion Breslov" })], checked).problems,
    ['owner-approved change 1 ("© 2026 Tzion Beslov"): not on / (a stale entry)']);
  // A text that is two nodes on a route would change both: it fails instead.
  assert.deepEqual(applyApprovedChanges(BASELINE, [change({ text: "Card", to: "Box", routes: ["/contact/"] })], checked).problems,
    ['owner-approved change 1 ("Card"): matches 2 nodes on /contact/, not one']);
  // Two entries can't claim the same node, nor one entry list a route twice.
  assert.deepEqual(applyApprovedChanges(BASELINE, [change({ text: "Welcome", to: "Hello" }), change({ text: "Welcome", to: "Hi" })], checked).problems,
    ['owner-approved change 2 ("Welcome"): / already has a change for this text']);
  assert.deepEqual(applyApprovedChanges(BASELINE, [change({ text: "Welcome", to: "Hello", routes: ["/", "/"] })], checked).problems,
    ['owner-approved change 1 ("Welcome"): / already has a change for this text']);
});

test("an entry needs a page the check reads, a date, the owner's words, its text and a new text (or null)", () => {
  const problems = (overrides) => applyApprovedChanges(BASELINE, [change({ text: "Welcome", to: "Hello", ...overrides })], checked).problems;
  assert.deepEqual(problems({ routes: ["/old-page/"] }), ['owner-approved change 1 ("Welcome"): /old-page/ is not a page the check reads']);
  assert.deepEqual(problems({ routes: ["/nowhere/"] }), ['owner-approved change 1 ("Welcome"): /nowhere/ is not a page the check reads']);
  assert.deepEqual(problems({ routes: [] }), ['owner-approved change 1 ("Welcome"): no routes']);
  assert.deepEqual(problems({ date: "" }), ['owner-approved change 1 ("Welcome"): no date']);
  assert.deepEqual(problems({ date: "8 Nov 2026" }), ['owner-approved change 1 ("Welcome"): no date']);
  assert.deepEqual(problems({ owner: [] }), ["owner-approved change 1 (\"Welcome\"): no owner's words"]);
  assert.deepEqual(problems({ owner: "remove it" }), ["owner-approved change 1 (\"Welcome\"): no owner's words"]);
  assert.deepEqual(problems({ owner: [" "] }), ["owner-approved change 1 (\"Welcome\"): no owner's words"]);
  assert.deepEqual(problems({ to: undefined }), ['owner-approved change 1 ("Welcome"): no new text (or null for a removed node)']);
  assert.deepEqual(problems({ to: " " }), ['owner-approved change 1 ("Welcome"): no new text (or null for a removed node)']);
  assert.deepEqual(problems({ to: "Welcome" }), ['owner-approved change 1 ("Welcome"): its new text is the same']);
  assert.deepEqual(problems({ text: "" }), ['owner-approved change 1 (""): no text']);
});

test("the committed list applies to the committed baseline cleanly: the footer's credit line on every page the check reads", () => {
  const read = (file) => JSON.parse(fs.readFileSync(new URL(`../tests/wording/${file}`, import.meta.url), "utf8"));
  const baseline = read("checkpoint-001.json");
  const { changes } = read("owner-approved.json");
  const isChecked = (route) => !isRemovedPath(route);
  const result = applyApprovedChanges(baseline, changes, isChecked);
  assert.deepEqual(result.problems, []);
  assert.deepEqual(changes.map(({ text, to, date }) => [text, to, date]), [
    ["© 2026 Tzion Beslov | Site by", "© 2026 Tzion Breslov", "2026-11-08"],
    ["Esti Wolo", null, "2026-11-08"]
  ]);
  const routes = Object.keys(baseline).filter(isChecked);
  assert.equal(routes.length, 23);
  for (const entry of changes) assert.deepEqual(entry.routes, routes, entry.text);
  for (const [route, nodes] of Object.entries(result.baseline)) {
    if (!isChecked(route)) {
      assert.deepEqual(nodes, baseline[route], route);
      continue;
    }
    // Every page the check reads loses the linked name and has the new line where the old one was.
    const at = baseline[route].indexOf("© 2026 Tzion Beslov | Site by");
    assert.deepEqual(nodes, [...baseline[route].slice(0, at), "© 2026 Tzion Breslov", ...baseline[route].slice(at + 2)], route);
    assert.equal(baseline[route][at + 1], "Esti Wolo", route);
  }
});

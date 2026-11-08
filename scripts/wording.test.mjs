import { strict as assert } from "node:assert";
import test from "node:test";
import { extractPlaceholders, extractWording, isOrderedSubsequence } from "./lib/wording.mjs";

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

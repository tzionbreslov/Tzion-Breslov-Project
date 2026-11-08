import { strict as assert } from "node:assert";
import test from "node:test";
import { esc as editsEsc } from "../lib/pages/edits.mjs";
import { esc } from "../lib/html.mjs";

test("esc escapes &, <, > and \" for HTML text and double-quoted attributes", () => {
  assert.equal(esc(""), "");
  assert.equal(esc("plain text"), "plain text");
  assert.equal(esc(`Tom & Jerry <b class="x">`), "Tom &amp; Jerry &lt;b class=&quot;x&quot;&gt;");
  assert.equal(esc("<script>alert(1)</script>"), "&lt;script&gt;alert(1)&lt;/script&gt;");
});

test("esc escapes & first, so text that looks like an entity stays as written", () => {
  assert.equal(esc("&lt;"), "&amp;lt;");
  assert.equal(esc("&amp;"), "&amp;amp;");
  assert.equal(esc("&quot;"), "&amp;quot;");
});

test("esc leaves ' and everything else as it is (every page's markup quotes attributes with \")", () => {
  assert.equal(esc("it's"), "it's");
  assert.equal(esc("$& $' $$"), "$&amp; $' $$");
  assert.equal(esc("ü 🙂  \nnew line"), "ü 🙂  \nnew line");
});

test("esc needs a string, as the copies it replaces did", () => {
  for (const value of [undefined, null, 42]) assert.throws(() => esc(value), TypeError);
});

test("lib/pages/edits.mjs re-exports the same esc", () => {
  assert.equal(editsEsc, esc);
});

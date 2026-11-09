import { strict as assert } from "node:assert";
import fs from "node:fs";
import test from "node:test";
import { load } from "cheerio";
import { editArticleAuthor, editFooterCredit } from "../lib/pages/edits.mjs";
import { renderNavigation } from "../lib/navigation.mjs";

// The owner's edits of 2026-11-08 (lib/pages/edits.mjs), on the imported fragments and pages as they are.
const read = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const pageJson = (key) => JSON.parse(read(`content/pages/${key}.json`));
const PAGE_KEYS = fs.readdirSync(new URL("../content/pages/", import.meta.url)).map((file) => file.replace(/\.json$/, ""));
const FOOTERS = [...new Set(PAGE_KEYS.map((key) => pageJson(key).footer).filter(Boolean))].sort();
const CREDIT = /<p class="has-text-align-center[^>]*>.*?<\/p>/s;

test("every imported page's footer is one of five variants, and each holds the credit line once", () => {
  // The composed pages (/classes/, /articles/, …) use the Resources page's footer (lib/pages/compose.ts).
  assert.deepEqual(FOOTERS, ["fragments/0deaa75ac4e9.html", "fragments/5b8a845aead8.html", "fragments/b3b875b5ee47.html",
    "fragments/c215e6be2de2.html", "fragments/eacacdcdfaec.html"]);
  for (const ref of FOOTERS) {
    const html = read(`content/${ref}`);
    assert.equal(html.split("© 2026 Tzion Beslov | Site by").length, 2, ref);
    assert.equal(html.split("Esti Wolo").length, 2, ref);
  }
});

for (const ref of FOOTERS) {
  test(`the footer ${ref} reads "© 2026 Tzion Breslov" in the credit's own paragraph, and nothing else changes`, () => {
    const before = read(`content/${ref}`);
    const after = editFooterCredit(before);
    const $ = load(after);
    const $before = load(before);
    const credit = $("p.has-text-align-center.has-14-font-size");
    assert.equal(credit.length, 1);
    assert.equal(credit.text(), "© 2026 Tzion Breslov");
    // No link left in it, and the same paragraph: its classes and style as they were.
    assert.equal(credit.children().length, 0);
    const old = $before("p.has-text-align-center.has-14-font-size");
    assert.equal(credit.attr("class"), old.attr("class"));
    assert.equal(credit.attr("style"), old.attr("style"));
    for (const gone of ["Site by", "Esti Wolo", "estiwolo", "Beslov"]) assert.ok(!after.includes(gone), gone);
    assert.equal(after.replace(CREDIT, ""), before.replace(CREDIT, ""));
    // The Quick Links are still rendered into it.
    assert.match(renderNavigation(after, "/contact/"), /<ul id="menu-mobile-menu-1" class="menu"><li class="menu-item[^"]*"><a href="\/">Home<\/a>/);
  });
}

test("the footer credit edit fails loudly when the credit line isn't there exactly once", () => {
  const footer = read("content/fragments/5b8a845aead8.html");
  const missing = /structure: marker not found: footer credit line/;
  assert.throws(() => editFooterCredit(footer.replace("Tzion Beslov | Site by", "Tzion Breslov | Site by")), missing);
  assert.throws(() => editFooterCredit(footer.replace("Esti Wolo</a>", "Someone</a>")), missing);
  assert.throws(() => editFooterCredit(footer.replace('href="http://estiwolo.com"', 'href="https://example.com"')), missing);
  assert.throws(() => editFooterCredit(footer.replace(CREDIT, "")), missing);
  // Already edited: the edit is not silently a no-op.
  assert.throws(() => editFooterCredit(editFooterCredit(footer)), missing);
  assert.throws(() => editFooterCredit(footer + footer.match(CREDIT)[0]), /structure: marker not unique: footer credit line/);
});

// The articles' author in their hidden page data: <meta name="author">, twitter:data1 ("Written by") and the JSON-LD.
const ARTICLES = PAGE_KEYS.filter((key) => /^para?sha/.test(key));
const jsonLd = (head) => head.filter((item) => item.t === "jsonld").map((item) => JSON.parse(item.json));
const meta = (head, name) => head.filter((item) => item.t === "meta" && item.attrs.name === name).map((item) => item.attrs.content);

test("the 18 Parasha articles name Tzion Breslov as their author in their head, with no image of the old one", () => {
  assert.equal(ARTICLES.length, 18);
  for (const key of ARTICLES) {
    const { head } = pageJson(key);
    const edited = editArticleAuthor(head);
    assert.deepEqual(meta(edited, "author"), ["Tzion Breslov"], key);
    assert.deepEqual(meta(edited, "twitter:label1"), ["Written by"], key);
    assert.deepEqual(meta(edited, "twitter:data1"), ["Tzion Breslov"], key);
    const [graph] = jsonLd(edited);
    const nodes = graph["@graph"];
    const article = nodes.filter((node) => node["@type"] === "Article");
    assert.equal(article.length, 1, key);
    assert.equal(article[0].author.name, "Tzion Breslov", key);
    const person = nodes.filter((node) => node["@type"] === "Person");
    assert.equal(person.length, 1, key);
    assert.equal(person[0]["@id"], article[0].author["@id"], key);
    assert.equal(person[0].name, "Tzion Breslov", key);
    // Her gravatar and its caption (her name) go with the image.
    assert.equal(person[0].image, undefined, key);
    const text = JSON.stringify(edited);
    for (const gone of ["Esti Wolo", "estiwolo", "gravatar"]) assert.ok(!text.includes(gone), `${key}: ${gone}`);
    // Everything else in the head, and in the graph, is as it was.
    assert.equal(edited.length, head.length, key);
    const [original] = jsonLd(head);
    const blank = (g) => JSON.stringify({
      ...g,
      "@graph": g["@graph"].map((node) => {
        if (node["@type"] === "Article") return { ...node, author: { ...node.author, name: "" } };
        if (node["@type"] === "Person") return { ...node, name: "", image: undefined };
        return node;
      })
    });
    assert.equal(blank(graph), blank(original), key);
    edited.forEach((item, i) => {
      if (item.t === "jsonld" || ["author", "twitter:data1"].includes(item.attrs?.name)) return;
      assert.equal(item, head[i], `${key}: head item ${i}`);
    });
  }
});

test("the author edit leaves the imported head as it is (the page cache shares it), and every other page's head untouched", () => {
  for (const key of PAGE_KEYS) {
    const { head } = pageJson(key);
    const before = structuredClone(head);
    const edited = editArticleAuthor(head);
    assert.deepEqual(head, before, key);
    if (!ARTICLES.includes(key)) assert.equal(edited, head, key);
  }
});

test("after the edit every page's JSON-LD still parses, its slashes escaped as Yoast writes them, and no head names Esti Wolo", () => {
  for (const key of PAGE_KEYS) {
    const edited = editArticleAuthor(pageJson(key).head);
    for (const item of edited.filter((i) => i.t === "jsonld")) {
      assert.doesNotThrow(() => JSON.parse(item.json), key);
      assert.ok(!/(?<!\\)\//.test(item.json), `${key}: an unescaped slash`);
      assert.ok(!/<\/?script/i.test(item.json), `${key}: a script tag in the JSON-LD`);
    }
    assert.ok(!JSON.stringify(edited).includes("Esti Wolo"), key);
  }
});

test("the author edit fails loudly when an article's head has moved: any of its four places missing or repeated", () => {
  const { head } = pageJson("parshat-noach-october-8-9-2021");
  const setMeta = (name, content) => head.map((item) => item.attrs?.name === name ? { ...item, attrs: { ...item.attrs, content } } : item);
  const withGraph = (edit) => head.map((item) => {
    if (item.t !== "jsonld") return item;
    const data = JSON.parse(item.json);
    edit(data["@graph"]);
    return { ...item, json: JSON.stringify(data) };
  });
  const find = (nodes, type) => nodes.find((node) => node["@type"] === type);
  assert.throws(() => editArticleAuthor(head.filter((item) => item.attrs?.name !== "author")), /marker not found: author meta/);
  assert.throws(() => editArticleAuthor([...head, head.find((item) => item.attrs?.name === "author")]), /marker not unique: author meta/);
  assert.throws(() => editArticleAuthor(setMeta("twitter:data1", "Someone")), /marker not found: twitter:data1 author/);
  assert.throws(() => editArticleAuthor(setMeta("twitter:label1", "Est. reading time")), /marker not found: twitter:label1 "Written by"/);
  assert.throws(() => editArticleAuthor(head.filter((item) => item.t !== "jsonld")), /marker not found: article JSON-LD/);
  assert.throws(() => editArticleAuthor(withGraph((nodes) => { find(nodes, "Article").author.name = "Someone"; })), /marker not found: JSON-LD Article author/);
  assert.throws(() => editArticleAuthor(withGraph((nodes) => { nodes.push({ ...find(nodes, "Article") }); })), /marker not unique: JSON-LD Article author/);
  assert.throws(() => editArticleAuthor(withGraph((nodes) => { nodes.push({ ...find(nodes, "Person") }); })), /marker not unique: JSON-LD Person/);
  assert.throws(() => editArticleAuthor(withGraph((nodes) => { find(nodes, "Person")["@id"] = "x"; })), /marker not found: JSON-LD Person/);
  assert.throws(() => editArticleAuthor(withGraph((nodes) => { find(nodes, "Person").image.caption = "Someone"; })), /marker not found: JSON-LD Person image/);
  // An article that names someone else (a re-import) is noticed, not passed over.
  const renamed = JSON.parse(JSON.stringify(head).replaceAll("Esti Wolo", "Someone Else"));
  assert.throws(() => editArticleAuthor(renamed), /marker not found: author meta/);
  // Anything that still names her afterwards (a new place a re-import added) fails too.
  assert.throws(() => editArticleAuthor([...head, { t: "meta", attrs: { property: "article:author", content: "Esti Wolo" } }]), /still names Esti Wolo/);
  // A page with no article signals at all that names her somewhere is noticed as well.
  assert.throws(() => editArticleAuthor([{ t: "meta", attrs: { name: "description", content: "By Esti Wolo" } }]), /marker not found: author meta/);
});

import { strict as assert } from "node:assert";
import fs from "node:fs";
import test from "node:test";
import { load } from "cheerio";
import {
  COVERED_PHONE,
  coveredEmail,
  editArticleEmail,
  editContactCards,
  editFooterContact,
  editSpeakingEmail,
  emailSlot,
  phoneSlot
} from "../lib/contact-details.mjs";
import { editFooterCredit } from "../lib/pages/edits.mjs";
import { renderNavigation } from "../lib/navigation.mjs";

// The covered contact details (lib/contact-details.mjs), on the imported fragments and pages as they are. The phone
// number itself is never in the site: a visitor's "Show" asks the forms Worker for it (lib/client/contact-details.ts).
const read = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
const pageJson = (key) => JSON.parse(read(`content/pages/${key}.json`));
const PAGE_KEYS = fs.readdirSync(new URL("../content/pages/", import.meta.url)).map((file) => file.replace(/\.json$/, ""));
const FOOTERS = [...new Set(PAGE_KEYS.map((key) => pageJson(key).footer).filter(Boolean))].sort();

const EMAIL = "tzionbreslovproject@gmail.com";
const OLD_PHONE = "(+972) 54-671-3013";
const BUTTONS = {
  phone: { text: "Show number", name: "Show number (phone and WhatsApp)" },
  email: { text: "Show email", name: "Show email address" }
};
/** Anything a bot could use: the old number, the address, a link to call, write or chat. */
const USABLE = /54-671-3013|tzionbreslovproject@gmail\.com|mailto:|tel:|wa\.me|whatsapp\.com/i;

/** The slots in `html`, each as the slot markup contract describes it (Task 5 depends on it). */
function slots(html) {
  const $ = load(html);
  return $("[data-tz-contact]").toArray().map((node) => {
    const slot = $(node);
    const value = slot.children(".tz-contact__value");
    const button = slot.children("button");
    return {
      kind: slot.attr("data-tz-contact"),
      className: slot.attr("class"),
      value: value.text(),
      live: value.attr("aria-live"),
      buttons: button.toArray().map((b) => ({
        text: $(b).text(),
        name: $(b).attr("aria-label"),
        type: $(b).attr("type"),
        hidden: $(b).attr("hidden") !== undefined,
        reveal: $(b).attr("data-tz-reveal") !== undefined,
        className: $(b).attr("class")
      })),
      check: slot.children(".tz-contact__check[data-tz-reveal-slot]").length,
      alert: slot.children('.tz-contact__message[role="alert"]').length,
      children: slot.children().toArray().map((child) => child.attribs.class)
    };
  });
}

test("the covered forms are exactly the owner's: (+1) 347-•••-•••• and tzion••••••@gmail.com (U+2022 bullets)", () => {
  assert.equal(COVERED_PHONE, "(+1) 347-•••-••••");
  assert.equal(coveredEmail(), "tzion••••••@gmail.com");
  assert.equal(coveredEmail("tzion"), "tzion••••••@gmail.com");
  assert.equal(coveredEmail("Tzion"), "Tzion••••••@gmail.com");
});

test("a slot without the forms is the covered value only: no button, check or message", () => {
  for (const html of [phoneSlot({ formsOn: false, variant: "footer" }), emailSlot({ formsOn: false, variant: "inline" })]) {
    assert.ok(!html.includes("<button"), html);
    const [slot] = slots(html);
    assert.deepEqual(slot.children, ["tz-contact__value"]);
    assert.equal(slot.live, "polite");
  }
});

test("a slot with the forms has its button (hidden until the page is ready), a place for the check and an alert", () => {
  const [phone] = slots(phoneSlot({ formsOn: true, variant: "card" }));
  assert.deepEqual(phone, {
    kind: "phone",
    className: "tz-contact tz-contact--card",
    value: COVERED_PHONE,
    live: "polite",
    buttons: [{ ...BUTTONS.phone, type: "button", hidden: true, reveal: true, className: "tz-contact__show" }],
    check: 1,
    alert: 1,
    children: ["tz-contact__value", "tz-contact__show", "tz-contact__check", "tz-contact__message"]
  });
  const [email] = slots(emailSlot({ formsOn: true, variant: "inline", lead: "Tzion" }));
  assert.equal(email.kind, "email");
  assert.equal(email.className, "tz-contact tz-contact--inline");
  assert.equal(email.value, "Tzion••••••@gmail.com");
  assert.deepEqual(email.buttons.map(({ text, name, hidden }) => ({ text, name, hidden })), [{ ...BUTTONS.email, hidden: true }]);
  // Inline markup only: it sits inside paragraphs, where a block element would close the <p>.
  for (const html of [phoneSlot({ formsOn: true, variant: "footer" }), emailSlot({ formsOn: true, variant: "inline" })]) {
    assert.ok(!/<(?:div|p|section|ul|ol|li|h\d)\b/.test(html), html);
    assert.ok(!USABLE.test(html), html);
  }
});

test("every imported page's footer is one of five variants, each with the email and the old number once", () => {
  assert.deepEqual(FOOTERS, ["fragments/0deaa75ac4e9.html", "fragments/5b8a845aead8.html", "fragments/b3b875b5ee47.html",
    "fragments/c215e6be2de2.html", "fragments/eacacdcdfaec.html"]);
  for (const ref of FOOTERS) {
    const html = read(`content/${ref}`);
    assert.equal(html.split(`<a href="mailto:${EMAIL}">${EMAIL}</a>`).length, 2, ref);
    assert.equal(html.split(OLD_PHONE).length, 2, ref);
  }
});

for (const ref of FOOTERS) {
  test(`the footer ${ref} covers its email and phone in their own paragraphs, and nothing else changes`, () => {
    const before = read(`content/${ref}`);
    for (const formsOn of [false, true]) {
      const after = editFooterContact(before, { formsOn });
      assert.ok(!USABLE.test(after), `${ref}: something usable is left`);
      const found = slots(after);
      assert.deepEqual(found.map((slot) => [slot.kind, slot.className, slot.value]), [
        ["email", "tz-contact tz-contact--footer", "tzion••••••@gmail.com"],
        ["phone", "tz-contact tz-contact--footer", COVERED_PHONE]
      ]);
      // The footer's own sign-up form has a button; the slots add their two only with the forms on.
      assert.equal((after.match(/<button/g) ?? []).length - (before.match(/<button/g) ?? []).length, formsOn ? 2 : 0);
      if (formsOn) {
        assert.deepEqual(found.map((slot) => slot.buttons.map(({ text, name }) => ({ text, name }))), [[BUTTONS.email], [BUTTONS.phone]]);
      }
      // Each slot is the only content of the paragraph that held the detail; the paragraph is as it was.
      const $ = load(after);
      const $before = load(before);
      const emailP = $('[data-tz-contact="email"]').parent();
      const phoneP = $('[data-tz-contact="phone"]').parent();
      assert.equal(emailP.prop("tagName"), "P");
      assert.equal(emailP.children().length, 1);
      assert.equal(emailP.attr("class"), $before(`a[href="mailto:${EMAIL}"]`).parent().attr("class"));
      assert.equal(emailP.attr("style"), "text-transform:lowercase");
      assert.equal(phoneP.attr("class"), "no-margin has-white-color has-text-color has-16-font-size wp-block-paragraph");
      assert.equal(phoneP.children().length, 1);
      // Outside the two slots, the footer is byte for byte the same.
      const blank = (html) => html.replace(/<span class="tz-contact [\s\S]*?<\/span><\/p>/g, "SLOT</p>")
        .replace(`<a href="mailto:${EMAIL}">${EMAIL}</a>`, "SLOT").replace(OLD_PHONE, "SLOT");
      assert.equal(blank(after), blank(before));
    }
    // It composes with the other footer edits and the menus.
    const both = renderNavigation(editFooterContact(editFooterCredit(before), { formsOn: true }), "/contact/");
    assert.match(both, /© 2026 Tzion Breslov/);
    assert.match(both, /<ul id="menu-mobile-menu-1" class="menu">/);
  });
}

test("the footer edit fails loudly when its email or phone isn't there exactly once", () => {
  const footer = read("content/fragments/5b8a845aead8.html");
  const on = { formsOn: false };
  assert.throws(() => editFooterContact(footer.replace(`mailto:${EMAIL}`, "mailto:someone@example.com"), on), /marker not found: footer email/);
  assert.throws(() => editFooterContact(footer.replace(OLD_PHONE, "(+972) 54-000-0000"), on), /marker not found: footer phone/);
  assert.throws(() => editFooterContact(footer + footer, on), /marker not unique: footer email/);
  // Already edited: never silently a no-op.
  assert.throws(() => editFooterContact(editFooterContact(footer, on), on), /marker not found: footer email/);
  // Its paragraph changed (another class): noticed, not covered somewhere else.
  assert.throws(() => editFooterContact(footer.replace('style="text-transform:lowercase"', 'style="text-transform:none"'), on), /marker not found: footer email/);
});

test("the Contact page's phone and email cards are covered the same way, in the card variant", () => {
  const { main } = pageJson("contact");
  for (const formsOn of [false, true]) {
    const after = editContactCards(main, { formsOn });
    assert.ok(!USABLE.test(after), "something usable is left in the cards");
    const found = slots(after);
    assert.deepEqual(found.map((slot) => [slot.kind, slot.className, slot.value, slot.buttons.length]), [
      ["phone", "tz-contact tz-contact--card", COVERED_PHONE, formsOn ? 1 : 0],
      ["email", "tz-contact tz-contact--card", "tzion••••••@gmail.com", formsOn ? 1 : 0]
    ]);
    // Inside the cards' own <strong>, in their own paragraphs.
    const $ = load(after);
    for (const kind of ["phone", "email"]) {
      const slot = $(`[data-tz-contact="${kind}"]`);
      assert.equal(slot.parent().prop("tagName"), "STRONG", kind);
      assert.equal(slot.parent().parent().prop("tagName"), "P", kind);
      assert.ok(slot.closest(".wp-block-group.box-shadow").length, kind);
    }
    assert.ok(after.includes("<strong>&nbsp;Beit Shemesh, Israel</strong>"));
  }
  assert.throws(() => editContactCards(editContactCards(main, { formsOn: false }), { formsOn: false }), /marker not found: contact phone card/);
  assert.throws(() => editContactCards(main.replace(`<a href="mailto:${EMAIL}">`, '<a href="mailto:x@example.com">'), { formsOn: false }), /marker not found: contact email card/);
});

test("the speaking paragraph keeps \"please email us at\", its email covered in bold, with no mailto", () => {
  const { main } = pageJson("resources");
  for (const formsOn of [false, true]) {
    const after = editSpeakingEmail(main, { formsOn });
    const $ = load(after);
    const slot = $('[data-tz-contact="email"]');
    assert.equal(slot.length, 1);
    assert.equal(slot.attr("class"), "tz-contact tz-contact--inline");
    const paragraph = slot.closest("p");
    assert.match(paragraph.text(), /^Rav David Yisrael Kalmus speaks .* please email us at\xa0tzion••••••@gmail\.com/);
    assert.equal(slot.parent().prop("tagName"), "STRONG");
    assert.equal(paragraph.find("a").length, 0);
    assert.ok(!/mailto:|tzionbreslovproject@gmail\.com/i.test($.html(paragraph)));
    assert.equal(slot.find("button").length, formsOn ? 1 : 0);
  }
  assert.throws(() => editSpeakingEmail(editSpeakingEmail(main, { formsOn: false }), { formsOn: false }), /marker not found: speaking email/);
});

test("the article \"Parshas Toldos\" reads \"Please email us at Tzion••••••@gmail.com.\" with no address left", () => {
  const { main } = pageJson("parshas-toldos-nov-5-6-2021");
  for (const formsOn of [false, true]) {
    const after = editArticleEmail(main, { formsOn });
    assert.ok(!/tzionbreslovproject@gmail\.com|mailto:/i.test(after));
    const $ = load(after);
    const slot = $('[data-tz-contact="email"]');
    assert.equal(slot.length, 1);
    assert.equal(slot.children(".tz-contact__value").text(), "Tzion••••••@gmail.com");
    assert.equal(slot.find("button").length, formsOn ? 1 : 0);
    // The paragraph as before, the address covered (and its trailing no-break space as it was).
    slot.find("button").remove();
    assert.equal(slot.parent().text(), "Do you have comments or suggestions for our upcoming newsletters? Want to sponsor our next " +
      "newsletter? Please email us at Tzion••••••@gmail.com.\xa0");
  }
  assert.throws(() => editArticleEmail(editArticleEmail(main, { formsOn: false }), { formsOn: false }), /marker not found: article email/);
  assert.throws(() => editArticleEmail(main + main, { formsOn: false }), /marker not unique: article email/);
});

// The covered contact details (owner, 2026-11-08/09: docs/superpowers/specs/2026-11-08-hidden-contact-details-design.md).
// The site shows the phone number and the email address partly covered, "(+1) 347-•••-••••" and
// "tzion••••••@gmail.com", so a bot reading the pages gets nothing usable; a person taps "Show", passes one Turnstile
// check, and lib/client/contact-details.ts fills every slot on the page from the forms Worker's answer
// (POST /v1/contact-details). The phone number itself is in no file of the site, only in the Worker's settings.
//
// Here: the slot markup, and the edits that put it into the imported HTML where each page is rendered
// (components/site-document.tsx, lib/pages/parts.ts): the footer of every page, the Contact page's phone and email
// cards, the "Live Speaking Engagements" paragraph (/classes/, /articles/) and the article "Parshas Toldos". The privacy
// notice places its own slot (lib/pages/privacy.ts). Each edit replaces only the detail (its text, and the mailto link
// around it) inside the paragraph that holds it, and fails the build if that isn't there exactly once (replaceOnce),
// so a re-import that moves it is noticed. Plain .mjs with no file access, so scripts/contact-details.test.mjs runs it.
import copy from "../content/copy/en.json" with { type: "json" };
import { esc, replaceOnce } from "./pages/edits.mjs";

/** The new number as the site shows it before "Show": its country and area code, the rest dotted (U+2022). */
export const COVERED_PHONE = "(+1) 347-•••-••••";

/** The email address as the site shows it before "Show": "tzion" (or "Tzion", as the article writes it), dotted, and the domain. */
export const coveredEmail = (lead = "tzion") => `${lead}••••••@gmail.com`;

const text = copy.contactDetails;
const BUTTONS = {
  phone: { label: text.showNumber, name: text.showNumberLabel },
  email: { label: text.showEmail, name: text.showEmailLabel }
};

/**
 * One covered detail. The contract lib/client/contact-details.ts relies on:
 * - the wrapper `[data-tz-contact="phone|email"]`, with the variant's class (footer, card or inline: app/enhancements.css);
 * - `.tz-contact__value`, a polite live region holding the covered text, which the reveal replaces with the links;
 * - only when the forms are on (the API and the Turnstile key were given at build time): the "Show" button, `hidden`
 *   until the enhancer is ready (Ruling R13: without JavaScript there is no button that does nothing), the place the
 *   Turnstile box mounts in, and the alert for a failed check.
 * Spans and a button only: the slot sits inside imported paragraphs, where a block element would end the <p>.
 */
function slot(kind, covered, { formsOn, variant }) {
  const button = BUTTONS[kind];
  const controls = formsOn
    ? `<button type="button" class="tz-contact__show" data-tz-reveal hidden aria-label="${esc(button.name)}">${esc(button.label)}</button>` +
      `<span class="tz-contact__check" data-tz-reveal-slot></span><span class="tz-contact__message" role="alert"></span>`
    : "";
  return `<span class="tz-contact tz-contact--${variant}" data-tz-contact="${kind}">` +
    `<span class="tz-contact__value" aria-live="polite">${esc(covered)}</span>${controls}</span>`;
}

/** @param {{ formsOn: boolean, variant: "footer" | "card" }} options */
export const phoneSlot = ({ formsOn, variant }) => slot("phone", COVERED_PHONE, { formsOn, variant });

/** @param {{ formsOn: boolean, variant: "footer" | "card" | "inline", lead?: "tzion" | "Tzion" }} options */
export const emailSlot = ({ formsOn, variant, lead = "tzion" }) => slot("email", coveredEmail(lead), { formsOn, variant });

// The imported markup, as WordPress wrote it. The footer's paragraph class differs by variant only in its
// wp-elements-N (content/fragments: 0deaa75ac4e9, 5b8a845aead8, b3b875b5ee47, c215e6be2de2, eacacdcdfaec).
const FOOTER_EMAIL = /(<p class="has-link-color has-16-font-size wp-elements-\d+ wp-block-paragraph" style="text-transform:lowercase">)<a href="mailto:tzionbreslovproject@gmail\.com">tzionbreslovproject@gmail\.com<\/a>(<\/p>)/;
const FOOTER_PHONE = /(<p class="no-margin has-white-color has-text-color has-16-font-size wp-block-paragraph">)\(\+972\) 54-671-3013(<\/p>)/;
const CARD_PHONE = /(<p class="has-text-align-center has-dark-blue-color has-text-color has-18-font-size wp-block-paragraph"><strong>)\(\+972\) 54-671-3013(<\/strong><\/p>)/;
const CARD_EMAIL = /(<p class="has-text-align-center has-dark-blue-color has-text-color has-link-color has-18-font-size wp-elements-\d+ wp-block-paragraph"><strong>)<a href="mailto:tzionbreslovproject@gmail\.com">tzionbreslovproject@gmail\.com<\/a>(<\/strong><\/p>)/;
const SPEAKING_EMAIL = /(please email us at&nbsp;)<a rel="noreferrer noopener" href="mailto:tzionbreslovproject@gmail\.com" target="_blank"><strong>tzionbreslovproject@gmail\.com<\/strong><\/a>(<\/p>)/;
const ARTICLE_EMAIL = /(Please email us at )TzionBreslovProject@gmail\.com(\.&nbsp;<\/p>)/;

/** An imported footer (every variant) with its "contact" column's email and phone covered, in their own paragraphs. */
export function editFooterContact(html, { formsOn }) {
  const email = replaceOnce(html, FOOTER_EMAIL, (_, open, close) => `${open}${emailSlot({ formsOn, variant: "footer" })}${close}`, "footer email");
  return replaceOnce(email, FOOTER_PHONE, (_, open, close) => `${open}${phoneSlot({ formsOn, variant: "footer" })}${close}`, "footer phone");
}

/** The imported Contact page's main with its phone and email cards covered, inside the cards' own <strong>. */
export function editContactCards(main, { formsOn }) {
  const phone = replaceOnce(main, CARD_PHONE, (_, open, close) => `${open}${phoneSlot({ formsOn, variant: "card" })}${close}`, "contact phone card");
  return replaceOnce(phone, CARD_EMAIL, (_, open, close) => `${open}${emailSlot({ formsOn, variant: "card" })}${close}`, "contact email card");
}

/**
 * The "Live Speaking Engagements" paragraph (the Resources page's closing sections, lib/pages/parts.ts) with "please
 * email us at" followed by the covered address, bold as the linked address was.
 */
export function editSpeakingEmail(html, { formsOn }) {
  return replaceOnce(html, SPEAKING_EMAIL, (_, before, close) =>
    `${before}<strong>${emailSlot({ formsOn, variant: "inline" })}</strong>${close}`, "speaking email");
}

/** The article "Parshas Toldos" (/parshas-toldos-nov-5-6-2021/): "Please email us at Tzion••••••@gmail.com." */
export function editArticleEmail(main, { formsOn }) {
  return replaceOnce(main, ARTICLE_EMAIL, (_, before, after) =>
    `${before}${emailSlot({ formsOn, variant: "inline", lead: "Tzion" })}${after}`, "article email");
}

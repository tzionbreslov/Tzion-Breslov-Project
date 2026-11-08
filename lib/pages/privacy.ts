import copy from "@/content/copy/en.json";
import type { PageContent } from "@/lib/content-files";
import { composePage } from "@/lib/pages/compose";
import { LARGE_SPACER, esc, renderHero, wrapEntry } from "@/lib/pages/parts";

/**
 * The privacy notice: the Resources header with its own image and heading (the
 * page's h1), then the notice in Tzion's legal layout (app/pages.css, .tz-legal): the date
 * it was last changed, an introduction and its sections, each a heading over
 * its paragraphs (plain sections, not six region landmarks: the headings
 * structure the page). Every word is content/copy/en.json `privacy`; the date is
 * fixed there (it changes when the text does, never with a rebuild). The text
 * describes the site as built and the owner approves it before launch.
 *
 * Linked from the end of every page's footer Quick Links (lib/navigation.mjs)
 * and from the consent lines of the forms (lib/events.mjs, lib/client/rsvp.ts).
 */

const HERO_IMAGE = "/wp-content/uploads/2023/06/clouds-in-the-sky-1.png";

/** An email address in the text becomes a link to write to it. */
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const paragraph = (text: string) =>
  `<p>${esc(text).replace(EMAIL, (address) => `<a href="mailto:${address}">${address}</a>`)}</p>`;

function notice() {
  const text = copy.privacy;
  const sections = text.sections.map(({ heading, paragraphs }) =>
    `<section class="tz-legal__section"><h2 class="tz-legal__heading">${esc(heading)}</h2>${paragraphs.map(paragraph).join("")}</section>`).join("");
  // split/join, not replace(): the date is text, not a pattern.
  const updated = text.updated.split("{date}").join(text.date);
  return `<div class="tz-legal"><div class="tz-legal__body">` +
    `<p class="tz-legal__updated">${esc(updated)}</p><p class="tz-legal__intro">${esc(text.intro)}</p>${sections}` +
    `</div></div>`;
}

export function privacyPage(path: string): PageContent {
  const text = copy.privacy;
  return composePage({
    path,
    title: text.title,
    description: text.description,
    slug: "privacy",
    main: wrapEntry(text.title, renderHero({ image: HERO_IMAGE, heading: text.title, headingTag: "h1" }) + notice() + LARGE_SPACER),
    islands: ["signup"],
    image: HERO_IMAGE
  });
}

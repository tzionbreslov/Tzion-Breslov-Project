import copy from "@/content/copy/en.json";
import { EXTERNAL_LINK_ICON } from "@/lib/icons";
import { divAt, esc, findOnce, markerMissing } from "@/lib/pages/parts";

/**
 * The map on the imported Contact page (content/pages/contact.json): a card in
 * the Contact cards' style with a Google map pinned on Bet Shemesh, Israel
 * (owner), a "Get directions" link and an "Open in Google Maps" link (both open
 * in a new tab, with the external-link icon the Classes channel link has). It goes
 * right after the contact columns (the form and the three cards), inside their
 * section, so the rest of the page stays exactly as it was. Styles: app/pages.css.
 * The embed's origin is SOURCES.maps in config/security-headers.mjs.
 */

const COLUMNS = '<div class="wp-block-columns is-style-col-spread ';
/** What makes it the contact columns block: the contact form and the "Beit Shemesh, Israel" card. */
const COLUMNS_HOLD = ['<form method="post" id="gform_3"', "Beit Shemesh, Israel"];

const PLACE = encodeURIComponent("Bet Shemesh, Israel");
const MAP_EMBED = `https://www.google.com/maps?q=${PLACE}&z=13&output=embed`;
const MAP_DIRECTIONS = `https://www.google.com/maps/dir/?api=1&destination=${PLACE}`;
const MAP_OPEN = `https://www.google.com/maps/search/?api=1&query=${PLACE}`;

const button = (style: string, href: string, label: string) =>
  `<div class="wp-block-button ${style}"><a class="wp-block-button__link wp-element-button" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${esc(label)}${EXTERNAL_LINK_ICON}</a></div>`;

function mapSection(): string {
  const text = copy.map;
  return `<section class="tz-map" aria-labelledby="tz-map-title"><div class="tz-map__card">` +
    `<h2 id="tz-map-title" class="wp-block-heading has-text-align-center has-dark-blue-color has-text-color has-40-font-size tz-map__title">${esc(text.heading)}</h2>` +
    `<div class="tz-map__frame"><iframe class="tz-map__iframe" src="${esc(MAP_EMBED)}" title="${esc(text.iframeTitle)}" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe></div>` +
    `<div class="wp-block-buttons is-content-justification-center is-layout-flex wp-block-buttons-is-layout-flex tz-map__links">` +
    button("is-style-turquoise", MAP_DIRECTIONS, text.directions) +
    button("is-style-outline", MAP_OPEN, text.openInMaps) +
    `</div></div></section>`;
}

/** The Contact page's main HTML with the map inserted right after the contact columns block. */
export function insertContactMap(main: string): string {
  const start = findOnce(main, COLUMNS, "contact columns");
  const columns = divAt(main, start, "contact columns");
  if (!COLUMNS_HOLD.every((part) => columns.includes(part))) throw markerMissing("contact columns");
  const end = start + columns.length;
  return main.slice(0, end) + mapSection() + main.slice(end);
}

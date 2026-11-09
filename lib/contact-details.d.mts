/** The covered contact details (lib/contact-details.mjs). */
export const COVERED_PHONE: string;
export function coveredEmail(lead?: "tzion" | "Tzion"): string;
export type SlotVariant = "footer" | "card" | "inline";
export function phoneSlot(options: { formsOn: boolean; variant: "footer" | "card" }): string;
export function emailSlot(options: { formsOn: boolean; variant: SlotVariant; lead?: "tzion" | "Tzion" }): string;
export function editFooterContact(html: string, options: { formsOn: boolean }): string;
export function editContactCards(main: string, options: { formsOn: boolean }): string;
export function editSpeakingEmail(html: string, options: { formsOn: boolean }): string;
export function editArticleEmail(main: string, options: { formsOn: boolean }): string;

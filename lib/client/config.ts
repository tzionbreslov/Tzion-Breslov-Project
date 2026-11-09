import { CONTACT_EMAIL } from "@/config/contact.mjs";

/** Public, build-time configuration (set as GitHub Actions variables in CI). */
export function publicConfig() {
  return {
    apiBaseUrl: (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/+$/, ""),
    turnstileSiteKey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "",
    paypalClientId: process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID ?? "",
    contactEmail: CONTACT_EMAIL
  };
}

/**
 * Whether the forms are on: the forms API and the Turnstile key were given at build time (they stay unset on the
 * github.io preview until switch day). The pages render the covered contact details' "Show" buttons only then
 * (lib/contact-details.mjs); without them there is nothing a button could do (Ruling R13).
 */
export function formsEnabled(): boolean {
  const { apiBaseUrl, turnstileSiteKey } = publicConfig();
  return Boolean(apiBaseUrl && turnstileSiteKey);
}

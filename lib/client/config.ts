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

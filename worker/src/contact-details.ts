import type { ContactDetailsSuccessResponse } from "../../lib/api-contract";
import { PublicError, requireBinding, type Env } from "./types";

/** E.164 for a +1 number: the country code and 10 digits (area code, exchange, line). */
const PLUS_ONE = /^\+1(\d{3})(\d{3})(\d{4})$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * What `POST /v1/contact-details` answers, from the Worker's settings: the secret CONTACT_PHONE (the number is
 * never in the repository) and the variable PUBLIC_CONTACT_EMAIL. The display text is written as the site writes
 * numbers, "(+1) 555-555-0123", and the WhatsApp chat is wa.me with the same digits. A setting that is missing or
 * malformed is SERVICE_NOT_CONFIGURED (503): its message names the setting, never its value, and the error line the
 * Worker logs carries only the code (index.ts, logError).
 */
export function contactDetailsFrom(env: Env): ContactDetailsSuccessResponse {
  const tel = requireBinding(env, "CONTACT_PHONE");
  const parts = PLUS_ONE.exec(tel);
  if (!parts) throw new PublicError("SERVICE_NOT_CONFIGURED", "CONTACT_PHONE must be + then 1 and 10 digits");
  const email = requireBinding(env, "PUBLIC_CONTACT_EMAIL");
  if (!EMAIL.test(email)) throw new PublicError("SERVICE_NOT_CONFIGURED", "PUBLIC_CONTACT_EMAIL must be an email address");
  const [, area, exchange, line] = parts;
  return {
    ok: true,
    phone: { display: `(+1) ${area}-${exchange}-${line}`, tel },
    whatsapp: `https://wa.me/${tel.slice(1)}`,
    email
  };
}

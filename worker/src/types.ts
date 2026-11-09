import { API_ERROR_STATUS, type ApiErrorCode, type ApiInputField } from "../../lib/api-contract";

export interface Env {
  DB: D1Database;
  ALLOWED_ORIGINS: string;
  PUBLIC_API_URL: string;
  SUBSCRIPTION_CONFIRMATION_REDIRECT_URL: string;
  ORGANIZATION_NAME: string;
  TURNSTILE_SECRET_KEY: string;
  TURNSTILE_EXPECTED_HOSTNAMES: string;
  RATE_LIMIT_SALT: string;
  RESEND_TRANSACTIONAL_API_KEY: string;
  RESEND_CONTACTS_API_KEY: string;
  RESEND_FROM_EMAIL: string;
  /** Optional, non-secret Reply-To for the subscription confirmation email (blank = none). */
  RESEND_REPLY_TO_EMAIL?: string;
  CONTACT_TO_EMAIL: string;
  RESEND_NEWSLETTER_TOPIC_ID: string;
  /** The "Event announcements" Resend topic (scripts/setup-resend.mjs). */
  RESEND_EVENTS_TOPIC_ID: string;
  RESEND_WEBHOOK_SECRET: string;
  /** The site's published events (`https://tzionbreslov.org/events.json`): which events take RSVPs. */
  EVENTS_FEED_URL: string;
  /**
   * Secret: the phone number (with WhatsApp) the site shows covered, in E.164 (+1 and 10 digits). Never in the
   * repository: set with `wrangler secret put` on switch day (README). Answered by POST /v1/contact-details only.
   */
  CONTACT_PHONE: string;
  /** Not a secret: the email address the site shows covered (POST /v1/contact-details). */
  PUBLIC_CONTACT_EMAIL: string;
}

export class PublicError extends Error {
  public readonly status: number;
  /** EVENT_FULL only: the places the event had left when the RSVP was refused (fewer than its guests; 0 = full). */
  public remaining?: number;

  constructor(
    public readonly code: ApiErrorCode,
    message: string = code,
    public readonly field?: ApiInputField
  ) {
    super(message);
    this.name = "PublicError";
    this.status = API_ERROR_STATUS[code];
  }
}

/** EVENT_FULL, with the places left as the refused reservation saw them. */
export function eventFull(remaining: number) {
  const error = new PublicError("EVENT_FULL");
  error.remaining = Math.max(0, remaining);
  return error;
}

export function invalidInput(field: ApiInputField): never {
  throw new PublicError("INVALID_INPUT", `Invalid field: ${field}`, field);
}

export function requireBinding(env: Env, name: Exclude<keyof Env, "DB">) {
  const value = env[name];
  if (typeof value !== "string" || !value.trim()) {
    throw new PublicError("SERVICE_NOT_CONFIGURED", `Missing Worker binding: ${String(name)}`);
  }
  return value.trim();
}

/**
 * RATE_LIMIT_SALT, the key of every salted hash the Worker makes (rate-limit
 * keys, subscription tokens, RSVP confirmation ids). Fails closed when it is
 * missing or shorter than 32 characters.
 */
export function requireSalt(env: Env) {
  const salt = requireBinding(env, "RATE_LIMIT_SALT");
  if (salt.length < 32) throw new PublicError("SERVICE_NOT_CONFIGURED", "RATE_LIMIT_SALT must be at least 32 characters");
  return salt;
}

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
  /** Days after an event's start that its RSVPs are deleted by the daily cleanup ("90"). */
  RSVP_RETENTION_DAYS: string;
}

export class PublicError extends Error {
  public readonly status: number;

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

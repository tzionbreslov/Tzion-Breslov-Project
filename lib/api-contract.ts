/**
 * Tzion Breslov forms API contract (Cloudflare Worker `tzion-breslov-api`).
 *
 * Shared by the Worker (`worker/src`) and the Next.js frontend, so keep this
 * file free of runtime/DOM/Worker globals: types and `as const` values only.
 *
 * Base URL: `https://api.tzionbreslov.org` in production,
 * `http://localhost:8787` under `npm run worker:dev`.
 *
 * Every public POST must:
 * - be sent from an origin listed in ALLOWED_ORIGINS (exact match, no credentials);
 * - use `Content-Type: application/json` (the CORS preflight allows only that header);
 * - have a JSON object body of at most 16 KiB;
 * - include the security envelope fields described by {@link SecurityEnvelope}
 *   (except `POST /v1/subscribe/confirm`, whose single-use token is the credential;
 *   see {@link SubscribeConfirmRequest}).
 *
 * Unknown extra fields are ignored. Strings are NFKC-normalized and trimmed
 * server-side before length checks. Success responses are HTTP 202
 * (HTTP 200 for `POST /v1/subscribe/confirm`, which finishes synchronously).
 *
 * One public GET: `/v1/rsvp/availability` (no body, no preflight), see
 * {@link RsvpAvailabilityResponse}.
 *
 * Errors are `{ ok: false, error: ApiErrorCode, correlationId, field? }` with
 * the HTTP status shown in {@link API_ERROR_STATUS}. `field` is only present on
 * `INVALID_INPUT` and names the first offending request field.
 */

export const API_PATHS = {
  contact: "/v1/contact",
  subscribe: "/v1/subscribe",
  /**
   * Double opt-in, two methods on one path:
   * - `GET ?token=…` is the emailed link. It is navigation only (link scanners
   *   pre-fetch it): it never subscribes anyone, it 303s to the site with a
   *   {@link SUBSCRIPTION_QUERY} status (see there).
   * - `POST` with {@link SubscribeConfirmRequest} is sent by the site when the
   *   visitor presses "Confirm my subscription"; it performs the opt-in.
   */
  subscribeConfirm: "/v1/subscribe/confirm",
  /** `POST` {@link RsvpRequest}: an RSVP to one event of the site's /events.json. */
  rsvp: "/v1/rsvp",
  /** `GET`: which open events are full ({@link RsvpAvailabilityResponse}). Counts only. */
  rsvpAvailability: "/v1/rsvp/availability"
} as const;

/**
 * Turnstile widget `action` per form. The Worker rejects a token whose action
 * differs, so render the widget with `action: TURNSTILE_ACTIONS.contact` etc.
 */
export const TURNSTILE_ACTIONS = {
  contact: "contact",
  subscribe: "subscribe",
  rsvp: "rsvp"
} as const;

/**
 * The email lists a signup can opt in to: the newsletter and the "Event
 * announcements" (Resend topics RESEND_NEWSLETTER_TOPIC_ID / RESEND_EVENTS_TOPIC_ID).
 */
export const SUBSCRIBE_TOPICS = ["newsletter", "events"] as const;
export type SubscribeTopic = (typeof SUBSCRIBE_TOPICS)[number];

/** An event's id in the site's /events.json (24 lowercase hex characters). */
export const EVENT_ID_PATTERN = /^[0-9a-f]{24}$/;

/** Exact JSON property names of the security envelope. */
export const ENVELOPE_FIELDS = {
  /** Honeypot. Render a visually hidden input with this name; must be submitted empty. */
  honeypot: "website",
  /** Milliseconds since epoch (number) when the form was first rendered/reset. */
  startedAt: "startedAt",
  /** ISO 8601 timestamp string at submit time, e.g. `new Date().toISOString()`. */
  submittedAt: "submittedAt",
  /** Fresh `crypto.randomUUID()` per submission attempt; reuse it only to retry the same submission. */
  requestId: "requestId",
  /** Turnstile token; the widget's default response field name. */
  turnstileToken: "cf-turnstile-response"
} as const;

/**
 * Validation limits (lengths are counted after trimming). Use them for
 * `minLength`/`maxLength` attributes so client and server agree.
 */
export const FIELD_LIMITS = {
  firstName: { max: 100 },
  lastName: { max: 100 },
  email: { min: 3, max: 254 },
  /** Must match PHONE_PATTERN when provided. */
  phone: { max: 40 },
  address: { max: 300 },
  message: { min: 2, max: 5000 },
  turnstileToken: { min: 1, max: 2048 },
  /** RSVP: the guest's name. */
  name: { min: 2, max: 100 },
  /** RSVP: optional accessibility or dietary needs (line breaks allowed). */
  accessibility: { max: 1000 },
  /** RSVP: how many people come, the guest included (a whole number). */
  guests: { min: 1, max: 12 }
} as const;

/** Server-side phone pattern (applied only when phone is non-empty). */
export const PHONE_PATTERN = /^[+\d][\d\s().-]{4,39}$/;

/** `submittedAt - startedAt` must be at least this many ms (and at most 24 h). */
export const MIN_FILL_TIME_MS = 1_500;
export const MAX_FILL_TIME_MS = 86_400_000;

/**
 * `GET /v1/subscribe/confirm?token=…` (the emailed link) answers 303 to
 * SUBSCRIPTION_CONFIRMATION_REDIRECT_URL (`https://tzionbreslov.org/`) with
 * `?subscription=<status>` appended:
 * - `confirm` + `#token=<token>`: valid, unused link. The token travels in the
 *   fragment so it never reaches the site's server or a Referer. The site shows
 *   a "Confirm my subscription" button that POSTs it (never automatically).
 * - `confirmed`: the link was already used; the visitor is subscribed.
 * - `invalid`: unknown, malformed or expired (24 h) link; sign up again.
 * - `error`: temporary server problem; try the link again later.
 */
export const SUBSCRIPTION_QUERY_PARAM = "subscription";
export const SUBSCRIPTION_QUERY = {
  confirm: "confirm",
  confirmed: "confirmed",
  invalid: "invalid",
  error: "error"
} as const;
export type SubscriptionQueryStatus = (typeof SUBSCRIPTION_QUERY)[keyof typeof SUBSCRIPTION_QUERY];

/** Fragment parameter that carries the token on `?subscription=confirm` (`#token=…`). */
export const SUBSCRIPTION_TOKEN_FRAGMENT_PARAM = "token";

/** Confirmation tokens are 64 lowercase hex characters (256 bits). */
export const CONFIRMATION_TOKEN_PATTERN = /^[0-9a-f]{64}$/;

/** Fields required on every public POST. */
export type SecurityEnvelope = {
  /** Honeypot; must be "" (or omitted). Any non-blank value => 400 SUSPICIOUS_SUBMISSION. */
  website?: string;
  /** Epoch ms when the form was rendered. */
  startedAt: number;
  /** ISO 8601 string at submit time. Must be >= MIN_FILL_TIME_MS after startedAt. */
  submittedAt: string;
  /** UUID (crypto.randomUUID()). Idempotency key: resending the same id returns the stored success. */
  requestId: string;
  /** Turnstile token rendered with the matching TURNSTILE_ACTIONS value. */
  "cf-turnstile-response": string;
};

/**
 * `POST /v1/contact` (Turnstile action "contact").
 * Sends a notification to the configured inbox with Reply-To set to `email`.
 * Optional fields may be omitted, null, or "".
 */
export type ContactRequest = SecurityEnvelope & {
  firstName?: string;
  lastName?: string;
  /** Required, valid address. */
  email: string;
  /** Optional; when present must match PHONE_PATTERN. */
  phone?: string;
  /** Optional single line. */
  address?: string;
  /** Required, 2-5000 characters. Line breaks allowed. */
  message: string;
};

/**
 * `POST /v1/subscribe` (Turnstile action "subscribe").
 * Email signup with double opt-in: the Worker emails a single-use link valid
 * for 24 hours. Opening it lands on the site (`?subscription=confirm#token=…`),
 * and the contact is added to the chosen Resend topics only when the visitor
 * then presses "Confirm my subscription" (`POST /v1/subscribe/confirm`).
 */
export type SubscribeRequest = SecurityEnvelope & {
  email: string;
  /**
   * The lists to join (duplicates ignored). Missing (or null) means
   * `["newsletter"]`, so the footer form sends none; an empty list or an
   * unknown topic is `INVALID_INPUT` field `topics`.
   */
  topics?: SubscribeTopic[];
};

/**
 * `POST /v1/rsvp` (Turnstile action "rsvp"). Errors besides the usual ones:
 * `EVENT_NOT_FOUND` (not in /events.json, or "No RSVP"), `EVENT_CLOSED` (it has
 * started), `EVENT_FULL` (its "RSVP limit" can't take `guests` more),
 * `EVENTS_UNAVAILABLE` (the Worker can't read /events.json; retry later).
 * Resending the same `requestId` returns the first RSVP's confirmation.
 */
export type RsvpRequest = SecurityEnvelope & {
  /** {@link EVENT_ID_PATTERN}: `data-event-id` of the event's card. */
  eventId: string;
  /** 2-100 characters, one line. */
  name: string;
  email: string;
  /** A whole number (JSON number) from 1 to 12. */
  guests: number;
  /** Optional, up to 1000 characters; line breaks allowed. */
  accessibility?: string;
  /** The consent checkbox; anything else is `INVALID_INPUT` field `consent`. */
  consent: "granted";
};

/**
 * `POST /v1/subscribe/confirm`: the visitor's explicit confirmation click.
 * No security envelope or Turnstile: the single-use token is the credential.
 * Rate-limited per IP. Errors: `INVALID_INPUT` (field `token`, not
 * {@link CONFIRMATION_TOKEN_PATTERN}), `INVALID_CONFIRMATION` (unknown or
 * expired; sign up again), `UPSTREAM_FAILURE` (safe to retry with the same token).
 */
export type SubscribeConfirmRequest = {
  token: string;
};

export type ContactSuccessResponse = {
  ok: true;
  requestId: string;
};

export type SubscribeSuccessResponse = {
  ok: true;
  requestId: string;
  /** Always true: tell the visitor to check their inbox to confirm. */
  confirmationRequired: true;
};

/** HTTP 200. Also returned when the token was already used (the visitor is subscribed). */
export type SubscribeConfirmSuccessResponse = {
  ok: true;
};

/** HTTP 202. The guest and the organizer are emailed (once per requestId). */
export type RsvpSuccessResponse = {
  ok: true;
  requestId: string;
  /** Also in the guest's "RSVP received" email. UUID-shaped; the same for every retry of one requestId. */
  confirmationId: string;
};

/**
 * `GET /v1/rsvp/availability`, HTTP 200, `Cache-Control: public, max-age=60`.
 * One entry per event of /events.json that takes RSVPs; `remaining` is null
 * when the event has no limit. Counts only, never who has replied.
 */
export type RsvpAvailabilityResponse = {
  ok: true;
  events: Record<string, { full: boolean; remaining: number | null }>;
};

/** HTTP status for each error code the Worker can return. */
export const API_ERROR_STATUS = {
  /** A field failed validation; see `field`. */
  INVALID_INPUT: 400,
  /** Body is not a JSON object. */
  INVALID_JSON: 400,
  /** Honeypot filled or implausible timing. */
  SUSPICIOUS_SUBMISSION: 400,
  /** Turnstile token invalid, expired, reused, wrong action or hostname. Reset the widget. */
  BOT_CHALLENGE_FAILED: 400,
  /** Confirmation token unknown or expired (POST /v1/subscribe/confirm only); sign up again. */
  INVALID_CONFIRMATION: 400,
  /** Origin header missing or not allowed. */
  ORIGIN_NOT_ALLOWED: 403,
  /** Preflight asked for a method/header other than POST + Content-Type. */
  CORS_REQUEST_REJECTED: 403,
  NOT_FOUND: 404,
  /** RSVP: the event isn't in /events.json, or takes no RSVPs ("No RSVP"). */
  EVENT_NOT_FOUND: 404,
  /** RSVP: the event has started. */
  EVENT_CLOSED: 409,
  /** RSVP: the event's limit can't take this many more guests. */
  EVENT_FULL: 409,
  /** Same requestId is still being processed; retry shortly. */
  REQUEST_IN_PROGRESS: 409,
  /** requestId already used on a different endpoint, or with a different email or event; generate a new one. */
  REQUEST_ID_CONFLICT: 409,
  REQUEST_TOO_LARGE: 413,
  UNSUPPORTED_CONTENT_TYPE: 415,
  /** Too many submissions from this IP or for this email; try again in ~10 minutes. */
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
  /** Email provider or Turnstile unavailable; safe to retry with the same requestId. */
  UPSTREAM_FAILURE: 502,
  /** Worker misconfigured (missing binding/secret). */
  SERVICE_NOT_CONFIGURED: 503,
  /** RSVP: the Worker can't read the site's /events.json just now; retry later. */
  EVENTS_UNAVAILABLE: 503,
  /** Resend webhook endpoint only. */
  INVALID_WEBHOOK: 400,
  /** Resend webhook endpoint only. */
  INVALID_WEBHOOK_SIGNATURE: 400
} as const;

export type ApiErrorCode = keyof typeof API_ERROR_STATUS;

/** Request fields that can appear in `ApiErrorResponse.field`. */
export type ApiInputField =
  | Exclude<keyof ContactRequest, "website">
  | Exclude<keyof SubscribeRequest, "website">
  | Exclude<keyof RsvpRequest, "website">
  | keyof SubscribeConfirmRequest;

export type ApiErrorResponse = {
  ok: false;
  error: ApiErrorCode;
  /** Opaque id that also appears in Worker logs; show it to users for support. */
  correlationId: string;
  /** Only set when error === "INVALID_INPUT". */
  field?: ApiInputField;
};

export type ContactResponse = ContactSuccessResponse | ApiErrorResponse;
export type SubscribeResponse = SubscribeSuccessResponse | ApiErrorResponse;
export type SubscribeConfirmResponse = SubscribeConfirmSuccessResponse | ApiErrorResponse;
export type RsvpResponse = RsvpSuccessResponse | ApiErrorResponse;

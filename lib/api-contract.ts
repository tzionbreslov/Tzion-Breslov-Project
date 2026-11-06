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
 * - include the security envelope fields described by {@link SecurityEnvelope}.
 *
 * Unknown extra fields are ignored. Strings are NFKC-normalized and trimmed
 * server-side before length checks. Success responses are HTTP 202.
 *
 * Errors are `{ ok: false, error: ApiErrorCode, correlationId, field? }` with
 * the HTTP status shown in {@link API_ERROR_STATUS}. `field` is only present on
 * `INVALID_INPUT` and names the first offending request field.
 */

export const API_PATHS = {
  contact: "/v1/contact",
  subscribe: "/v1/subscribe",
  /** GET target of the emailed double-opt-in link. The frontend never calls it directly. */
  subscribeConfirm: "/v1/subscribe/confirm"
} as const;

/**
 * Turnstile widget `action` per form. The Worker rejects a token whose action
 * differs, so render the widget with `action: TURNSTILE_ACTIONS.contact` etc.
 */
export const TURNSTILE_ACTIONS = {
  contact: "contact",
  subscribe: "subscribe"
} as const;

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
  turnstileToken: { min: 1, max: 2048 }
} as const;

/** Server-side phone pattern (applied only when phone is non-empty). */
export const PHONE_PATTERN = /^[+\d][\d\s().-]{4,39}$/;

/** `submittedAt - startedAt` must be at least this many ms (and at most 24 h). */
export const MIN_FILL_TIME_MS = 1_500;
export const MAX_FILL_TIME_MS = 86_400_000;

/**
 * After a successful double-opt-in click, the Worker answers 303 to
 * SUBSCRIPTION_CONFIRMATION_REDIRECT_URL (`https://tzionbreslov.org/`) with
 * this query parameter appended, e.g. `https://tzionbreslov.org/?subscription=confirmed`.
 */
export const SUBSCRIPTION_CONFIRMED_QUERY = { subscription: "confirmed" } as const;

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
 * Email-only newsletter signup with double opt-in: the Worker emails a
 * single-use link valid for 24 hours; the contact is added to the Resend
 * "newsletter" topic only when that link is opened.
 */
export type SubscribeRequest = SecurityEnvelope & {
  email: string;
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
  /** Subscription link invalid or expired (GET /v1/subscribe/confirm only). */
  INVALID_CONFIRMATION: 400,
  /** Origin header missing or not allowed. */
  ORIGIN_NOT_ALLOWED: 403,
  /** Preflight asked for a method/header other than POST + Content-Type. */
  CORS_REQUEST_REJECTED: 403,
  NOT_FOUND: 404,
  /** Same requestId is still being processed; retry shortly. */
  REQUEST_IN_PROGRESS: 409,
  /** requestId already used on a different endpoint; generate a new one. */
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
  /** Resend webhook endpoint only. */
  INVALID_WEBHOOK: 400,
  /** Resend webhook endpoint only. */
  INVALID_WEBHOOK_SIGNATURE: 400
} as const;

export type ApiErrorCode = keyof typeof API_ERROR_STATUS;

/** Request fields that can appear in `ApiErrorResponse.field`. */
export type ApiInputField =
  | Exclude<keyof ContactRequest, "website">
  | Exclude<keyof SubscribeRequest, "website">;

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

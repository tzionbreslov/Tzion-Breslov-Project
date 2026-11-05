import {
  ENVELOPE_FIELDS,
  FIELD_LIMITS,
  MAX_FILL_TIME_MS,
  MIN_FILL_TIME_MS,
  PHONE_PATTERN,
  type ApiInputField
} from "../../lib/api-contract";
import { PublicError, invalidInput } from "./types";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function hasUnsafeControlCharacters(value: string) {
  return [...value].some((character) => {
    const code = character.codePointAt(0) ?? 0;
    return code === 127 || (code >= 128 && code <= 159) || (code < 32 && code !== 9 && code !== 10 && code !== 13);
  });
}

type JsonRecord = Record<string, unknown>;

export type ContactInput = ReturnType<typeof validateContact>;
export type SubscribeInput = ReturnType<typeof validateSubscription>;

export async function readJson(request: Request, maximumBytes = 16_384): Promise<JsonRecord> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase() ?? "";
  if (contentType !== "application/json") throw new PublicError("UNSUPPORTED_CONTENT_TYPE");

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) throw new PublicError("REQUEST_TOO_LARGE");

  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > maximumBytes) throw new PublicError("REQUEST_TOO_LARGE");

  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    return parsed as JsonRecord;
  } catch {
    throw new PublicError("INVALID_JSON");
  }
}

function text(input: JsonRecord, key: ApiInputField, minimum: number, maximum: number, optional = false) {
  const raw = input[key];
  if ((raw === undefined || raw === null || raw === "") && optional) return "";
  if (typeof raw !== "string") invalidInput(key);
  const value = raw.normalize("NFKC").trim();
  if (value.length === 0 && optional) return "";
  if (value.length < minimum || value.length > maximum || hasUnsafeControlCharacters(value)) invalidInput(key);
  return value;
}

/** Text that may appear in an email subject or header-adjacent line: no line breaks or bidi controls. */
function singleLineText(input: JsonRecord, key: ApiInputField, minimum: number, maximum: number, optional = false) {
  const value = text(input, key, minimum, maximum, optional);
  if (/[\t\r\n\u2028\u2029\u202a-\u202e\u2066-\u2069]/u.test(value)) invalidInput(key);
  return value;
}

function email(input: JsonRecord) {
  const value = singleLineText(input, "email", FIELD_LIMITS.email.min, FIELD_LIMITS.email.max).toLowerCase();
  if (!emailPattern.test(value)) invalidInput("email");
  return value;
}

function requestId(input: JsonRecord) {
  const value = singleLineText(input, "requestId", 36, 36);
  if (!uuidPattern.test(value)) invalidInput("requestId");
  return value.toLowerCase();
}

function timing(input: JsonRecord) {
  const startedAt = input[ENVELOPE_FIELDS.startedAt];
  const submittedAt = singleLineText(input, "submittedAt", 20, 40);
  if (typeof startedAt !== "number" || !Number.isFinite(startedAt)) invalidInput("startedAt");
  const submittedMs = Date.parse(submittedAt);
  const now = Date.now();
  if (!Number.isFinite(submittedMs) || submittedMs > now + 60_000) invalidInput("submittedAt");
  if (startedAt > now + 60_000) invalidInput("startedAt");
  if (submittedMs - startedAt < MIN_FILL_TIME_MS || submittedMs - startedAt > MAX_FILL_TIME_MS) {
    throw new PublicError("SUSPICIOUS_SUBMISSION");
  }
  return { startedAt, submittedAt };
}

/** Security envelope shared by every public form: honeypot, timing, request id, Turnstile token. */
function envelope(input: JsonRecord) {
  const honeypot = input[ENVELOPE_FIELDS.honeypot];
  if (honeypot !== undefined && honeypot !== null && (typeof honeypot !== "string" || honeypot.trim() !== "")) {
    throw new PublicError("SUSPICIOUS_SUBMISSION");
  }
  return {
    requestId: requestId(input),
    turnstileToken: singleLineText(
      input,
      ENVELOPE_FIELDS.turnstileToken,
      FIELD_LIMITS.turnstileToken.min,
      FIELD_LIMITS.turnstileToken.max
    ),
    ...timing(input)
  };
}

export function validateContact(input: JsonRecord) {
  const result = envelope(input);
  // Validated in form order so `field` on INVALID_INPUT points at the first visible problem.
  const firstName = singleLineText(input, "firstName", 0, FIELD_LIMITS.firstName.max, true);
  const lastName = singleLineText(input, "lastName", 0, FIELD_LIMITS.lastName.max, true);
  const emailAddress = email(input);
  const phone = singleLineText(input, "phone", 0, FIELD_LIMITS.phone.max, true);
  if (phone && !PHONE_PATTERN.test(phone)) invalidInput("phone");
  const address = singleLineText(input, "address", 0, FIELD_LIMITS.address.max, true);
  const message = text(input, "message", FIELD_LIMITS.message.min, FIELD_LIMITS.message.max);
  return { ...result, firstName, lastName, email: emailAddress, phone, address, message };
}

export function validateSubscription(input: JsonRecord) {
  const result = envelope(input);
  return { ...result, email: email(input) };
}

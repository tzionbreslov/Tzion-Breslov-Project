import { ENVELOPE_FIELDS } from "@/lib/api-contract";
import { publicConfig } from "./config";

/**
 * Sending a public form to the Tzion forms API (worker/, lib/api-contract.ts):
 * the contact and footer signup forms (forms.ts), RSVPs (rsvp.ts) and the
 * "Get event announcements" signup (announcements.ts).
 */

/**
 * The security envelope's timing, request id and Turnstile token. A retry of
 * the same submission passes its first `requestId` (the API answers it once).
 * The honeypot is the form's own field, sent as it is.
 */
export function envelopeFields(startedAt: number, token: string, requestId: string = crypto.randomUUID()) {
  return {
    [ENVELOPE_FIELDS.startedAt]: startedAt,
    [ENVELOPE_FIELDS.submittedAt]: new Date().toISOString(),
    [ENVELOPE_FIELDS.requestId]: requestId,
    [ENVELOPE_FIELDS.turnstileToken]: token
  };
}

/**
 * POSTs `payload` as JSON to `path` on NEXT_PUBLIC_API_BASE_URL: CORS, no
 * cookies, never cached. Resolves with the response whatever its status;
 * rejects on a network failure (or when no API is configured).
 */
export function submitPublicForm(path: string, payload: Record<string, unknown>): Promise<Response> {
  const { apiBaseUrl } = publicConfig();
  if (!apiBaseUrl) return Promise.reject(new Error("FORM_ENDPOINT_UNAVAILABLE"));
  return fetch(apiBaseUrl + path, {
    method: "POST",
    mode: "cors",
    credentials: "omit",
    cache: "no-store",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

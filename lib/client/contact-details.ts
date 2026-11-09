import copy from "@/content/copy/en.json";
import {
  API_PATHS,
  ENVELOPE_FIELDS,
  TURNSTILE_ACTIONS,
  type ApiErrorResponse,
  type ContactDetailsSuccessResponse
} from "@/lib/api-contract";
import { formsEnabled, publicConfig } from "./config";
import { submitPublicForm } from "./submit";
import { mountTurnstile, TURNSTILE_TIMEOUT, type TurnstileHandle } from "./turnstile";

/**
 * The covered contact details' "Show" buttons (owner, 2026-11-08/09; the slots: lib/contact-details.mjs). One tap
 * runs one Turnstile check (action "contact-details", compact, in the tapped button's own place); the forms Worker
 * answers with the details (POST /v1/contact-details), and every slot on the page is filled at once: the phone as a
 * tel: link followed by the WhatsApp chat, the email as a mailto: link. The details are kept in sessionStorage for
 * the rest of the visit (the tab), so later pages show them at once with no check.
 *
 * - The buttons stay hidden until this is ready, and are rendered only when the forms are on (Ruling R13).
 * - One check at a time: while it runs every button is disabled, and further taps do nothing.
 * - A check that fails (no token within a minute, Turnstile unreachable, a network error, any error answer or a
 *   malformed one) says so in that slot's alert, resets Turnstile for a fresh token and gives the buttons back;
 *   RATE_LIMITED says to wait. A Turnstile that never loaded is dropped instead, so the next tap loads it again.
 * - Storage is a convenience: every read and write may throw (private mode, blocked site data) and is ignored.
 * - The answer is checked before use, and only ever inserted as text and as attributes of links it validated.
 */

const STORAGE_KEY = "tz:contact-details";
const text = copy.contactDetails;

/**
 * How long one tap waits for Turnstile's token: a minute, not the forms' 15 s. The widget first appears at the tap,
 * and when Cloudflare asks the visitor to tick "Verify you are human", an older visitor needs time to see the box.
 */
const CHECK_TIMEOUT_MS = 60_000;

const TEL = /^\+\d{8,15}$/;
const WHATSAPP = /^https:\/\/wa\.me\/\d{8,15}$/;
const EMAIL = /^[^\s@<>"'()]+@[^\s@<>"'()]+\.[^\s@<>"'()]+$/;

/** The details, rebuilt from `value` with nothing else in them, when every field is what it should be; else null. */
function validDetails(value: unknown): ContactDetailsSuccessResponse | null {
  if (!value || typeof value !== "object") return null;
  const { ok, phone, whatsapp, email } = value as Record<string, unknown>;
  if (ok !== true || !phone || typeof phone !== "object") return null;
  const { display, tel } = phone as Record<string, unknown>;
  if (typeof display !== "string" || !display.trim() || display.length >= 40) return null;
  if (typeof tel !== "string" || !TEL.test(tel)) return null;
  if (typeof whatsapp !== "string" || !WHATSAPP.test(whatsapp)) return null;
  if (typeof email !== "string" || email.length > 254 || !EMAIL.test(email)) return null;
  return { ok: true, phone: { display, tel }, whatsapp, email };
}

/** The details kept from an earlier "Show" in this tab, if any and well-formed. Never throws. */
export function readCachedDetails(): ContactDetailsSuccessResponse | null {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    return raw ? validDetails(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

function keepDetails(details: ContactDetailsSuccessResponse) {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(details));
  } catch {
    // Not kept: the next page asks again.
  }
}

const SVG_NS = "http://www.w3.org/2000/svg";
// WhatsApp's mark, as WordPress's social-links block draws it (the theme's own footer icons come from that block).
const WHATSAPP_ICON = "M12.011719 2C6.5057187 2 2.0234844 6.478375 2.0214844 11.984375C2.0204844 13.744375 2.4814687 15.462563 3.3554688 16.976562L2 22L7.2324219 20.763672C8.6914219 21.559672 10.333859 21.977516 12.005859 21.978516L12.009766 21.978516C17.514766 21.978516 21.995047 17.499141 21.998047 11.994141C22.000047 9.3251406 20.962172 6.8157344 19.076172 4.9277344C17.190172 3.0407344 14.683719 2.001 12.011719 2zM12.009766 4C14.145766 4.001 16.153109 4.8337969 17.662109 6.3417969C19.171109 7.8517969 20.000047 9.8581875 19.998047 11.992188C19.996047 16.396187 16.413812 19.978516 12.007812 19.978516C10.674812 19.977516 9.3544062 19.642812 8.1914062 19.007812L7.5175781 18.640625L6.7734375 18.816406L4.8046875 19.28125L5.2851562 17.496094L5.5019531 16.695312L5.0878906 15.976562C4.3898906 14.768562 4.0204844 13.387375 4.0214844 11.984375C4.0234844 7.582375 7.6067656 4 12.009766 4zM8.4765625 7.375C8.3095625 7.375 8.0395469 7.4375 7.8105469 7.6875C7.5815469 7.9365 6.9355469 8.5395781 6.9355469 9.7675781C6.9355469 10.995578 7.8300781 12.182609 7.9550781 12.349609C8.0790781 12.515609 9.68175 15.115234 12.21875 16.115234C14.32675 16.946234 14.754891 16.782234 15.212891 16.740234C15.670891 16.699234 16.690438 16.137687 16.898438 15.554688C17.106437 14.971687 17.106922 14.470187 17.044922 14.367188C16.982922 14.263188 16.816406 14.201172 16.566406 14.076172C16.317406 13.951172 15.090328 13.348625 14.861328 13.265625C14.632328 13.182625 14.464828 13.140625 14.298828 13.390625C14.132828 13.640625 13.655766 14.201187 13.509766 14.367188C13.363766 14.534188 13.21875 14.556641 12.96875 14.431641C12.71875 14.305641 11.914938 14.041406 10.960938 13.191406C10.218937 12.530406 9.7182656 11.714844 9.5722656 11.464844C9.4272656 11.215844 9.5585938 11.079078 9.6835938 10.955078C9.7955938 10.843078 9.9316406 10.663578 10.056641 10.517578C10.180641 10.371578 10.223641 10.267562 10.306641 10.101562C10.389641 9.9355625 10.347156 9.7890625 10.285156 9.6640625C10.223156 9.5390625 9.737625 8.3065 9.515625 7.8125C9.328625 7.3975 9.131125 7.3878594 8.953125 7.3808594C8.808125 7.3748594 8.6425625 7.375 8.4765625 7.375z";

function link(doc: Document, href: string, label: string) {
  const a = doc.createElement("a");
  a.setAttribute("href", href);
  a.textContent = label;
  return a;
}

function whatsappLink(doc: Document, href: string) {
  const a = doc.createElement("a");
  a.className = "tz-contact__whatsapp";
  a.setAttribute("href", href);
  a.setAttribute("target", "_blank");
  a.setAttribute("rel", "noopener noreferrer");
  a.setAttribute("aria-label", text.whatsapp);
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const path = doc.createElementNS(SVG_NS, "path");
  path.setAttribute("d", WHATSAPP_ICON);
  svg.append(path);
  a.append(svg);
  return a;
}

/**
 * Every slot on the page with its detail: its value (a polite live region, so the change is announced) becomes the
 * link(s); its button, Turnstile place and alert go. When `focusFrom` (the tapped button) had the focus, it moves to
 * the first link in its slot, so a keyboard user isn't left on nothing.
 */
function fill(doc: Document, details: ContactDetailsSuccessResponse, focusFrom?: HTMLElement) {
  const focusSlot = focusFrom && doc.activeElement === focusFrom ? focusFrom.closest<HTMLElement>("[data-tz-contact]") : null;
  for (const slot of doc.querySelectorAll<HTMLElement>("[data-tz-contact]")) {
    const value = slot.querySelector<HTMLElement>(".tz-contact__value");
    if (!value) continue;
    if (slot.dataset.tzContact === "phone") {
      value.replaceChildren(link(doc, `tel:${details.phone.tel}`, details.phone.display), whatsappLink(doc, details.whatsapp));
    } else if (slot.dataset.tzContact === "email") {
      value.replaceChildren(link(doc, `mailto:${details.email}`, details.email));
    } else continue;
    slot.querySelectorAll("[data-tz-reveal], [data-tz-reveal-slot], .tz-contact__message").forEach((node) => node.remove());
    slot.dataset.tzRevealed = "true";
  }
  focusSlot?.querySelector<HTMLElement>(".tz-contact__value a")?.focus();
}

export function enhanceContactDetails(doc: Document = document): () => void {
  const cached = readCachedDetails();
  if (cached) {
    fill(doc, cached);
    return () => undefined;
  }
  const buttons = [...doc.querySelectorAll<HTMLButtonElement>("[data-tz-reveal]")];
  const { turnstileSiteKey } = publicConfig();
  if (!buttons.length || !formsEnabled()) return () => undefined;

  let busy = false;
  let widget: { handle: TurnstileHandle; place: HTMLElement } | undefined;

  const setBusy = (tapped: HTMLButtonElement | null) => {
    for (const button of buttons) {
      const kind = button.closest<HTMLElement>("[data-tz-contact]")?.dataset.tzContact;
      const label = kind === "phone" ? text.showNumber : text.showEmail;
      const name = kind === "phone" ? text.showNumberLabel : text.showEmailLabel;
      if (tapped) {
        button.setAttribute("aria-disabled", "true");
        if (button === tapped) {
          // The name is what it shows while it checks, then its own again.
          button.textContent = text.checking;
          button.removeAttribute("aria-label");
        }
      } else {
        button.removeAttribute("aria-disabled");
        button.textContent = label;
        button.setAttribute("aria-label", name);
      }
    }
  };

  const reveal = async (button: HTMLButtonElement) => {
    if (busy) return;
    const slot = button.closest<HTMLElement>("[data-tz-contact]");
    const place = slot?.querySelector<HTMLElement>("[data-tz-reveal-slot]");
    const alert = slot?.querySelector<HTMLElement>(".tz-contact__message");
    if (!slot || !place || !alert) return;
    busy = true;
    doc.querySelectorAll<HTMLElement>(".tz-contact__message").forEach((node) => { node.textContent = ""; });
    setBusy(button);
    let message: string = text.failed;
    try {
      // One widget at a time, in the tapped button's place: kept (and reset) for another try there.
      if (widget?.place !== place) {
        widget?.handle.remove();
        widget = { handle: mountTurnstile(place, turnstileSiteKey, TURNSTILE_ACTIONS.contactDetails, { size: "compact" }), place };
      }
      let token: string;
      try {
        token = await widget.handle.token(CHECK_TIMEOUT_MS);
      } catch (error) {
        // Anything but a timeout means Turnstile never loaded, or never drew the widget: this one can't recover, so
        // it goes, and the next tap mounts a new one (which loads Turnstile again). After a timeout it stays (reset
        // below): its box may be on screen.
        if (!(error instanceof Error && error.message === TURNSTILE_TIMEOUT)) {
          widget.handle.remove();
          widget = undefined;
        }
        throw error;
      }
      const response = await submitPublicForm(API_PATHS.contactDetails, {
        [ENVELOPE_FIELDS.requestId]: crypto.randomUUID(),
        [ENVELOPE_FIELDS.turnstileToken]: token
      });
      const body: unknown = await response.json().catch(() => null);
      const details = response.ok ? validDetails(body) : null;
      if (details) {
        widget.handle.remove();
        widget = undefined;
        fill(doc, details, button);
        keepDetails(details);
        return;
      }
      if ((body as ApiErrorResponse | null)?.error === "RATE_LIMITED") message = text.rateLimited;
    } catch {
      // No token, Turnstile unreachable, or no answer: the failed message.
    } finally {
      busy = false;
    }
    alert.textContent = message;
    widget?.handle.reset();
    setBusy(null);
  };

  const onClick = (event: MouseEvent) => {
    event.preventDefault();
    void reveal(event.currentTarget as HTMLButtonElement);
  };
  for (const button of buttons) {
    button.addEventListener("click", onClick);
    button.hidden = false;
  }
  return () => {
    for (const button of buttons) button.removeEventListener("click", onClick);
    widget?.handle.remove();
  };
}

import copy from "@/content/copy/en.json";
import { PRIVACY_PATH } from "@/config/site-structure.mjs";
import {
  API_PATHS,
  ENVELOPE_FIELDS,
  FIELD_LIMITS,
  TURNSTILE_ACTIONS,
  type ApiErrorResponse,
  type ApiInputField,
  type RsvpAvailabilityResponse,
  type RsvpRequest
} from "@/lib/api-contract";
import { withBase } from "@/lib/base-path";
import { publicConfig } from "./config";
import { openDialog } from "./dialog";
import { EMAIL, MESSAGES, addHoneypot } from "./forms";
import { envelopeFields, submitPublicForm } from "./submit";
import { mountTurnstile, type TurnstileHandle } from "./turnstile";

/**
 * RSVPs on the Events page (lib/events.mjs renders the cards and their RSVP
 * buttons). On load: an event that has started loses its button, and with a
 * forms API configured, GET /v1/rsvp/availability swaps a full event's button
 * for "This event is full". A click opens the RSVP form in the site's dialog
 * (lib/client/dialog.ts): name, email, number of guests, accessibility or
 * dietary needs, consent. It posts to /v1/rsvp; without a forms API (the
 * preview) it says RSVPs open when the new site launches.
 *
 * Every word comes from content/copy/en.json (`rsvp`), or is a message the
 * site's other forms already use (lib/client/forms.ts).
 */

const text = copy.rsvp;

let dialogs = 0;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = "") {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

/**
 * The RSVP form's consent checkbox and its label, built here only.
 * "{privacy}" is a link to the privacy notice (with the preview's base path,
 * lib/base-path.ts#withBase); the sentence reads as before.
 */
function consentLabel() {
  const label = el("label", "tz-check tz-consent");
  const input = el("input");
  input.type = "checkbox";
  input.name = "consent";
  input.value = "granted";
  input.required = true;
  const sentence = el("span");
  const [before, after = ""] = text.consent.split("{privacy}");
  const privacy = el("a");
  privacy.href = withBase(PRIVACY_PATH);
  privacy.textContent = text.privacyNotice;
  sentence.append(before, privacy, after);
  label.append(input, sentence);
  return { label, input };
}

function field(id: string, labelText: string, control: HTMLInputElement | HTMLTextAreaElement) {
  const wrap = el("div", "tz-field");
  const label = el("label", "tz-field__label");
  label.htmlFor = id;
  label.textContent = labelText;
  control.id = id;
  control.classList.add("tz-field__input");
  wrap.append(label, control);
  return wrap;
}

function input(type: string, name: string, attrs: Partial<HTMLInputElement> = {}) {
  const node = el("input");
  node.type = type;
  node.name = name;
  Object.assign(node, attrs);
  return node;
}

const CLOSE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6 6 18"/></svg>';

/** GET /v1/rsvp/availability: which open events are full, and how many places remain. Null if it can't be read. */
function readAvailability(apiBaseUrl: string, init: RequestInit = {}): Promise<RsvpAvailabilityResponse | null> {
  return fetch(apiBaseUrl + API_PATHS.rsvpAvailability, { mode: "cors", credentials: "omit", headers: { Accept: "application/json" }, ...init })
    .then((response) => (response.ok ? (response.json() as Promise<RsvpAvailabilityResponse>) : null))
    .catch(() => null);
}

/**
 * The answer to EVENT_FULL: "now full", unless places remain but fewer than
 * `guests`, then how many. `remaining` is the Worker's own count from the
 * refused reservation (the page's availability can be a minute old); without
 * one, it says the event is full.
 */
function eventFullMessage(remaining: unknown, guests: number) {
  if (typeof remaining !== "number" || remaining <= 0 || remaining >= guests) return text.eventFull;
  return remaining === 1 ? text.placeLeft : text.placesLeft.split("{remaining}").join(String(remaining));
}

type Control = HTMLInputElement | HTMLTextAreaElement;

function openRsvp(card: HTMLElement, opener: HTMLButtonElement) {
  const { apiBaseUrl, turnstileSiteKey } = publicConfig();
  const n = ++dialogs;
  const id = (part: string) => `tz-rsvp-${n}-${part}`;
  const eventId = card.dataset.eventId ?? "";
  const title = card.querySelector(".tz-event__title")?.textContent?.trim() ?? "";
  // split/join, not replace(): "$&", "$'" or "$$" in a calendar title are text, not patterns.
  const label = text.dialogTitle.split("{title}").join(title);

  const body = el("div", "tz-rsvp");
  const heading = el("h2", "tz-rsvp__title");
  heading.id = id("title");
  heading.textContent = label;
  const when = el("p", "tz-rsvp__when");
  // The card's line as it reads, keeping its no-break spaces ("7:30 PM", "(Israel time)" never split).
  when.textContent = (card.querySelector(".tz-event__when")?.textContent ?? "").replace(/[ \t\r\n]+/g, " ").trim();

  const form = el("form", "tz-rsvp__form");
  form.noValidate = true;
  const name = input("text", "name", { autocomplete: "name", maxLength: FIELD_LIMITS.name.max, required: true });
  const email = input("email", "email", { autocomplete: "email", maxLength: FIELD_LIMITS.email.max, required: true });
  const guests = input("number", "guests", { min: String(FIELD_LIMITS.guests.min), max: String(FIELD_LIMITS.guests.max), step: "1", value: "1", inputMode: "numeric", required: true });
  const accessibility = el("textarea");
  accessibility.name = "accessibility";
  accessibility.rows = 3;
  accessibility.maxLength = FIELD_LIMITS.accessibility.max;
  const consent = consentLabel();
  const holder = el("div", "tz-turnstile");
  const submit = el("button", "tz-button");
  submit.type = "submit";
  submit.textContent = text.submit;
  form.append(
    field(id("name"), text.name, name),
    field(id("email"), text.email, email),
    field(id("guests"), text.guests, guests),
    field(id("accessibility"), text.accessibility, accessibility),
    consent.label,
    holder,
    submit
  );
  // Last in the form, so the dialog's focus trap never lands on it.
  const honeypot = addHoneypot(form);

  // Last in the dialog (shown in its top corner): Tab goes through the form first.
  const close = el("button", "tz-dialog__close");
  close.type = "button";
  close.setAttribute("aria-label", text.close);
  close.innerHTML = CLOSE_ICON;
  body.append(heading, when, form, close);

  const turnstile: TurnstileHandle | undefined = apiBaseUrl && turnstileSiteKey
    ? mountTurnstile(holder, turnstileSiteKey, TURNSTILE_ACTIONS.rsvp)
    : undefined;
  let turnstileRemoved = false;
  const removeTurnstile = () => {
    if (!turnstileRemoved) turnstile?.remove();
    turnstileRemoved = true;
  };
  const dialog = openDialog({ label, content: body, opener, className: "tz-rsvp-dialog", onClose: removeTurnstile });
  close.addEventListener("click", () => dialog.close());
  name.focus();

  const startedAt = Date.now();
  // One submission, one requestId: kept for a retry after a network or server
  // failure (the Worker answers it once), new after any other answer.
  let requestId = crypto.randomUUID();
  let sending = false;
  let message: HTMLElement | null = null;

  const errorId = (control: Control | HTMLInputElement) => `${control.id || id("consent")}-error`;
  const clearErrors = () => {
    form.querySelectorAll(".tz-field__error").forEach((node) => node.remove());
    form.querySelectorAll("[aria-invalid=true]").forEach((node) => {
      node.removeAttribute("aria-invalid");
      node.removeAttribute("aria-describedby");
    });
    message?.remove();
    message = null;
  };
  const fieldError = (control: Control, messageText: string) => {
    const note = el("p", "tz-field__error");
    note.id = errorId(control);
    note.textContent = messageText;
    control.setAttribute("aria-invalid", "true");
    control.setAttribute("aria-describedby", note.id);
    (control === consent.input ? consent.label : control).after(note);
  };
  /** An answer the visitor must hear (an alert), shown above the button. */
  const announce = (messageText: string) => {
    message = el("p", "tz-form-message tz-form-message--error");
    message.setAttribute("role", "alert");
    message.tabIndex = -1;
    message.textContent = messageText;
    submit.before(message);
    message.focus();
  };

  const validate = () => {
    const errors: Array<[Control, string]> = [];
    const nameValue = name.value.trim();
    if (!nameValue) errors.push([name, MESSAGES.required]);
    else if (nameValue.length < FIELD_LIMITS.name.min) errors.push([name, text.nameShort]);
    const emailValue = email.value.trim();
    if (!emailValue) errors.push([email, MESSAGES.required]);
    else if (!EMAIL.test(emailValue)) errors.push([email, MESSAGES.email]);
    const count = Number(guests.value);
    if (!guests.value.trim() || !Number.isInteger(count) || count < FIELD_LIMITS.guests.min || count > FIELD_LIMITS.guests.max) {
      errors.push([guests, text.guestsRange]);
    }
    if (!consent.input.checked) errors.push([consent.input, text.consentRequired]);
    return errors;
  };

  const controlFor: Partial<Record<ApiInputField, [Control, string]>> = {
    name: [name, text.nameShort],
    email: [email, MESSAGES.email],
    guests: [guests, text.guestsRange],
    consent: [consent.input, text.consentRequired]
  };

  const onSubmit = async (event: SubmitEvent) => {
    event.preventDefault();
    if (sending) return;
    clearErrors();
    const errors = validate();
    if (errors.length) {
      errors.forEach(([control, messageText]) => fieldError(control, messageText));
      errors[0][0].focus();
      return;
    }
    if (!apiBaseUrl || !turnstile) {
      announce(text.unavailable);
      return;
    }
    sending = true;
    submit.disabled = true;
    form.setAttribute("aria-busy", "true");
    try {
      const payload: RsvpRequest = {
        eventId,
        name: name.value.trim(),
        email: email.value.trim(),
        guests: Number(guests.value),
        accessibility: accessibility.value.trim(),
        consent: "granted",
        [ENVELOPE_FIELDS.honeypot]: honeypot.value,
        ...envelopeFields(startedAt, await turnstile.token(), requestId)
      };
      const response = await submitPublicForm(API_PATHS.rsvp, payload);
      if (response.ok) {
        removeTurnstile();
        const done = el("p", "tz-form-message tz-form-message--success");
        done.setAttribute("role", "status");
        done.tabIndex = -1;
        done.textContent = text.success;
        form.replaceWith(done);
        done.focus();
        return;
      }
      const answer = (await response.json().catch(() => null)) as ApiErrorResponse | null;
      // REQUEST_IN_PROGRESS: an earlier attempt with this requestId is still on its way (its RSVP may yet be
      // booked), so a retry stays the same submission, like one after a 5xx.
      if (response.status < 500 && answer?.error !== "REQUEST_IN_PROGRESS") {
        requestId = crypto.randomUUID();
        turnstile.reset();
      }
      const target = answer?.error === "INVALID_INPUT" && answer.field ? controlFor[answer.field] : undefined;
      if (target) {
        fieldError(...target);
        target[0].focus();
      } else if (answer?.error === "EVENT_FULL") announce(eventFullMessage(answer.remaining, payload.guests));
      else if (answer?.error === "EVENT_CLOSED" || answer?.error === "EVENT_NOT_FOUND") announce(text.closed);
      else if (answer?.error === "RATE_LIMITED") announce(MESSAGES.rateLimited);
      else announce(text.error);
    } catch {
      // Network failure: the same submission may be retried as it is.
      announce(text.error);
    } finally {
      sending = false;
      submit.disabled = false;
      form.removeAttribute("aria-busy");
    }
  };
  form.addEventListener("submit", onSubmit);
}

function markFull(card: HTMLElement) {
  const actions = card.querySelector(".tz-event__actions");
  if (!actions?.querySelector("button.tz-event__rsvp")) return;
  const full = el("p", "tz-event__full");
  full.textContent = text.full;
  actions.replaceChildren(full);
}

export function enhanceRsvp(root: ParentNode = document) {
  const list = root.querySelector<HTMLElement>(".tz-events__list");
  if (!list || list.dataset.tzRsvp) return () => undefined;
  const now = Date.now();
  const cards = [...list.querySelectorAll<HTMLElement>("article.tz-event[data-rsvp=open]")];
  const cleanups: Array<() => void> = [];

  for (const card of cards) {
    const button = card.querySelector<HTMLButtonElement>("button.tz-event__rsvp");
    if (!button) continue;
    // RSVPs close when the event starts (the page can be up to half a day old). One that had started when
    // the page was built (data-started) never showed its slot (app/events.css); this hides the later ones.
    if (!(Date.parse(card.dataset.startsAt ?? "") > now)) {
      const actions = button.closest<HTMLElement>(".tz-event__actions") ?? button;
      actions.hidden = true;
      continue;
    }
    const onClick = () => openRsvp(card, button);
    button.addEventListener("click", onClick);
    cleanups.push(() => button.removeEventListener("click", onClick));
  }

  const { apiBaseUrl } = publicConfig();
  const controller = new AbortController();
  if (apiBaseUrl && cards.length) {
    // Counts only; an error leaves the buttons as they are (the Worker still enforces every limit).
    readAvailability(apiBaseUrl, { signal: controller.signal })
      .then((availability) => {
        for (const card of cards) {
          if (availability?.events?.[card.dataset.eventId ?? ""]?.full === true) markFull(card);
        }
      })
      .catch(() => undefined);
  }

  list.dataset.tzRsvp = "ready";
  return () => {
    controller.abort();
    cleanups.forEach((fn) => fn());
    delete list.dataset.tzRsvp;
  };
}

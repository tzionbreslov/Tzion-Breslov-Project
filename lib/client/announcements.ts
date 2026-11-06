import copy from "@/content/copy/en.json";
import { API_PATHS, ENVELOPE_FIELDS, SUBSCRIBE_TOPICS, TURNSTILE_ACTIONS, type ApiErrorResponse, type SubscribeRequest, type SubscribeTopic } from "@/lib/api-contract";
import { publicConfig } from "./config";
import { CONFIRMATION, EMAIL, MESSAGES, addHoneypot } from "./forms";
import { envelopeFields, submitPublicForm } from "./submit";
import { mountTurnstile, type TurnstileHandle } from "./turnstile";

/**
 * The "Get event announcements" signup on the Events page (lib/events.mjs
 * renders it): an email, the lists to join (Event announcements, Newsletter;
 * at least one) and the consent, sent to POST /v1/subscribe as `topics`. The
 * Worker's double opt-in then emails a confirmation link, so success shows the
 * footer signup's own confirmation, word for word. Without a forms API (the
 * preview) it shows the forms' "temporarily unavailable" message.
 */

const text = copy.announcements;

const isTopic = (value: string): value is SubscribeTopic => (SUBSCRIBE_TOPICS as readonly string[]).includes(value);

function enhance(section: HTMLElement) {
  const form = section.querySelector("form");
  if (!form || section.dataset.tzAnnouncements) return () => undefined;
  const email = form.querySelector<HTMLInputElement>("input[name=email]");
  const lists = form.querySelector<HTMLFieldSetElement>("fieldset");
  const topics = [...form.querySelectorAll<HTMLInputElement>("input[name=topics]")];
  const consent = form.querySelector<HTMLInputElement>("input[name=consent]");
  const submit = form.querySelector<HTMLButtonElement>("button[type=submit]");
  if (!email || !lists || !topics.length || !consent || !submit) return () => undefined;

  const { apiBaseUrl, turnstileSiteKey } = publicConfig();
  const startedAt = Date.now();
  const honeypot = addHoneypot(form);
  let turnstile: TurnstileHandle | undefined;
  const holder = document.createElement("div");
  holder.className = "tz-turnstile";
  if (apiBaseUrl && turnstileSiteKey) {
    submit.before(holder);
    turnstile = mountTurnstile(holder, turnstileSiteKey, TURNSTILE_ACTIONS.subscribe);
  }
  let requestId = crypto.randomUUID();
  let sending = false;
  let message: HTMLElement | null = null;

  const clearErrors = () => {
    form.querySelectorAll(".tz-field__error").forEach((node) => node.remove());
    form.querySelectorAll("[aria-invalid=true], fieldset[aria-describedby]").forEach((node) => {
      node.removeAttribute("aria-invalid");
      node.removeAttribute("aria-describedby");
    });
    message?.remove();
    message = null;
  };
  /** A field's problem, read with the field (aria-describedby); the lists' on the group. */
  const fieldError = (target: HTMLInputElement | HTMLFieldSetElement, messageText: string) => {
    const note = document.createElement("p");
    note.className = "tz-field__error";
    note.id = `${target === lists ? "tz-announce-lists" : target === consent ? "tz-announce-consent" : "tz-announce-email"}-error`;
    note.textContent = messageText;
    if (target !== lists) target.setAttribute("aria-invalid", "true");
    target.setAttribute("aria-describedby", note.id);
    (target === lists ? lists : target === consent ? consent.closest("label") ?? consent : target).after(note);
  };
  const announce = (messageText: string) => {
    message = document.createElement("p");
    message.className = "tz-form-message tz-form-message--error";
    message.setAttribute("role", "alert");
    message.tabIndex = -1;
    message.textContent = messageText;
    submit.before(message);
    message.focus();
  };

  const onSubmit = async (event: SubmitEvent) => {
    event.preventDefault();
    if (sending) return;
    clearErrors();
    const chosen = topics.filter((box) => box.checked).map((box) => box.value).filter(isTopic);
    const address = email.value.trim();
    const errors: Array<[HTMLInputElement | HTMLFieldSetElement, string, HTMLElement]> = [];
    if (!address) errors.push([email, MESSAGES.required, email]);
    else if (!EMAIL.test(address)) errors.push([email, MESSAGES.email, email]);
    if (!chosen.length) errors.push([lists, text.chooseList, topics[0]]);
    if (!consent.checked) errors.push([consent, text.consentRequired, consent]);
    if (errors.length) {
      errors.forEach(([target, messageText]) => fieldError(target, messageText));
      errors[0][2].focus();
      return;
    }
    if (!apiBaseUrl || !turnstile) {
      announce(MESSAGES.unavailable);
      return;
    }
    sending = true;
    submit.disabled = true;
    form.setAttribute("aria-busy", "true");
    try {
      const payload: SubscribeRequest = {
        email: address,
        topics: chosen,
        [ENVELOPE_FIELDS.honeypot]: honeypot.value,
        ...envelopeFields(startedAt, await turnstile.token(), requestId)
      };
      const response = await submitPublicForm(API_PATHS.subscribe, payload);
      if (response.ok) {
        turnstile.remove();
        turnstile = undefined;
        const done = document.createElement("p");
        done.className = "tz-form-message tz-form-message--success";
        done.setAttribute("role", "status");
        done.tabIndex = -1;
        done.textContent = CONFIRMATION.signup;
        form.replaceWith(done);
        done.focus();
        return;
      }
      const answer = (await response.json().catch(() => null)) as ApiErrorResponse | null;
      if (response.status < 500) {
        requestId = crypto.randomUUID();
        turnstile.reset();
      }
      if (answer?.error === "INVALID_INPUT" && answer.field === "email") {
        fieldError(email, MESSAGES.email);
        email.focus();
      } else {
        announce(answer?.error === "RATE_LIMITED" ? MESSAGES.rateLimited : MESSAGES.failed);
      }
    } catch {
      announce(MESSAGES.failed);
    } finally {
      sending = false;
      submit.disabled = false;
      form.removeAttribute("aria-busy");
    }
  };

  form.addEventListener("submit", onSubmit);
  section.dataset.tzAnnouncements = "ready";
  return () => {
    form.removeEventListener("submit", onSubmit);
    turnstile?.remove();
    holder.remove();
    honeypot.closest(".tz-hp")?.remove();
    section.dataset.tzAnnouncements = "";
  };
}

export function enhanceAnnouncements(root: ParentNode = document) {
  const cleanups = [...root.querySelectorAll<HTMLElement>("[data-tz-announcements]")].map(enhance);
  return () => cleanups.forEach((fn) => fn());
}

import {
  API_PATHS,
  ENVELOPE_FIELDS,
  FIELD_LIMITS,
  PHONE_PATTERN,
  TURNSTILE_ACTIONS,
  type ApiErrorResponse,
  type ApiInputField
} from "@/lib/api-contract";
import { mountTurnstile, type TurnstileHandle } from "./turnstile";
import { publicConfig } from "./config";
import { envelopeFields, submitPublicForm } from "./submit";

/**
 * Turns the imported Gravity Forms markup (signup in the footer, contact page)
 * into working forms that post to the Tzion forms API (worker/). Validation
 * and confirmation output reuse Gravity Forms' own markup and classes, so the
 * original CSS styles every state.
 */

type FormKind = "signup" | "contact";

type FieldSpec = { api: ApiInputField; required?: boolean; kind?: "email" | "phone" | "message" };

const FIELDS: Record<FormKind, Record<string, FieldSpec>> = {
  signup: { input_1: { api: "email", required: true, kind: "email" } },
  contact: {
    input_1: { api: "firstName" },
    input_3: { api: "lastName" },
    input_4: { api: "email", required: true, kind: "email" },
    input_5: { api: "phone", kind: "phone" },
    input_6: { api: "address" },
    input_7: { api: "message", required: true, kind: "message" }
  }
};

/** Also the "Get event announcements" signup's confirmation (announcements.ts), word for word. */
export const CONFIRMATION: Record<FormKind, string> = {
  signup: "Almost there! Please check your inbox and click the link to confirm your subscription.",
  contact: "Thanks for contacting us! We will get in touch with you shortly."
};

/** The site's form messages; the RSVP and announcements forms reuse the ones they share. */
export const MESSAGES = {
  required: "This field is required.",
  email: "The email address entered is invalid, please check the formatting (e.g. email@domain.com).",
  phone: "Please enter a valid phone number.",
  messageShort: `Please enter at least ${FIELD_LIMITS.message.min} characters.`,
  form: "There was a problem with your submission. Please review the fields below.",
  unavailable: `This form is temporarily unavailable. Please email us at ${publicConfig().contactEmail}.`,
  rateLimited: "Too many submissions. Please try again in a few minutes.",
  failed: "Something went wrong sending your message. Please try again."
};

/** The Worker's email check (worker/src/validation.ts). */
export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function formNumber(form: HTMLFormElement) {
  return form.id.replace("gform_", "");
}

function clearErrors(form: HTMLFormElement) {
  form.closest(".gform_wrapper")?.classList.remove("gform_validation_error");
  form.querySelector(".gform_validation_errors")?.remove();
  form.querySelectorAll(".gfield_error").forEach((el) => el.classList.remove("gfield_error"));
  form.querySelectorAll(".gfield_validation_message").forEach((el) => el.remove());
  form.querySelectorAll("[aria-invalid=true]").forEach((el) => {
    el.setAttribute("aria-invalid", "false");
    el.removeAttribute("aria-describedby");
  });
}

function showFormError(form: HTMLFormElement, message: string) {
  const n = formNumber(form);
  form.closest(".gform_wrapper")?.classList.add("gform_validation_error");
  const box = document.createElement("div");
  box.className = "gform_validation_errors";
  box.id = `gform_${n}_validation_container`;
  box.tabIndex = -1;
  box.setAttribute("role", "alert");
  const h2 = document.createElement("h2");
  h2.className = "gform_submission_error";
  const icon = document.createElement("span");
  icon.className = "gform-icon gform-icon--circle-error";
  h2.append(icon, message);
  box.append(h2);
  form.prepend(box);
  box.focus();
}

function showFieldError(form: HTMLFormElement, input: HTMLInputElement | HTMLTextAreaElement, message: string) {
  const field = input.closest(".gfield");
  if (!field) return;
  const id = `validation_message_${formNumber(form)}_${input.name.replace("input_", "")}`;
  field.classList.add("gfield_error");
  input.setAttribute("aria-invalid", "true");
  input.setAttribute("aria-describedby", id);
  const msg = document.createElement("div");
  msg.id = id;
  msg.className = "gfield_description validation_message gfield_validation_message";
  msg.textContent = message;
  field.append(msg);
}

function showConfirmation(form: HTMLFormElement, message: string) {
  const n = formNumber(form);
  const wrapper = form.closest(".gform_wrapper");
  const outer = document.createElement("div");
  outer.id = `gform_confirmation_wrapper_${n}`;
  outer.className = "gform_confirmation_wrapper ";
  const inner = document.createElement("div");
  inner.id = `gform_confirmation_message_${n}`;
  inner.className = `gform_confirmation_message_${n} gform_confirmation_message`;
  inner.setAttribute("role", "status");
  inner.tabIndex = -1;
  inner.textContent = message;
  outer.append(inner);
  (wrapper ?? form).replaceWith(outer);
  inner.focus();
}

function validate(kind: FormKind, form: HTMLFormElement) {
  const values: Record<string, string> = {};
  const errors: Array<[HTMLInputElement | HTMLTextAreaElement, string]> = [];
  for (const [name, spec] of Object.entries(FIELDS[kind])) {
    const input = form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement | null;
    if (!input) continue;
    const value = input.value.trim();
    if (!value) {
      if (spec.required) errors.push([input, MESSAGES.required]);
      continue;
    }
    if (spec.kind === "email" && !EMAIL.test(value)) errors.push([input, MESSAGES.email]);
    else if (spec.kind === "phone" && !PHONE_PATTERN.test(value)) errors.push([input, MESSAGES.phone]);
    else if (spec.kind === "message" && value.length < FIELD_LIMITS.message.min) errors.push([input, MESSAGES.messageShort]);
    values[spec.api] = value;
  }
  return { values, errors };
}

function inputFor(kind: FormKind, form: HTMLFormElement, field: ApiInputField | undefined) {
  const name = Object.entries(FIELDS[kind]).find(([, spec]) => spec.api === field)?.[0];
  return name ? (form.elements.namedItem(name) as HTMLInputElement | null) : null;
}

/** The visually hidden honeypot (app/enhancements.css .tz-hp), appended to the form. */
export function addHoneypot(form: HTMLFormElement) {
  const wrap = document.createElement("div");
  wrap.className = "tz-hp";
  wrap.setAttribute("aria-hidden", "true");
  const input = document.createElement("input");
  input.type = "text";
  input.name = ENVELOPE_FIELDS.honeypot;
  input.tabIndex = -1;
  input.autocomplete = "off";
  wrap.append(input);
  form.append(wrap);
  return input;
}

function enhance(form: HTMLFormElement) {
  const kind = form.dataset.tzForm as FormKind;
  if (!FIELDS[kind] || form.dataset.tzReady) return () => undefined;
  form.dataset.tzReady = "true";

  const { apiBaseUrl, turnstileSiteKey } = publicConfig();
  const startedAt = Date.now();
  const honeypot = addHoneypot(form);
  let turnstile: TurnstileHandle | undefined;
  if (apiBaseUrl && turnstileSiteKey) {
    const holder = document.createElement("div");
    holder.className = "tz-turnstile";
    (form.querySelector(".gform_footer") ?? form).before(holder);
    turnstile = mountTurnstile(holder, turnstileSiteKey, kind === "signup" ? TURNSTILE_ACTIONS.subscribe : TURNSTILE_ACTIONS.contact);
  }
  const button = form.querySelector<HTMLInputElement | HTMLButtonElement>("[type=submit]");
  let sending = false;

  const onSubmit = async (event: SubmitEvent) => {
    event.preventDefault();
    if (sending) return;
    clearErrors(form);
    const { values, errors } = validate(kind, form);
    if (errors.length) {
      showFormError(form, MESSAGES.form);
      errors.forEach(([input, message]) => showFieldError(form, input, message));
      errors[0][0].focus();
      return;
    }
    if (!apiBaseUrl || !turnstile) {
      showFormError(form, MESSAGES.unavailable);
      return;
    }
    sending = true;
    button?.setAttribute("disabled", "disabled");
    form.setAttribute("aria-busy", "true");
    try {
      const payload = {
        ...values,
        [ENVELOPE_FIELDS.honeypot]: honeypot.value,
        ...envelopeFields(startedAt, await turnstile.token())
      };
      const response = await submitPublicForm(kind === "signup" ? API_PATHS.subscribe : API_PATHS.contact, payload);
      if (response.ok) {
        turnstile.remove();
        showConfirmation(form, CONFIRMATION[kind]);
        return;
      }
      const body = (await response.json().catch(() => null)) as ApiErrorResponse | null;
      const fieldInput = body?.error === "INVALID_INPUT" ? inputFor(kind, form, body.field) : null;
      if (fieldInput) {
        showFormError(form, MESSAGES.form);
        showFieldError(form, fieldInput, fieldInput.type === "email" ? MESSAGES.email : MESSAGES.required);
      } else {
        showFormError(form, body?.error === "RATE_LIMITED" ? MESSAGES.rateLimited : MESSAGES.failed);
      }
      turnstile.reset();
    } catch {
      showFormError(form, MESSAGES.failed);
      turnstile.reset();
    } finally {
      sending = false;
      button?.removeAttribute("disabled");
      form.removeAttribute("aria-busy");
    }
  };

  form.addEventListener("submit", onSubmit);
  return () => {
    form.removeEventListener("submit", onSubmit);
    turnstile?.remove();
  };
}

export function enhanceForms(root: ParentNode = document) {
  const cleanups = [...root.querySelectorAll<HTMLFormElement>("form[data-tz-form]")].map(enhance);
  return () => cleanups.forEach((fn) => fn());
}

"use client";

import { useId, useMemo, useState, type FormEvent } from "react";
import copy from "@/content/copy/en.json";
import {
  DONATION_TIERS,
  MAX_CUSTOM_AMOUNT,
  MIN_CUSTOM_AMOUNT,
  PAYPAL_AUTOPAY_URL,
  beginCheckout,
  formatUsd,
  type Frequency
} from "@/lib/client/donations";
import { publicConfig } from "@/lib/client/config";

// The form's original wording stays as written below; text added since comes
// from content/copy/en.json (`donate`).
const text = copy.donate;

type Errors = Partial<Record<"amount" | "email", string>>;
type Status = "idle" | "working" | "unavailable";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function DonateForm() {
  const id = useId();
  const { paypalClientId, contactEmail } = publicConfig();
  const [choice, setChoice] = useState<number | "other">(DONATION_TIERS[1].amount);
  const [custom, setCustom] = useState("");
  const [frequency, setFrequency] = useState<Frequency>("one-time");
  const [dedication, setDedication] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [status, setStatus] = useState<Status>("idle");

  const amount = useMemo(() => {
    if (choice !== "other") return choice;
    const n = Number(custom.replace(/[^\d.]/g, ""));
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
  }, [choice, custom]);
  const tier = DONATION_TIERS.find((t) => t.amount === choice);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next: Errors = {};
    if (!amount || amount < MIN_CUSTOM_AMOUNT || amount > MAX_CUSTOM_AMOUNT) {
      next.amount = `Please enter an amount between ${formatUsd(MIN_CUSTOM_AMOUNT)} and ${formatUsd(MAX_CUSTOM_AMOUNT)}.`;
    }
    if (email.trim() && !EMAIL.test(email.trim())) next.email = "Please enter a valid email address.";
    setErrors(next);
    if (Object.keys(next).length) {
      document.getElementById(`${id}-${Object.keys(next)[0]}`)?.focus();
      return;
    }
    setStatus("working");
    const result = await beginCheckout({ amount, frequency, dedication: dedication.trim(), name: name.trim(), email: email.trim() }, paypalClientId);
    if (result.status === "redirect") window.location.href = result.url;
    else setStatus("unavailable");
  }

  const mailto = `mailto:${contactEmail}?subject=${encodeURIComponent("Donation to Tzion Breslov")}&body=${encodeURIComponent(
    `I would like to give ${formatUsd(amount || 0)} ${frequency === "monthly" ? "monthly" : "as a one-time gift"}.${dedication ? `\nDedication: ${dedication}` : ""}${name ? `\nName: ${name}` : ""}`
  )}`;

  return (
    <form className="tz-donate__form donate-form" onSubmit={onSubmit} noValidate aria-describedby={`${id}-summary`}>
      <fieldset className="tz-donate__group">
        <legend className="gfield_label">Choose a donation amount</legend>
        <div className="tz-donate__tiers">
          {DONATION_TIERS.map((t) => (
            <label key={t.amount} className={`tz-donate__tier${choice === t.amount ? " is-selected" : ""}`}>
              <input type="radio" name="amount" value={t.amount} checked={choice === t.amount} onChange={() => setChoice(t.amount)} />
              <span className="tz-donate__price">{formatUsd(t.amount)}</span>
              <span className="tz-donate__desc">{t.label}</span>
            </label>
          ))}
          <label className={`tz-donate__tier tz-donate__tier--other${choice === "other" ? " is-selected" : ""}`}>
            <input type="radio" name="amount" value="other" checked={choice === "other"} onChange={() => setChoice("other")} />
            <span className="tz-donate__price">Other amount</span>
            {choice === "other" && (
              <span className="tz-donate__custom">
                <span aria-hidden="true">$</span>
                <input
                  id={`${id}-amount`}
                  type="text"
                  inputMode="decimal"
                  autoComplete="transaction-amount"
                  aria-label="Other amount in US dollars"
                  aria-invalid={Boolean(errors.amount)}
                  aria-describedby={errors.amount ? `${id}-amount-error` : undefined}
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                  autoFocus
                />
              </span>
            )}
          </label>
        </div>
        {errors.amount && <p className="tz-donate__error" id={`${id}-amount-error`}>{errors.amount}</p>}
      </fieldset>

      <fieldset className="tz-donate__group">
        <legend className="gfield_label">How often would you like to donate?</legend>
        <div className="tz-donate__frequency" role="radiogroup">
          {(["monthly", "one-time"] as const).map((f) => (
            <label key={f} className={`tz-donate__freq${frequency === f ? " is-selected" : ""}`}>
              <input type="radio" name="frequency" value={f} checked={frequency === f} onChange={() => setFrequency(f)} />
              <span>{f === "monthly" ? "Monthly" : "One time"}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {/* For donors already giving monthly: shown whatever is chosen above. The link comes
          first and the note is its description, so it is read with the link on focus. */}
      <div className="tz-donate__manage-block">
        <a className="tz-donate__manage" href={PAYPAL_AUTOPAY_URL} target="_blank" rel="noopener noreferrer" aria-describedby={`${id}-manage-note`}>
          {text.manageMonthly}
        </a>
        <p className="tz-donate__manage-note" id={`${id}-manage-note`}>{text.manageMonthlyNote}</p>
      </div>

      <div className="tz-donate__group">
        <label className="gfield_label" htmlFor={`${id}-dedication`}>Dedication / In Honor Of / Other Note</label>
        <input id={`${id}-dedication`} type="text" maxLength={300} value={dedication} onChange={(e) => setDedication(e.target.value)} />
      </div>

      <div className="tz-donate__row">
        <div className="tz-donate__group">
          <label className="gfield_label" htmlFor={`${id}-name`}>Name</label>
          <input id={`${id}-name`} type="text" autoComplete="name" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="tz-donate__group">
          <label className="gfield_label" htmlFor={`${id}-email`}>Email</label>
          <input
            id={`${id}-email`}
            type="email"
            autoComplete="email"
            maxLength={254}
            aria-invalid={Boolean(errors.email)}
            aria-describedby={errors.email ? `${id}-email-error` : undefined}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          {errors.email && <p className="tz-donate__error" id={`${id}-email-error`}>{errors.email}</p>}
        </div>
      </div>

      <p className="tz-donate__summary" id={`${id}-summary`} aria-live="polite">
        {amount > 0 ? (
          <>
            You&rsquo;re giving <strong>{formatUsd(amount)}</strong> {frequency === "monthly" ? "every month" : "once"}
            {tier ? <> &mdash; {tier.label.toLowerCase()}</> : null}.
          </>
        ) : (
          "Choose or enter an amount to continue."
        )}
      </p>

      <button type="submit" className="gform_button button tz-donate__submit" disabled={status === "working"}>
        {status === "working" ? "One moment…" : amount > 0 ? `Donate ${formatUsd(amount)}${frequency === "monthly" ? " / month" : ""}` : "Donate"}
      </button>

      {status === "unavailable" && (
        <div className="tz-donate__notice" role="status">
          <p>
            <strong>Online checkout is being upgraded.</strong> Thank you for your generosity! To give today, please{" "}
            <a href={mailto}>email us at {contactEmail}</a> and we&rsquo;ll send you a secure way to complete your gift.
          </p>
        </div>
      )}
    </form>
  );
}

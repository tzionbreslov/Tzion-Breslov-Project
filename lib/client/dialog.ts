/**
 * A modal dialog (the Classes video player, the Gallery viewer and the Events
 * page's RSVP form): an overlay plus a centred `role="dialog"` box appended to <body>.
 * Focus moves into it and can't Tab out, Escape or a click on the overlay
 * closes it, and the page behind doesn't scroll. Closing plays the exit
 * animation (app/dialog.css; skipped with reduced motion), removes it and
 * puts focus back on `opener`.
 *
 * Keys pressed while focus is inside an embedded frame (the YouTube player)
 * go to that frame, so Escape works only outside it; Tab out of the frame
 * lands on a focus guard and wraps back into the dialog.
 */

export type DialogOptions = {
  /** The dialog's accessible name. */
  label: string;
  content: HTMLElement;
  /** Gets focus back after closing (usually the control that opened it). */
  opener: HTMLElement | null;
  /** Extra classes on the dialog box. */
  className: string;
  /** Runs as soon as closing starts. */
  onClose?: () => void;
};

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])';

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * How long the closing dialog's exit animation runs, in ms: its animation-duration, as app/dialog.css sets it for
 * `.tz-dialog[data-state="closed"]` (the one place the length is written). The dialog is removed when it ends.
 */
function exitMs(dialog: HTMLElement) {
  const durations = getComputedStyle(dialog).animationDuration.split(",").map((value) => {
    const time = Number.parseFloat(value);
    if (!Number.isFinite(time)) return 0;
    return value.trim().endsWith("ms") ? time : time * 1000;
  });
  return Math.round(Math.max(0, ...durations));
}

function focusGuard() {
  const guard = document.createElement("span");
  guard.tabIndex = 0;
  guard.className = "tz-dialog__guard";
  guard.dataset.tzFocusGuard = "";
  return guard;
}

export function openDialog({ label, content, opener, className, onClose }: DialogOptions): { close(): void } {
  const overlay = document.createElement("div");
  overlay.className = "tz-dialog-overlay";
  overlay.dataset.state = "open";

  const dialog = document.createElement("div");
  dialog.className = `tz-dialog ${className}`.trim();
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", label);
  dialog.tabIndex = -1;
  dialog.dataset.state = "open";
  const start = focusGuard();
  const end = focusGuard();
  dialog.append(start, content, end);

  const focusables = () => [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((node) => !("tzFocusGuard" in node.dataset));
  const first = () => focusables()[0] ?? dialog;
  const last = () => focusables().at(-1) ?? dialog;

  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault();
      close();
    } else if (event.key === "Tab") {
      const active = document.activeElement;
      if (event.shiftKey ? active === first() || active === dialog : active === last()) {
        event.preventDefault();
        (event.shiftKey ? last() : first()).focus();
      }
    }
  };
  // Focus that still escapes (a Tab out of the iframe, a click on the page behind) comes back in.
  const onFocusIn = (event: FocusEvent) => {
    if (!dialog.contains(event.target as Node)) first().focus();
  };
  const onOverlayClick = () => close();
  start.addEventListener("focus", () => last().focus());
  end.addEventListener("focus", () => first().focus());

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", onKey);
    document.removeEventListener("focusin", onFocusIn);
    overlay.removeEventListener("click", onOverlayClick);
    document.documentElement.classList.remove("tz-dialog-open");
    overlay.dataset.state = dialog.dataset.state = "closed";
    onClose?.();
    const finish = () => {
      // Give focus back unless the visitor has already moved it somewhere else.
      const active = document.activeElement;
      const focusWasInside = !active || active === document.body || dialog.contains(active);
      overlay.remove();
      dialog.remove();
      if (focusWasInside) opener?.focus();
    };
    if (reducedMotion()) finish();
    else window.setTimeout(finish, exitMs(dialog));
  }

  document.body.append(overlay, dialog);
  document.documentElement.classList.add("tz-dialog-open");
  document.addEventListener("keydown", onKey);
  document.addEventListener("focusin", onFocusIn);
  overlay.addEventListener("click", onOverlayClick);
  first().focus();
  return { close };
}

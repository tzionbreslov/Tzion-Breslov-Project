import {
  API_PATHS,
  CONFIRMATION_TOKEN_PATTERN,
  SUBSCRIPTION_QUERY,
  SUBSCRIPTION_QUERY_PARAM,
  SUBSCRIPTION_TOKEN_FRAGMENT_PARAM,
  type SubscribeConfirmRequest,
  type SubscribeConfirmResponse
} from "@/lib/api-contract";
import { publicConfig } from "./config";

/**
 * Second step of the newsletter double opt-in. The emailed link
 * (GET /v1/subscribe/confirm) only redirects to the site with
 * `?subscription=confirm#token=…`, so mail scanners that pre-fetch links (or
 * run the page's JavaScript) subscribe nobody: the visitor has to press
 * "Confirm my subscription", which POSTs the token. Also explains the
 * `invalid` and `error` outcomes. `?subscription=confirmed` (link already used)
 * keeps its notice in components/enhancers.tsx.
 */

type View = {
  message: string;
  /** Set while the visitor can (re)send the confirmation. */
  token?: string;
  busy?: boolean;
  /** Offer to jump to the footer signup form. */
  signUp?: boolean;
};

const CONFIRM_LABEL = "Confirm my subscription";

const MESSAGES = {
  prompt: "Please confirm that you would like to join the Tzion Breslov mailing list.",
  busy: "Confirming your subscription…",
  joined: "You’ve joined the Tzion Breslov mailing list, welcome to the family!",
  invalid: "This confirmation link is invalid or has expired. Please sign up again.",
  retry: "We couldn’t confirm your subscription just now. Please try again in a few minutes.",
  linkError: "We couldn’t check your confirmation link just now. Please open it again from your email later.",
  unavailable: `Mailing list signups are temporarily unavailable. Please email us at ${publicConfig().contactEmail}.`
};

/**
 * Module state, so React Strict Mode's mount → cleanup → mount (and any later
 * remount) re-renders the same notice even though the URL was already cleaned.
 * `undefined` = the URL has not been read yet on this page load.
 */
let view: View | null | undefined;
let ui: { notice: HTMLElement; text: HTMLElement; confirm: HTMLButtonElement; signUp: HTMLButtonElement } | null = null;

function signupEmailInput(doc: Document) {
  return doc.querySelector<HTMLInputElement>('form[data-tz-form="signup"] input[type="email"]');
}

function invalidView(): View {
  return { message: MESSAGES.invalid, signUp: true };
}

/** Reads the status (and token) once, then removes both from the address bar and history entry. */
function readViewFromUrl(): View | null {
  const url = new URL(window.location.href);
  const status = url.searchParams.get(SUBSCRIPTION_QUERY_PARAM);
  if (status !== SUBSCRIPTION_QUERY.confirm && status !== SUBSCRIPTION_QUERY.invalid && status !== SUBSCRIPTION_QUERY.error) {
    return null;
  }
  const token = new URLSearchParams(url.hash.slice(1)).get(SUBSCRIPTION_TOKEN_FRAGMENT_PARAM) ?? "";
  url.searchParams.delete(SUBSCRIPTION_QUERY_PARAM);
  window.history.replaceState(null, "", url.pathname + url.search);

  if (status === SUBSCRIPTION_QUERY.error) return { message: MESSAGES.linkError };
  if (status === SUBSCRIPTION_QUERY.invalid || !CONFIRMATION_TOKEN_PATTERN.test(token)) return invalidView();
  if (!publicConfig().apiBaseUrl) return { message: MESSAGES.unavailable };
  return { message: MESSAGES.prompt, token };
}

function actionButton(doc: Document, label: string, onClick: () => void) {
  const button = doc.createElement("button");
  button.type = "button";
  button.className = "tz-notice__action";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function build(doc: Document) {
  const notice = doc.createElement("div");
  notice.className = "tz-notice tz-notice--subscription";
  notice.setAttribute("role", "region");
  notice.setAttribute("aria-label", "Mailing list subscription");
  const body = doc.createElement("div");
  body.className = "tz-notice__body";
  const text = doc.createElement("p");
  text.setAttribute("role", "status");
  text.tabIndex = -1;
  const confirm = actionButton(doc, CONFIRM_LABEL, () => {
    if (view?.token && !view.busy) void submit(view.token);
  });
  const signUp = actionButton(doc, "Sign up again", () => {
    const input = signupEmailInput(doc);
    view = null;
    paint();
    input?.focus();
  });
  const dismiss = doc.createElement("button");
  dismiss.type = "button";
  dismiss.setAttribute("aria-label", "Dismiss");
  dismiss.textContent = "×";
  dismiss.addEventListener("click", () => {
    view = null;
    paint();
  });
  body.append(text, confirm, signUp);
  notice.append(body, dismiss);
  doc.body.append(notice);
  return { notice, text, confirm, signUp };
}

/** Updates the notice in place, so the status text stays one live region and focus is kept. */
function paint(focus?: "confirm" | "message") {
  if (!ui) return;
  if (!view) {
    ui.notice.remove();
    ui = null;
    return;
  }
  const { notice, text, confirm, signUp } = ui;
  text.textContent = view.message;
  confirm.hidden = !view.token;
  confirm.textContent = view.busy ? "Confirming…" : CONFIRM_LABEL;
  // aria-disabled (not disabled) keeps keyboard focus on the button while the request runs.
  confirm.setAttribute("aria-disabled", String(Boolean(view.busy)));
  notice.setAttribute("aria-busy", String(Boolean(view.busy)));
  signUp.hidden = !view.signUp || !signupEmailInput(notice.ownerDocument);
  if (focus === "confirm") confirm.focus({ preventScroll: true });
  if (focus === "message") text.focus({ preventScroll: true });
}

async function submit(token: string) {
  view = { message: MESSAGES.busy, token, busy: true };
  paint();
  let next: View;
  try {
    const response = await fetch(publicConfig().apiBaseUrl + API_PATHS.subscribeConfirm, {
      method: "POST",
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ token } satisfies SubscribeConfirmRequest)
    });
    const body = (await response.json().catch(() => null)) as SubscribeConfirmResponse | null;
    if (response.ok && body?.ok) next = { message: MESSAGES.joined };
    else if (body?.ok === false && (body.error === "INVALID_CONFIRMATION" || body.error === "INVALID_INPUT")) next = invalidView();
    else next = { message: MESSAGES.retry, token };
  } catch {
    next = { message: MESSAGES.retry, token };
  }
  view = next;
  paint(next.token ? "confirm" : "message");
}

/** Mounted on every page; does nothing unless the URL carries a subscription status. */
export function enhanceSubscriptionConfirmation(doc: Document = document) {
  if (view === undefined) view = readViewFromUrl();
  if (!view) return () => undefined;
  ui ??= build(doc);
  paint(view.token && !view.busy ? "confirm" : undefined);
  return () => {
    ui?.notice.remove();
    ui = null;
  };
}

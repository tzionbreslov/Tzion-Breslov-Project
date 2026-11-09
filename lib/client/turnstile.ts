/**
 * Cloudflare Turnstile, rendered "interaction-only" so it stays invisible
 * unless Cloudflare needs the visitor to click — the forms keep their
 * original WordPress look.
 */

type TurnstileApi = {
  render(container: HTMLElement, options: Record<string, unknown>): string;
  getResponse(widgetId: string): string | undefined;
  reset(widgetId: string): void;
  remove(widgetId: string): void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loader: Promise<TurnstileApi> | undefined;

/** The token wait's error (`TurnstileHandle.token`): the widget is there, but gave no token in time. */
export const TURNSTILE_TIMEOUT = "TURNSTILE_TIMEOUT";

function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loader ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    // A failed load isn't kept: its script goes, and the next mount loads Turnstile again (after a brief network
    // drop, say). A widget already mounted keeps its own failed load.
    const fail = (code: string) => {
      script.remove();
      loader = undefined;
      reject(new Error(code));
    };
    script.addEventListener("load", () => (window.turnstile ? resolve(window.turnstile) : fail("TURNSTILE_UNAVAILABLE")), { once: true });
    script.addEventListener("error", () => fail("TURNSTILE_LOAD_FAILED"), { once: true });
    document.head.append(script);
  });
  return loader;
}

export type TurnstileHandle = {
  /** Resolves with a fresh token, waiting up to `timeoutMs` for the challenge. */
  token(timeoutMs?: number): Promise<string>;
  reset(): void;
  remove(): void;
};

/**
 * Widget size (Cloudflare: "flexible" fills its container, at least 300 px wide; "compact" is 150 × 140 px). The
 * forms use the default; the contact details' check (contact-details.ts) is compact, for the footer's narrow column.
 */
export type TurnstileOptions = { size?: "flexible" | "compact" };

export function mountTurnstile(container: HTMLElement, siteKey: string, action: string, options: TurnstileOptions = {}): TurnstileHandle {
  let widgetId: string | undefined;
  const ready = loadTurnstile().then((api) => {
    widgetId = api.render(container, {
      sitekey: siteKey,
      action,
      appearance: "interaction-only",
      size: options.size ?? "flexible",
      "response-field": false
    });
    return api;
  });

  return {
    async token(timeoutMs = 15_000) {
      const api = await ready;
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const value = widgetId ? api.getResponse(widgetId) : undefined;
        if (value) return value;
        await new Promise((r) => setTimeout(r, 250));
      }
      throw new Error(TURNSTILE_TIMEOUT);
    },
    reset() {
      if (widgetId) void ready.then((api) => api.reset(widgetId!));
    },
    remove() {
      if (widgetId) void ready.then((api) => api.remove(widgetId!));
    }
  };
}

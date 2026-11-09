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

function loadTurnstile() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loader ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.addEventListener("load", () => (window.turnstile ? resolve(window.turnstile) : reject(new Error("TURNSTILE_UNAVAILABLE"))), { once: true });
    script.addEventListener("error", () => reject(new Error("TURNSTILE_LOAD_FAILED")), { once: true });
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
      throw new Error("TURNSTILE_TIMEOUT");
    },
    reset() {
      if (widgetId) void ready.then((api) => api.reset(widgetId!));
    },
    remove() {
      if (widgetId) void ready.then((api) => api.remove(widgetId!));
    }
  };
}

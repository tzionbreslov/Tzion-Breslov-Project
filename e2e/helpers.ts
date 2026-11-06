import { expect, type Page } from "@playwright/test";
import { CSP } from "../config/security-headers.mjs";

// A pre-existing bug in the original theme, kept for fidelity: its number
// counter throws on scroll on pages without `.numbers`.
const KNOWN_THEME_ERROR = "/themes/tzionbreslov/js/global.js";

// Chromium logs every CSP violation on the console, quoting the directive it
// broke: `… violates the following Content Security Policy directive: "img-src 'self' …"`.
// Embedded third-party frames (e.g. the YouTube player, which has its own
// report-only policy) log violations of *their* policies to the same console,
// so only messages quoting one of our directives count. A CSP message whose
// directive can't be read counts too, so nothing is ever silently dropped.
const OUR_DIRECTIVES = new Set<string>((CSP as string).split(";").map((directive) => directive.trim()));
const QUOTED_DIRECTIVE = /Content Security Policy directive[^"]*"([^"]*)"/;
const violatesOurPolicy = (text: string) => {
  if (!/Content Security Policy/i.test(text)) return false;
  const directive = QUOTED_DIRECTIVE.exec(text)?.[1];
  return directive === undefined || OUR_DIRECTIVES.has(directive);
};

/** Collects the page's uncaught errors (minus the known theme bug). Call before the first goto. */
export function trackPageErrors(page: Page): () => Error[] {
  const errors: Error[] = [];
  page.on("pageerror", (error) => {
    if (!(error.stack ?? "").includes(KNOWN_THEME_ERROR)) errors.push(error);
  });
  return () => errors;
}

/** Every violation of the site's CSP that Chromium reported on this page so far (all navigations). */
export async function cspViolations(page: Page): Promise<string[]> {
  const messages = await page.consoleMessages({ filter: "all" });
  return messages.map((message) => message.text()).filter(violatesOurPolicy);
}

/** No page errors and no CSP violations. Every spec calls this at the end. */
export async function expectClean(page: Page, errors: () => Error[]): Promise<void> {
  expect({
    pageErrors: errors().map((error) => error.stack ?? String(error)),
    cspViolations: await cspViolations(page)
  }).toEqual({ pageErrors: [], cspViolations: [] });
}

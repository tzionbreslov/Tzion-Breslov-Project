// Decides whether a browser console message reports a violation of OUR
// Content Security Policy. Shared by the browser tests (e2e/helpers.ts) and
// scripts/check-csp.mjs.
//
// Chromium logs every CSP violation on the console, quoting the directive it
// broke: `… violates the following Content Security Policy directive: "img-src 'self' …"`.
// Embedded third-party frames (e.g. the YouTube player, which has its own
// report-only policy) log violations of *their* policies to the same console,
// so only messages quoting one of our directives count. A CSP message whose
// directive can't be read counts too, so nothing is ever silently dropped.
import { CSP } from "../../config/security-headers.mjs";

const QUOTED_DIRECTIVE = /Content Security Policy directive[^"]*"([^"]*)"/;
const directivesOf = (policy) => new Set(policy.split(";").map((directive) => directive.trim()));
const OUR_DIRECTIVES = directivesOf(CSP);

/**
 * `policy` is the policy the page was served with (default: the CSP from
 * config/security-headers.mjs); a live check passes the header it received,
 * so a drifted edge rule can't hide its own violations.
 */
export function violatesOurPolicy(text, policy = CSP) {
  if (!/Content Security Policy/i.test(text)) return false;
  const directive = QUOTED_DIRECTIVE.exec(text)?.[1];
  const ours = policy === CSP ? OUR_DIRECTIVES : directivesOf(policy);
  return directive === undefined || ours.has(directive);
}

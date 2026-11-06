// Response security headers for the public site. Cloudflare applies these at
// the edge (zone Transform Rule "Tzion security headers"); scripts/serve-out.mjs
// applies them locally and scripts/check-csp.mjs proves the CSP breaks nothing.
// Keep this file and the Cloudflare rule in sync (README → Security headers).

/** Third-party origins the site really uses (see README for why each exists). */
const SOURCES = {
  fonts: { style: ["https://fonts.googleapis.com"], font: ["https://fonts.gstatic.com"] },
  // The Classes page's player only (privacy-enhanced, loaded on click); no plain YouTube embeds remain.
  youtube: { img: ["https://i.ytimg.com"], frame: ["https://www.youtube-nocookie.com"] },
  turnstile: { script: ["https://challenges.cloudflare.com"], frame: ["https://challenges.cloudflare.com"], connect: ["https://challenges.cloudflare.com"] },
  // The Contact page's map (Google Maps embed, lazy-loaded; lib/pages/contact-map.ts).
  maps: { frame: ["https://www.google.com"] },
  formsApi: { connect: ["https://api.tzionbreslov.org"] }
};

const collect = (kind) => Object.values(SOURCES).flatMap((s) => s[kind] ?? []);

export const CSP_DIRECTIVES = {
  "default-src": ["'self'"],
  // 'unsafe-inline': Next.js inline bootstrap scripts, the imported WordPress
  // inline config/handlers (e.g. Spectra modal onclick). No user-generated
  // content is ever rendered, which is what makes this acceptable.
  "script-src": ["'self'", "'unsafe-inline'", ...collect("script")],
  "style-src": ["'self'", "'unsafe-inline'", ...collect("style")],
  "font-src": ["'self'", "data:", ...collect("font")],
  "img-src": ["'self'", "data:", ...collect("img")],
  "frame-src": collect("frame"),
  "connect-src": ["'self'", ...collect("connect")],
  "media-src": ["'self'"],
  "object-src": ["'none'"],
  "base-uri": ["'self'"],
  "form-action": ["'self'"],
  "frame-ancestors": ["'self'"],
  "upgrade-insecure-requests": []
};

const serialize = (entries) => entries.map(([k, v]) => (v.length ? `${k} ${v.join(" ")}` : k)).join("; ");

/** Enforced policy (local checks now; Cloudflare once the site is served from .org and verified). */
export const CSP = serialize(Object.entries(CSP_DIRECTIVES));

/**
 * What Cloudflare sends today as Content-Security-Policy-Report-Only. Browsers
 * ignore upgrade-insecure-requests in report-only mode (and log an error), so
 * it is left out until the policy is enforced.
 */
export const CSP_REPORT_ONLY = serialize(Object.entries(CSP_DIRECTIVES).filter(([k]) => k !== "upgrade-insecure-requests"));

export const SECURITY_HEADERS = {
  "Content-Security-Policy": CSP,
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  // Only features the site never uses; autoplay/fullscreen/encrypted-media stay
  // available because the YouTube embeds need them.
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), usb=(), serial=(), bluetooth=(), magnetometer=(), gyroscope=(), accelerometer=(), browsing-topics=()",
  "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
  "X-Permitted-Cross-Domain-Policies": "none"
};

import { strict as assert } from "node:assert";
import test from "node:test";
import { violatesOurPolicy } from "./lib/csp-console.mjs";

// Console messages copied from Chromium runs (Playwright 1.62, Chromium 2026-11):
// pages served with config/security-headers.mjs, and /video/video-N/ with its YouTube embed.
const OUR_IMAGE = `Loading the image 'https://example.com/x.png' violates the following Content Security Policy directive: "img-src 'self' data: https://i.ytimg.com". The action has been blocked.`;
const OUR_FRAME = `Framing 'https://example.com/' violates the following Content Security Policy directive: "frame-src https://www.youtube.com https://www.youtube-nocookie.com https://challenges.cloudflare.com". The request has been blocked.\n`;
const YOUTUBE_SCRIPT = `Loading the script 'https://www.youtube.com/s/player/a5c2aafe/player_embed.vflset/en_US/base.js' violates the following Content Security Policy directive: "script-src 'unsafe-inline'". Note that 'script-src-elem' was not explicitly set, so 'script-src' is used as a fallback. The policy is report-only, so the violation has been logged but no further action has been taken.`;
const YOUTUBE_EVAL = `Evaluating a string as JavaScript violates the following Content Security Policy directive because 'unsafe-eval' is not an allowed source of script: "script-src 'unsafe-inline'".\n The policy is report-only, so the violation has been logged but no further action has been taken.`;
const NO_QUOTED_DIRECTIVE = "The Content Security Policy directive 'upgrade-insecure-requests' is ignored when delivered in a report-only policy.";

test("a violation of one of our directives counts", () => {
  assert.equal(violatesOurPolicy(OUR_IMAGE), true);
  assert.equal(violatesOurPolicy(OUR_FRAME), true);
});

test("YouTube's report-only violations of its own policy don't count", () => {
  assert.equal(violatesOurPolicy(YOUTUBE_SCRIPT), false);
  assert.equal(violatesOurPolicy(YOUTUBE_EVAL), false);
});

test("a CSP message whose directive can't be read counts (fail-safe)", () => {
  assert.equal(violatesOurPolicy(NO_QUOTED_DIRECTIVE), true);
});

test("messages that aren't about CSP don't count", () => {
  assert.equal(violatesOurPolicy("JQMIGRATE: Migrate is installed, version 3.4.1"), false);
  assert.equal(violatesOurPolicy("Unrecognized feature: 'web-share'."), false);
});

test("the policy actually served decides what is ours (live checks)", () => {
  const served = "default-src 'self'; img-src 'self' data: https://i.ytimg.com https://cdn.example";
  const drifted = OUR_IMAGE.replace(`https://i.ytimg.com"`, `https://i.ytimg.com https://cdn.example"`);
  assert.equal(violatesOurPolicy(drifted), false);
  assert.equal(violatesOurPolicy(drifted, served), true);
  assert.equal(violatesOurPolicy(YOUTUBE_SCRIPT, served), false);
});

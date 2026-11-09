# Hidden Contact Details Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the phone number, WhatsApp link and email address partly covered, with "Show" buttons. One Turnstile check, verified by the forms Worker, reveals all of them for the rest of the visit, and the new phone number never enters the public repository.

**Architecture:**
- A pure `.mjs` module renders the covered slots and the render-time edits of imported HTML (footer, Contact cards, the speaking paragraph, one article).
- A client enhancer runs Turnstile on a tap and POSTs to a new Worker endpoint, `POST /v1/contact-details`. The endpoint verifies the token, rate-limits by hashed IP, and answers with the details from a Worker secret and a var.
- The enhancer fills every covered slot and caches the details in `sessionStorage`.

**Tech Stack:** Next.js 16 static export, TypeScript, Cloudflare Worker + D1 (vitest workers pool), Turnstile, Playwright, `node --test`.

**Spec:** `docs/superpowers/specs/2026-11-08-hidden-contact-details-design.md` (owner-approved 2026-11-09). The code map with exact file:line references is in `.superpowers/sdd/2026-11-08-hidden-contact/code-map.md`.

## Global Constraints
- **The new phone number never appears in any commit, file, commit message, PR title, body or comment, or test.**
  - Tests use the fake `+15555550123`, which displays as "(+1) 555-555-0123".
  - Before every push and PR edit, run the controller's STOP grep over `git log -p main..HEAD` and over the PR body
    file. Both must find nothing. The pattern is given privately, outside the repository: it would reveal the
    number's digits, so it never goes into a committed file, this plan included.
- **Owner-approved wording, verbatim:**
  - buttons: "Show number" and "Show email";
  - their accessible names: "Show number (phone and WhatsApp)" and "Show email address";
  - "Checking…";
  - "We couldn't check that you're a person. Please try again.";
  - "Too many tries. Please wait a minute and try again.";
  - the WhatsApp icon's name: "WhatsApp".
- **Covered forms:** `(+1) 347-•••-••••`, and `tzion••••••@gmail.com` (`Tzion••••••@gmail.com` where the original
  starts with a capital). The bullet is U+2022.
- **Places covered:**
  - the footer of every page (email, and phone + WhatsApp);
  - the /contact/ phone card and email card;
  - /privacy/ "write to …";
  - the speaking paragraph on /classes/, /articles/ and /articles/page/2/;
  - the article /parshas-toldos-nov-5-6-2021/.
- **Kept written out:**
  - Events messages and no-JS lines;
  - forms' "temporarily unavailable" messages;
  - the Donate notice;
  - /contact/ `og:description`, exactly as it is.
- **The old number "(+972) 54-671-3013"** leaves every visible place. It stays only in /contact/'s `og:description`
  (owner: "leave as is").
- **No buttons unless the forms are on.** That means `apiBaseUrl && turnstileSiteKey` at build time. A rendered button
  carries `hidden` until the enhancer is ready, so there is no button without JavaScript (Ruling R13).
- **Worker:**
  - secret `CONTACT_PHONE` in E.164 (`^\+1\d{10}$`), added to `secrets.required`;
  - var `PUBLIC_CONTACT_EMAIL` = `tzionbreslovproject@gmail.com`;
  - Turnstile action `contact-details`;
  - rate limit `rateLimitValue(env, "contact-details", "ip", ip, 10)` (600 s window);
  - no request_log row;
  - success is HTTP 200.
- **Browser cache:** `sessionStorage` key `tz:contact-details`. Every read and write is in try/catch.
- **Turnstile:** `size: "compact"` for the reveal, mounted in a slot right after the tapped button.
- **The privacy edits are the design's 1–6, verbatim.** "Last updated" becomes the date the PR is opened, written like
  "November 9, 2026".
- Imported HTML is edited at render time with `replaceOnce` and its loud markers, never in `content/`.
  `tests/wording/checkpoint-001*.json` are never edited.
- One PR, an independent review, green CI. Opus only. Never `wrangler deploy` or anything remote.

## Review Focus
1. `sessionStorage` throws or is unavailable (private mode or blocked storage). The reveal still fills the page, with
   no error. **Owner: Task 5.**
2. Turnstile never yields a token, or its script fails to load. The button comes back with the failed message, never
   stuck on "Checking…". **Owner: Task 5.**
3. A double tap, or a tap on a second "Show" while one check runs, makes exactly one POST and mounts one widget.
   **Owner: Task 5.**
4. A corrupt or old-shaped `tz:contact-details` value is ignored. The page stays covered and the buttons still work.
   **Owner: Task 5.**
5. A malformed API answer (or a 503 from a misconfigured `CONTACT_PHONE`) shows the failed message and stores nothing.
   Values are inserted only as text and as validated `href`s. **Owner: Task 5 (client), Task 2 (Worker 503).**

---

### Task 1: Record the plan (docs)

The spec and the owner's decisions are already on `main`, recorded by the controller's docs PR before this one:
`docs/superpowers/specs/2026-11-08-hidden-contact-details-design.md` and PROJECT_MEMORY.md → "Decisions
(owner-confirmed)".

**Files:**
- Create: `docs/superpowers/plans/2026-11-09-hidden-contact-details.md` (this plan, verbatim)

- [ ] **Step 1:** Copy the plan. Run the STOP grep on the staged diff; it must find nothing. Commit "Docs: hidden
  contact details implementation plan".

### Task 2: Worker endpoint `POST /v1/contact-details`

**Files:**
- Modify: `lib/api-contract.ts`:
  - `API_PATHS.contactDetails = "/v1/contact-details"`;
  - `TURNSTILE_ACTIONS.contactDetails = "contact-details"`;
  - the types below;
  - the header doc.
- Create: `worker/src/contact-details.ts`
- Modify: `worker/src/validation.ts`, `worker/src/index.ts` (`publicPostRoutes`, dispatch), `worker/src/types.ts`
  (`Env`), `wrangler.jsonc` (var, `secrets.required`), `vitest.worker.config.mts` (bindings), `.dev.vars.example`
- Test: `worker/test/worker.test.ts`

**Interfaces:**
- Produces:
  ```ts
  // lib/api-contract.ts
  export type ContactDetailsRequest = { requestId: string; "cf-turnstile-response": string };
  export type ContactDetailsSuccessResponse = { ok: true; phone: { display: string; tel: string }; whatsapp: string; email: string };
  // worker/src/contact-details.ts
  export function contactDetailsFrom(env: Env): ContactDetailsSuccessResponse; // throws PublicError("SERVICE_NOT_CONFIGURED")
  export async function handleContactDetails(request: Request, env: Env, origin: string): Promise<Response>;
  // worker/src/validation.ts
  export function validateContactDetails(body: JsonRecord): ContactDetailsRequest;
  ```
- `contactDetailsFrom` with `CONTACT_PHONE = "+15555550123"` and `PUBLIC_CONTACT_EMAIL = "tzionbreslovproject@gmail.com"`
  returns `{ ok: true, phone: { display: "(+1) 555-555-0123", tel: "+15555550123" }, whatsapp:
  "https://wa.me/15555550123", email: "tzionbreslovproject@gmail.com" }`.

- [ ] **Step 1: Write the failing tests** in a new `describe("contact details")`. Use `publicRequest` and
  `mockProviders("contact-details")` from the existing helpers, and add the path to the origin and preflight loops (:312,
  :346).
  - The success case: 200, the exact body above, `Cache-Control: no-store`, `count("request_log") === 0`, and one
    `rate_limits` row `LIKE 'contact-details:ip:%'`.
  - `mockProviders("contact")` (wrong action) → 400 `BOT_CHALLENGE_FAILED`.
  - siteverify `{success:false}` → 400 `BOT_CHALLENGE_FAILED`.
  - The 11th call from one IP inside the window → 429 `RATE_LIMITED`.
  - A missing token → 400 `INVALID_INPUT`, field `cf-turnstile-response`.
  - A bad `requestId` → 400 `INVALID_INPUT`.
  - `CONTACT_PHONE` blank, or `"+972546713013"` → 503 `SERVICE_NOT_CONFIGURED`, and the body holds no phone digits.
  - An unknown origin → 403.
- [ ] **Step 2:** Run `npm run test:worker`. The new tests fail (404, or unknown path).
- [ ] **Step 3: Implement.**
  - `validateContactDetails` accepts only `requestId` (UUID) and the token (1–2048 characters, single line). There is
    no honeypot or timing check: a tap can come early.
  - Handler order:
    1. `readJson`;
    2. validate;
    3. the IP rate limit (10);
    4. `validateTurnstile(env, token, ip, requestId, TURNSTILE_ACTIONS.contactDetails)`;
    5. `json(contactDetailsFrom(env), 200, origin)`.
  - `contactDetailsFrom` reads through `requireBinding`, checks `^\+1\d{10}$`, and formats `(+1) AAA-BBB-CCCC`.
  - Add `CONTACT_PHONE` and `PUBLIC_CONTACT_EMAIL` to `Env`. Add the var to `wrangler.jsonc`, the secret to
    `secrets.required`, and `CONTACT_PHONE: "+15555550123"` to the vitest bindings and `.dev.vars.example`.
- [ ] **Step 4:** Run `npm run test:worker` and `npm run typecheck:worker`. All green.
- [ ] **Step 5:** Commit "Worker: POST /v1/contact-details behind Turnstile (not deployed)".

### Task 3: Covered slots and the render-time edits

**Files:**
- Create: `lib/contact-details.mjs` + `lib/contact-details.d.mts`
- Modify: `lib/client/config.ts` (export `formsEnabled(): boolean` = `Boolean(apiBaseUrl && turnstileSiteKey)`)
- Modify: `components/site-document.tsx`:
  - :97 chain `editFooterContact` after `editFooterCredit`;
  - :91 apply `editContactCards` on /contact/ and `editArticleEmail` on /parshas-toldos-nov-5-6-2021/.
- Modify: `lib/pages/parts.ts` `closingSections()` (apply `editSpeakingEmail`)
- Modify: `content/copy/en.json`:
  - a new section `contactDetails` with the owner-approved strings (keys `showNumber`, `showNumberLabel`, `showEmail`,
    `showEmailLabel`, `checking`, `failed`, `rateLimited`, `whatsapp`);
  - privacy `sections[5].paragraphs[1]` uses `{email}` in place of the address.
- Modify: `lib/pages/privacy.ts` (render `{email}` as `emailSlot({ variant: "inline" })`; keep the generic mailto regex
  for any other address)
- Modify: `app/navigation.css:152` (hook the column on `[data-tz-contact]`, not `a[href^="mailto:"]`); styles for the
  slots in `app/enhancements.css`
- Test: `scripts/contact-details.test.mjs`

**Interfaces:**
- Produces (lib/contact-details.mjs):
  ```ts
  export const COVERED_PHONE = "(+1) 347-•••-••••";
  export function coveredEmail(lead?: "tzion" | "Tzion"): string; // `${lead}••••••@gmail.com`
  export type SlotVariant = "footer" | "card" | "inline";
  export function phoneSlot(o: { formsOn: boolean; variant: "footer" | "card" }): string;
  export function emailSlot(o: { formsOn: boolean; variant: SlotVariant; lead?: "tzion" | "Tzion" }): string;
  export function editFooterContact(html: string, o: { formsOn: boolean }): string;
  export function editContactCards(main: string, o: { formsOn: boolean }): string;
  export function editSpeakingEmail(html: string, o: { formsOn: boolean }): string;
  export function editArticleEmail(main: string, o: { formsOn: boolean }): string;
  ```
- **The slot markup contract** (Task 5 depends on it):
  - **The wrapper:** `<span class="tz-contact tz-contact--{variant}" data-tz-contact="phone|email">`.
  - **The value:** `<span class="tz-contact__value" aria-live="polite">{covered}</span>`.
  - **Only when `formsOn`:**
    - `<button type="button" class="tz-contact__show" data-tz-reveal hidden aria-label="{label}">{text}</button>`;
    - `<span class="tz-contact__check" data-tz-reveal-slot></span>`;
    - `<span class="tz-contact__message" role="alert"></span>`.
- **Imported HTML stays as it is.** Each edit replaces only the address or number text node (and its mailto `<a>`)
  inside the existing paragraph. Classes, styles and the surrounding text don't change. The footer marker allows any
  `wp-elements-N`.

- [ ] **Step 1: Write the failing unit tests** (pattern: `scripts/owner-edits.test.mjs`).
  - Across all 5 footer variants: no `mailto:`, no `54-671-3013`, one phone slot and one email slot each.
  - `formsOn:false` gives no `<button`.
  - `formsOn:true` gives exactly 2 buttons with the exact labels and names.
  - The Contact cards are edited the same way: card variant, both slots.
  - Speaking: `editSpeakingEmail(resourcesMain)` keeps "please email us at" and drops the mailto.
  - Article: "Please email us at " followed by the `Tzion` covered form.
  - Each edit throws on a missing, repeated or already-edited marker.
  - `coveredEmail()` and `COVERED_PHONE` equal the exact strings.
- [ ] **Step 2:** Run `node --test scripts/contact-details.test.mjs`. It fails because the module is missing.
- [ ] **Step 3:** Implement the module, wire the edits, add the copy, and add the privacy `{email}`. Add the CSS:
  - the value keeps today's colour, weight and size;
  - the footer email's `text-transform: lowercase` doesn't reach the button;
  - in the narrow footer column the pill may wrap below the value;
  - the button and icon hit areas are at least 24 × 24 px;
  - focus is visible.
- [ ] **Step 4:** Run `npm run test:unit`, `npm run typecheck` and `npm run build`. Then run
  `grep -rniE "54-671-3013|tzionbreslovproject@gmail\.com|mailto:|tel:|wa\.me" out/` and read every hit. Only the
  allowed places of Task 6 may remain.
- [ ] **Step 5:** Commit "Covered contact details in the footer, Contact cards, privacy notice, speaking paragraph and
  one article".

### Task 4: Privacy notice edits (owner-approved 1–5) and the date

**Files:**
- Modify: `content/copy/en.json` privacy:
  - `sections[0].paragraphs[3]`, `[1][1]`, `[2][1]` and `[3][3]`;
  - a new paragraph after `[4][1]`;
  - `date`.
- Test: `e2e/privacy.spec.ts`:
  - :38, the date;
  - :62-64, now the covered email in the last section with no mailto;
  - a new test asserting each edited sentence verbatim.

- [ ] **Step 1:** Write the e2e assertions with the design's "After" texts verbatim. Run
  `npx playwright test e2e/privacy.spec.ts`; it fails.
- [ ] **Step 2:** Apply the five texts and the date ("Last updated {date}" with today's date).
- [ ] **Step 3:** Re-run the spec; it passes. Commit "Privacy notice: the owner-approved contact-details edits".

### Task 5: Client enhancer

**Files:**
- Create: `lib/client/contact-details.ts`
- Modify: `lib/client/turnstile.ts` (an options param `{ size?: "flexible" | "compact" }`, default `"flexible"`),
  `components/enhancers.tsx` (call `enhanceContactDetails()` unconditionally, like `enhanceMenus`)
- Test: `e2e/contact-details.spec.ts`. Add it to the forms-on command at `.github/workflows/ci.yml:52`, gated by
  `TZ_E2E_EVENTS === "1"` for the forms-on tests.

**Interfaces:**
- Consumes: the slot contract (Task 3), `API_PATHS.contactDetails` and `ContactDetailsSuccessResponse` (Task 2),
  `mountTurnstile(container, siteKey, action, { size: "compact" })`, `submitPublicForm`.
- Produces:
  ```ts
  export function enhanceContactDetails(doc?: Document): void;
  export function readCachedDetails(): ContactDetailsSuccessResponse | null; // validates shape, never throws
  ```

**Behaviour:**
- **On load:** a valid cache fills every slot at once, with no buttons and no request. Otherwise, if the forms are on,
  unhide the buttons.
- **On a tap:**
  - disable every button, and put `checking` on the tapped one;
  - mount compact Turnstile in that button's `[data-tz-reveal-slot]`;
  - `token()`;
  - POST `{ requestId: crypto.randomUUID(), "cf-turnstile-response": token }`.
- **On 200 with a valid shape:**
  - fill every slot: the phone becomes `<a href="tel:{tel}">{display}</a>` plus the WhatsApp icon link
    (`href={whatsapp}`, `target="_blank"`, `rel="noopener noreferrer"`, `aria-label="WhatsApp"`, an inline SVG with
    `aria-hidden="true"`); the email becomes `<a href="mailto:{email}">{email}</a>`;
  - remove the buttons;
  - store the details.
- **Valid shape** means:
  - `tel` matches `^\+\d{8,15}$`;
  - `whatsapp` starts with `https://wa.me/` and is digits after that;
  - `email` matches a simple address pattern;
  - `display` is under 40 characters.

  Insert values with `textContent` and `setAttribute`. Never use `innerHTML`.
- **On `RATE_LIMITED`:** the `rateLimited` message.
- **On anything else** (a network error, `TURNSTILE_TIMEOUT`, a script load error, 4xx/5xx, a bad shape): the
  `failed` message in that slot's `role="alert"`, then reset Turnstile and re-enable the buttons.
- **The WhatsApp green:** `#25D366` in the footer variant; a darker green on the card variant that reaches ≥ 3:1
  against `#F2F9FF` (e.g. `#128C7E`).

- [ ] **Step 1: Write the failing e2e tests.** Reuse the Turnstile stub and the `cors` pattern from `e2e/rsvp.spec.ts`
  :40-62. Stub `${API}/v1/contact-details` with the fake details.
  - **Forms off (the default build):**
    - covered text in each place, with no visible button and no `mailto:`, `tel:` or `wa.me` there;
    - the same with JavaScript disabled.
  - **Forms on:**
    - a footer "Show number" tap reveals the footer phone, the WhatsApp link (href, target, rel and name) and the
      email, plus the page's other slots on /contact/;
    - the accessible names are exact;
    - a reload, and a new page, show the details with 0 POSTs;
    - Review Focus 1–5: setItem throws (`addInitScript`); a Turnstile stub whose `getResponse` returns `""` (use
      `test.slow()`); a double click gives `posts.length === 1`; a corrupt cache value; a 503 or a bad-shape answer
      gives the failed message and no cache;
    - `RATE_LIMITED` gives the rate message;
    - the keyboard: Tab to "Show email", then Enter, reveals.
- [ ] **Step 2:** Build the forms-on fixture as ci.yml:52 does, then run
  `TZ_E2E_EVENTS=1 npx playwright test e2e/contact-details.spec.ts`. It fails.
- [ ] **Step 3:** Implement the enhancer and the Turnstile size option.
- [ ] **Step 4:** Re-run the spec on both builds (forms off: `npm run build`; forms on: the fixture build). Both are
  green. Then run `node scripts/check-csp.mjs`.
- [ ] **Step 5:** Commit "Contact details: reveal after one Turnstile check, kept for the visit".

### Task 6: Guards, the wording allow-list and existing tests

**Files:**
- Modify: `scripts/lib/wording.mjs` (an entry may give per-route counts, `"counts": {"/contact/": 2}`, default 1; a
  mismatch fails), `scripts/wording.test.mjs`
- Modify: `tests/wording/owner-approved.json`. New entries:
  - the footer email node → `tzion••••••@gmail.com`, on every baseline route, `/contact/` count 2;
  - `(+972) 54-671-3013` → `(+1) 347-•••-••••`, likewise;
  - the article's node "Please email us at TzionBreslovProject@gmail.com." → its first new node as built.

  `owner` holds the owner's own words with the number withheld ("we want to avoid spam calls, e-mails, and whatsapp
  messages, while still making it obvious that the number is available to the elderly human."). The controller's
  summary of the answers is labelled as such.
- Modify: `scripts/lib/export-guard.mjs` + `scripts/check-static-export.mjs`. Add
  `contactDetailsProblems(route: string, text: string): string[]`:
  - It scans each route's `index.html` and every `.txt` beside it, case-insensitively, for `54-671-3013`, `mailto:`,
    `tel:`, `wa.me`, `api.whatsapp.com` and `tzionbreslovproject@gmail.com`.
  - **Allowed:**
    - /contact/'s exact `og:description` value (head and `.txt`);
    - the Events page's cards and noscript lines (`withoutEventCards`, plus the announcements noscript);
    - the kept form messages, which live in JS chunks, not scanned.
  - Unit tests in `scripts/export-guard.test.mjs` cover a covered page passing, each pattern failing, and the
    og:description exception passing only on /contact/.
- Modify: `e2e/navigation.spec.ts:461,468,486` (find the column by `[data-tz-contact="email"]` and the phone line by
  `[data-tz-contact="phone"] .tz-contact__value`; `phoneLines: 1` stays, on the value), `e2e/contact.spec.ts:8,46`
  (CARDS become the covered forms), `scripts/check-static-export.mjs:87-102` if it names the card text.

- [ ] **Step 1:** Write the failing tests: wording counts, the guard function, and the updated e2e expectations. Run
  them; they fail where they should.
- [ ] **Step 2:** Implement. Run `npm run check`, and the forms-on fixture command from ci.yml:52, with the new spec
  added. Both are green.
- [ ] **Step 3:** Commit "Checks: wording allow-list counts, exported contact-details guard, tests follow the covered
  details".

### Task 7: Runbook, docs and the visual gate

**Files:**
- Modify: `README.md`:
  - **Switch day, step 3:** `npx wrangler secret put CONTACT_PHONE`. The owner types the number at the prompt; it goes
    into `.env.worker` only, which is git-ignored, and the TURNSTILE caveat stays. Verify "ten names". Its undo.
  - **Step 1.1:** "eight variables".
  - **Step 4 smoke:** a preflight `curl` on `/v1/contact-details` (204), and a POST with no token → 400
    `INVALID_INPUT`.
  - **Step 11:** on tzionbreslov.org, "Show number" reveals the owner's number and WhatsApp.
  - **The Launch checklist:** the secret count.
  - The wording section names the new allow-list entries.
- Modify: `PROJECT_MEMORY.md` Status (one entry), `docs/superpowers/follow-ups.md` (only for anything left).
- Screenshots: `.superpowers/sdd/2026-11-08-hidden-contact/screens/`.

- [ ] **Step 1:** Update the docs.
- [ ] **Step 2: The visual gate** against a main build at 1440 and 390, masked/cropped as e1 did. Only the covered
  places differ: the footer contact column, the Contact cards, the speaking paragraph, the article paragraph and the
  privacy notice. Save main and branch screenshots of each, covered and revealed (forms-on build, stubbed), including
  keyboard focus.
- [ ] **Step 3:** Run `npm run check` and `node scripts/check-csp.mjs`, and the STOP grep on `main..HEAD` and the PR
  body. Push, open the PR, and wait for CI (`gh pr checks <n> --watch --interval 30`).
- [ ] **Step 4:** Commit "Docs: switch-day step for the contact-details secret".

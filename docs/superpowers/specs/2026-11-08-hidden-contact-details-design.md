# Hidden contact details: design (2026-11-08)

Status: **approved by the owner on 2026-11-09** ("approve and record choices"), including the proposed wording and
the privacy edits. Implementation plan: `docs/superpowers/plans/2026-11-09-hidden-contact-details.md` (added with the
implementation pull request).

**This document must never contain the new phone number.** The repository is public, and the owner chose to keep the
number out of GitHub.

## Why
The owner, 2026-11-08: "we want to avoid spam calls, e-mails, and whatsapp messages, while still making it obvious
that the number is available to the elderly human." And earlier: the check "should be challenging enough that a bot
can't figure it out. this would apply to the whatsapp icon as well and the email address."

The site's phone number, WhatsApp link and email address are harvested by bots that read web pages. The owner wants
a person, including an older visitor, to see at a glance that a real number and email exist and get them with one
tap, while a bot reading the site gets nothing usable.

The owner also asked (2026-11-08) for a **new phone number**, which also has WhatsApp, to replace "(+972)
54-671-3013". That change ships with this feature. The number is never in the public code, only in the forms
service's private settings.

## Goals
1. The real phone number, the WhatsApp link and the email address are in no file the site serves for the places in
   scope: HTML, scripts, JSON, flight data, CSS, sitemap, structured data. The exceptions are the sentences kept
   written out (see "Where"). Scripts are narrowed further under "Found while planning".
2. One tap on any "Show" button runs one human check. When it passes, **all** the details on the page appear at
   once: the phone (tap to call), the WhatsApp icon (opens a chat) and the email (tap to write). Owner: "when one is
   virified [sic], they all show."
3. The check is Cloudflare Turnstile, verified by the forms service (the Worker) on the server. It is usually
   invisible, at most a "Verify you are human" box to tick, and never a puzzle.
4. It works for older visitors: the covered details still look like a phone number and an email, the buttons are
   big and clear, and keyboards and screen readers work.
5. New phone number: the owner's format is "(+1) XXX-XXX-XXXX" (the site's "(+972) …" style). Tapping it calls;
   a small green WhatsApp icon next to it opens a WhatsApp chat with the same number (owner, 2026-11-08).

## Non-goals
- Protecting the email inside the sentences the owner chose to keep written out. Bots can still find the email
  there; the owner accepted this.
- Stopping a person from copying the details after revealing them.
- Removing the old details from search engines' copies of the WordPress site, from the public repository's history
  (the email is already there), or from emails the forms service sends.
- The Home page's "Whatsapp groups" section. It holds no number or link today.

## Anti-goals (a failure even if it works)
- A puzzle CAPTCHA, or any step an older visitor can't get past.
- A "Show" button that looks usable but does nothing (Ruling R13).
- Any claim in the privacy notice becoming false.
- The new number in any commit, file, PR or test fixture.

## What the visitor sees (owner's choice: Option A)
The mockup the owner chose from on 2026-11-08 was a local browser page and isn't committed. Option A is described
here.
- **Covered:** the phone shows its country and area code with the rest dotted, "(+1) 347-•••-••••". The email shows
  its start and domain, "tzion••••••@gmail.com". A "Show" button sits next to each.
- **Footer (every page):** the "contact" column has the covered email with "Show email" and the covered phone with
  "Show number", as in the mockup (white outline pills on the dark blue).
- **Contact page:** the phone card and the email card each show the covered detail with a solid dark-blue "Show"
  button under it.
- **Privacy notice:** "…write to tzion••••••@gmail.com" with a small inline "Show email" button.
- **After the check:** every covered detail on the page is replaced by the real one:
  - the phone as a `tel:` link, followed by the WhatsApp icon link;
  - the email as a `mailto:` link.
  
  Each looks like today's plain text in its place: same colour, weight and size, no underline. Each has a visible
  keyboard focus ring.
- **For the rest of the visit:** the browser keeps the revealed details in `sessionStorage`, cleared when the tab
  closes, so every later page shows them at once without another check. The owner approved this.

## Where
- **Hidden** (owner):
  - the footer of every page: email, and phone with WhatsApp;
  - the Contact page: the phone card and the email card;
  - the privacy notice's "write to …" sentence;
  - the "Live Speaking Engagements" paragraph that closes /classes/, /articles/ and /articles/page/2/
    (`closingSections()` in `lib/pages/parts.ts`): "…please email us at tzion••••••@gmail.com" with an inline "Show
    email" button, as in the privacy notice (owner, 2026-11-09);
  - the article /parshas-toldos-nov-5-6-2021/: "Please email us at Tzion••••••@gmail.com" with "Show email" (owner,
    2026-11-09).
- **Kept written out:**
  - the Events messages: `rsvp.placesLeft`, `rsvp.placeLeft`, `rsvp.unavailable`, `rsvp.noScript`,
    `announcements.noScript` (owner, 2026-11-08);
  - the forms' "temporarily unavailable" messages (`lib/client/forms.ts`, `lib/client/subscription-confirm.ts`)
    (owner, 2026-11-08);
  - the Donate page's "Online checkout is being upgraded… email us at …" notice (`components/donate-form.tsx`). It
    is a status message like the forms' ones (controller's call, matching the owner's choice for those).
  - **The Contact page's link-preview text** (`og:description` in `content/pages/contact.json`: "Questions? Comments?
    Try Us! (+972) 54-671-3013 tzionbreslovproject@gmail.com Beit Shemesh, Israel"). The owner said "leave as is"
    (2026-11-09), so it keeps the old number and the email. The `out/` guard needs an explicit exception for this
    one tag. It must match the tag as built, not this quote: the source has a non-breaking space before "Beit".
- The builder confirms that nothing else shows the phone or the email. A builder check found the speaking paragraph,
  the Donate notice and the `og:description`; the guard must search for the plain text as well as links.

## How the check works (controller's design; the builder may refine within it)
1. **The tap.** The visitor taps "Show". The page runs Turnstile with the site's existing key, its own `action`
   (e.g. `contact-details`) and the existing interaction-only setup (`lib/client/turnstile.ts`).
   - The button shows a "Checking…" state.
   - If Turnstile needs the visitor, its box appears next to that button.
2. **The token goes to the Worker** at a new endpoint, `POST /v1/contact-details` (`lib/api-contract.ts`). It uses
   the same origin checks and CORS as the forms.
3. **The Worker verifies the token** with Turnstile, checking the action and hostname as the forms do, and applies
   a per-visitor rate limit using the existing hashed-IP buckets (the limit is the builder's call).
   - It answers with the details, `Cache-Control: no-store`.
   - It never logs them.
4. **The details live only in the Worker's configuration.**
   - The phone number is a Worker **secret** (new number; never in the repo).
   - The email may be a plain variable, since it's already public in the repo.
   - The Worker derives the display text, the `tel:` value and the `wa.me` link from the phone number, or takes
     them as separate secrets (the builder's call).
5. **The page fills in every covered detail** at once, saves them to `sessionStorage`, and announces the change to
   screen readers through a polite live region.

## States (controller's calls)
- **Forms off (the preview before switch day):** the covered details show without "Show" buttons (R13). Nothing can
  be revealed, and no new text is shown.
- **No JavaScript:** the same, covered details with no buttons. The Events no-JS lines still name the email (kept
  by the owner).
- **The check fails, or the Worker can't be reached:** the button comes back with a short message near it, and the
  visitor can try again.
- **Rate-limited:** a short "try again in a minute" message.
- **Existing wording:** reuse any existing form message that says the same thing (owner rule). The new text is
  listed below.

## New wording (approved by the owner on 2026-11-09)
- **Buttons:** "Show number" and "Show email".
  - Their accessible names begin with the visible label, so voice control works (WCAG 2.5.3): "Show number (phone
    and WhatsApp)" and "Show email address".
- **While checking:** "Checking…".
- **If the check fails:** "We couldn't check that you're a person. Please try again."
- **If rate-limited:** "Too many tries. Please wait a minute and try again."
- **The WhatsApp icon's accessible name:** "WhatsApp".

## Privacy notice edits (approved by the owner on 2026-11-09)
These edits are approved. The privacy notice as a whole, with its "Last updated" date, is still open owner decision
1 in PROJECT_MEMORY.md, to be approved before launch.

The reveal sends the visitor's IP address to the forms service and Turnstile. It keeps the same short-lived,
scrambled rate-limit records the forms keep, and nothing else. It writes **no** request-log row (controller's call),
so the "log of contact and sign-up requests" stays accurate. The browser keeps the revealed details for the tab.
Proposed edits, before → after:

1. **What you send us.**
   - Before: "Our forms service also receives your IP address with every form you send, when you open the link in a
     confirmation email and confirm your sign-up, and when you open the Events page while it lists events, because
     your browser then asks it which events are full."
   - After: "…when you open the Events page while it lists events, because your browser then asks it which events
     are full, and when you tap "Show" next to our phone number or email address."
2. **How we use it.**
   - Before: "We also use it to protect the forms from spam and abuse. Cloudflare Turnstile checks that a person, not
     a program, is sending a form, and our forms service passes your IP address to it for that check. To limit
     repeated submissions, the forms service keeps short-lived records of your IP address and email address in
     scrambled (salted and hashed) form."
   - After: "We also use it to protect the forms, and our phone number and email address, from spam and abuse.
     Cloudflare Turnstile checks that a person, not a program, is sending a form or asking to see them, and our forms
     service passes your IP address to it for that check. To limit repeated submissions and requests, the forms
     service keeps short-lived records of your IP address (and, for forms, your email address) in scrambled (salted
     and hashed) form."
3. **Where it goes.**
   - Before: "Cloudflare Turnstile, which protects the forms, loads on every page, because every page has the
     newsletter sign-up in its footer."
   - After: "Cloudflare Turnstile, which protects the forms and our contact details, loads on every page, because
     every page has the newsletter sign-up and our contact details in its footer."
4. **How long we keep it** (Security records).
   - Before: "…the scrambled records that limit repeated submissions until the next daily clean-up, at most about a
     day…"
   - After: "…the scrambled records that limit repeated submissions and requests to see our contact details until
     the next daily clean-up, at most about a day…"
5. **Cookies and tracking:** one new sentence after the paragraph about services that store information in your
   browser.
   - "When you tap "Show" next to our phone number or email address, your browser keeps them for that tab until you
     close it, so the next pages you open show them too."
6. **Your choices:** "write to tzionbreslovproject@gmail.com" becomes the covered address with "Show email" (the
   hiding itself).
- The notice's "Last updated" date changes to the day these edits ship. The owner approves the final date with the
  text.
- The builder must keep every edit's claim true for the code as built. If the code needs a claim these don't make,
  stop and bring it back to the owner.

## Switch day
- The Worker change ships with the RSVP release at switch day, step 4 (owner go-ahead).
- A new secret holds the phone number. The README's switch-day runbook gets the step to set it, its undo, and two
  checks:
  - at step 4, that the endpoint answers;
  - at step 11, once the forms are on, that the reveal returns the details on tzionbreslov.org.
- The owner gives the number privately at that point. It goes only into `.env.worker` (git-ignored) or straight into
  `wrangler secret put`.
- Until then the site shows the covered new number. With this change the old number "(+972) 54-671-3013" leaves
  every page's visible text (owner: replace it). It stays only in the Contact page's link-preview text, which the owner
  said to "leave as is".

## Constraints
- **Public repository:** the new number never appears in any commit, file, PR title, body or comment, test fixture
  or doc.
  - Tests use a fake number (e.g. a 555-01xx number).
  - Before every push and PR, a grep proves the real number is absent (the controller supplies the pattern
    privately).
- **Owner wording rule:** text changes only as approved here, through the narrow owner-approved allow-list
  `tests/wording/owner-approved.json` (README → Wording check). `tests/wording/checkpoint-001.json` is never touched.
- **Privacy notice:** the edits above are approved. The whole notice is still open owner decision 1.
- **CSP:** Turnstile and the API are already allowed. `tel:`, `mailto:` and `wa.me` are links, not loaded resources.
  `node scripts/check-csp.mjs` stays green.
- **Accessibility:**
  - buttons and icon links have a hit area of at least 24 × 24 px (WCAG 2.5.8);
  - focus is visible;
  - the reveal is announced to screen readers;
  - the WhatsApp icon has 3:1 contrast on its background (WCAG 1.4.11).
- **One PR with an independent review,** and green CI.
- Imported pages (footer, Contact) are changed at render time, not in `content/`, with loud marker checks.

## Decided by the owner
- **The look:** Option A, partly covered with "Show" buttons.
- **Reveal all at once:** "when one is virified [sic], they all show".
- **Where it's hidden:**
  - the footer, the Contact page and the privacy notice (2026-11-08);
  - the speaking paragraph on Classes and Articles (2026-11-09);
  - the article "Parshas Toldos" (/parshas-toldos-nov-5-6-2021/): its "Please email us at
    TzionBreslovProject@gmail.com." is covered the same way, as "Tzion••••••@gmail.com" with "Show email"
    (2026-11-09).
- **Kept written out:** the Events and form messages keep the email (2026-11-08). The Contact page's link-preview
  text: "leave as is" (2026-11-09).
- **The new phone number:** "(+1) …" format, tap to call plus a WhatsApp icon. "Keep it out of GitHub" (2026-11-08).
  Storing it only in the Worker's private settings is how the design meets that.
- **Privacy notice:** the controller may propose edits to existing sentences. They were approved together with the
  new wording (2026-11-09).
- **Approved with the design (2026-11-09):** the controller's proposals below, and keeping the details shown for the
  visit. The owner answered "approve" to that playback on 2026-11-08.

## Controller's calls (the owner can overrule)
- **Turnstile through the existing Worker,** rather than any client-only trick, since only a server check stops a
  bot.
- **The covered formats:** "(+1) 347-•••-••••" and "tzion••••••@gmail.com".
- **No buttons** when the forms are off or without JavaScript (the states above).
- **`sessionStorage`, not `localStorage`:** cleared when the tab closes.
- **The Donate notice keeps the email written out,** like the forms' status messages.
- **The reveal writes no request-log row,** only the rate-limit records.
- **Accessible names begin with the visible label** (WCAG 2.5.3).
- **The WhatsApp icon:** its green may be darker on the Contact page's light card to reach 3:1 contrast (WhatsApp's
  own green is about 1.9:1 there).
- **Turnstile's box uses the compact size** (150 px wide). The default flexible box needs at least 300 px, and the
  footer's contact column can be about 185 px wide.

## Found while planning (2026-11-09; they refine the design, they don't change what the owner approved)
- **The email stays in the site's JavaScript.** The site bundles all of `content/copy/en.json` into its scripts, and
  the Events sentences the owner kept hold the email. So Goal 1 is about the page files: HTML and flight data. The
  email remains findable in the script files, as the owner accepted for the kept sentences. The phone number is never
  in the site's files at all.
- **The wording check doesn't cover every page.** It reads only the pages that existed at checkpoint-001. It covers
  the footer and the Contact cards (through the owner-approved list), but not /privacy/, /classes/ or /articles/; their
  tests hold those texts.
- **The live check of the reveal waits for step 11 on switch day.** A real reveal works only on tzionbreslov.org with the forms on
  (switch day, step 10). Step 4 can only check that the endpoint answers; the real check is step 11.

## Left to the builder
- The endpoint's exact request and response shape, the rate-limit numbers, and how the phone secret is split.
- The client module's structure: one module for every "Show" button on the page.
- The guard that proves the export holds no `tel:` / `wa.me` / `mailto:` for the hidden places. It runs on the
  built `out/`.

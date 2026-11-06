# Connecting Instagram to the Resources tab

The Resources page has an **Instagram** tab. Until the account is connected it shows the profile and a link to
Instagram. Once connected, every deploy (and a daily rebuild) copies the latest posts and photos onto the site with
`npm run sync:instagram` — visitors' browsers never contact Instagram, so no cookies and no CSP changes.

It uses Meta's **official** Instagram API (free). This is a one-time setup, ~15 minutes, done by whoever holds the
Instagram login. Meta changes these screens often; if a step looks different, follow the closest equivalent and note
it here.

## 0. Before you start

- **Account type.** Instagram app → profile → ☰ → *Settings and activity* → *Account type and tools*. It must be
  **Business** or **Creator**. If it says Personal, switch to Business (free, reversible; category "Nonprofit
  organization" fits). Personal accounts cannot be read by any official API.
- **Is it still posted to?** The tab shows the newest posts first. If the newest post is years old, decide whether the
  tab should stay (an old feed can look abandoned).
- You need a **Facebook** login to manage the Meta app (Meta's developer tools have no other login).

## 1. Recommended: "Instagram API with Unified Login" (token that does not expire)

1. Register as a Meta developer: <https://developers.facebook.com/async/registration> (phone + email verification).
2. Create (or reuse) a free **business portfolio** at <https://business.facebook.com>. Business Verification is *not*
   needed. Add the Instagram account to it: Business settings → *Accounts* → *Instagram accounts* → Add.
3. At <https://developers.facebook.com/apps> → *Create app* → type **Business**, owned by that portfolio → add the use
   case **"Manage messaging & content on Instagram"**. Leave the app in **Development** mode. Do **not** switch it to
   Live and do **not** submit App Review — reading your own account needs neither.
4. Open **API setup with Unified login** → create a configuration:
   - Remove every permission that can be removed. Keep `instagram_basic` (and `instagram_manage_messages`, which Meta
     always includes). If the next steps fail with error *100/33*, add `business_management`.
   - Token: choose the option that **never expires** if offered.
   - Redirect URL: `https://tzionbreslov.org/`. If a webhook URL is mandatory, ask the developer (it may need a small
     route on the forms Worker).
5. *Generate access tokens* → *Add account* → invite **@tzionbreslovproject** as an Instagram tester. Then, on
   instagram.com in a browser: *Settings* → *Website permissions* → *Apps and websites* → *Tester invites* → Accept.
6. Click **Generate token** and log in. The token is shown **once**. Put it straight into GitHub — never in chat, email
   or a file in the repo:
   - repo → *Settings* → *Secrets and variables* → *Actions* → **New repository secret** →
     name `INSTAGRAM_ACCESS_TOKEN`, value: the token; or
   - in a terminal: `gh secret set INSTAGRAM_ACCESS_TOKEN --repo tzionbreslov/Tzion-Breslov-Project` and paste when asked.
7. Tell the developer it's done. They will look up the numeric account id
   (`GET https://graph.facebook.com/<version>/me/assigned_instagram_accounts?fields=id,username`), save it as the
   repository **variable** `INSTAGRAM_USER_ID`, set `INSTAGRAM_API_VERSION` to the version your dashboard shows
   (e.g. `v27.0`), and make one test call to confirm captions come back.

## 2. Fallback: "Instagram API with Facebook Login" (Page token, does not expire)

Use this if step 1 offers no non-expiring token, or posts come back without captions.

1. Link the Instagram account to a Facebook **Page** you administer (Instagram → *Settings* → *Accounts Center*, or the
   Page's settings → *Linked accounts*).
2. The developer creates a long-lived **Page** access token with `instagram_basic`, `pages_show_list` and
   `pages_read_engagement` (plus `business_management` if the Page is managed through a business portfolio): long-lived
   user token → `GET /me/accounts` → the Page's token → `GET /<page-id>?fields=instagram_business_account` for the id.
3. Store it exactly as in step 1.6–1.7 (same secret and variables).

## 3. Last resort: "Instagram API with Instagram Login" (60-day token)

Meta says new apps can't use this; only if the dashboard still offers it and 1–2 failed. Set the variable
`INSTAGRAM_API_HOST=graph.instagram.com`. Its token expires after 60 days, so it needs an automatic refresh on the forms
Worker — ask the developer before choosing this.

## When the token stops working

The deploy keeps the last good posts (cached between deploys) and adds **"Instagram token must be regenerated"** to the
deploy run's summary on GitHub. Typical causes: password/privacy changes, the account switched back to Personal or moved
to another portfolio, the app or Page link removed, permissions revoked. Fix: generate a new token (step 1.6 or 2.2)
and replace the `INSTAGRAM_ACCESS_TOKEN` secret. Nothing else changes.

Note: GitHub turns off scheduled workflows in public repos after 60 days without commits. If the daily rebuild stops,
any merged PR (or *Actions* → *Deploy GitHub Pages* → *Run workflow*) starts it again.

## For developers

- Script: `scripts/sync-instagram.mjs` (+ pure helpers `scripts/lib/instagram-feed.mjs`, tests
  `scripts/instagram-feed.test.mjs`, which also run the script end-to-end against a fake Graph API).
- Photos are converted to WebP (max 1080 × 1350, quality 80) into `public/media/instagram/<instagram id>.webp`;
  dimensions are measured from the files (the API returns none). Captions are rendered as text only.
- Outage or rate limit → warning, keep data. Dead token → error + step summary, keep data, deploy still succeeds.
  Malformed payload → fail. `-- --strict` makes everything fatal.
- To commit a snapshot (so even a fresh cache has posts): put the token in a git-ignored `.env.instagram`, run
  `node --env-file=.env.instagram scripts/sync-instagram.mjs --strict`, then open a PR with `content/instagram.json` and
  `public/media/instagram/`.
- Local design work without a token: `INSTAGRAM_DATA=scripts/fixtures/instagram.sample.json npm run dev`.

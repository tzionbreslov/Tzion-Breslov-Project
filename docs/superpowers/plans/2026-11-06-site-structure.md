# Site Structure (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give tzionbreslov.com's static copy the new structure — Home · About · Resources ▾ (Classes, Articles) · Events · Gallery · Contact — with Ruach Breslov's videos, gallery, events/RSVP, privacy and map features in Tzion's own look, the old pages removed and every link redone, without changing a word of existing text and with a rollback point after every change.

**Architecture:** New pages are composed in code from Tzion's own parts (the Resources page's head, scripts, header/footer, hero and closing sections), fully rendered into the static HTML, and made interactive by small vanilla client enhancers — the pattern Tzion already uses for its YouTube feed and Instagram viewer (no Radix/lucide). One structure module (`config/site-structure.mjs`) decides which routes exist, which are removed and how links are rewritten; Next, the sitemaps and every check script read it, so a WordPress re-import can't bring old pages back. One navigation module renders the desktop menu, mobile menu and footer Quick Links for every page from a single definition. Event data is fetched from Google Calendar at build time (never committed), published as `/events.json`, and read by the forms Worker to enforce RSVP rules.

**Tech Stack:** Next.js 16.4.5 static export, React 19.3, TypeScript 6, plain CSS (px units — the theme sets `html{font-size:62.5%}`), cheerio (scripts), Playwright 1.64 (e2e, new), node:test (pure modules), Cloudflare Worker + D1 + vitest (`@cloudflare/vitest-plugin`), Resend, ical.js 2.2.1 (new devDependency), sharp (gallery images).

**Spec:** `docs/superpowers/specs/2026-11-06-site-structure-design.md` (approved 2026-11-06, with the two owner rules). Research notes behind this plan: Ruach `components/{video-library,cinematic-gallery,contact-map}.tsx`, `scripts/lib/google-calendar.mjs`, `worker/src/{index,database,validation}.ts`; Tzion `content/fragments/*`, `content/pages/resources*.json`, `lib/client/{youtube,instagram,forms,turnstile}.ts`.

## Global Constraints

- **Owner rule 1 — no existing wording changes.** Every word on the site at `checkpoint-001` stays exactly as it is (headings, paragraphs, buttons, menu labels incl. "Taste A Class" (desktop) vs "Taste a Class" (mobile/footer), footer, article titles and their spellings, alt text, page titles). Relinked buttons keep their labels. Only the removed pages may lose text. `npm run check:wording` (Task 1) enforces it on every build.
- **Owner rule 2 — a checkpoint with every change.** One task = one branch = one pull request; never batch tasks. Every merge must produce the next `checkpoint-NNN` tag + Release (verify with `gh release view`). Branch names: `structure/NN-<slug>`.
- **New text lives only in `content/copy/en.json`** (one object per page/feature), so phase 2 can translate it. Never hard-code new user-visible English in components or CSS `content:`.
- **No live-service changes without the owner's go-ahead:** no `wrangler deploy`, no remote D1, no DNS / Cloudflare rule edits, no Resend topic creation. Build and test them; record the steps and their undo in the README switch-day section (Task 11).
- **No commits by bots to `main`; build-time data is never committed** (YouTube, calendar). Carry last-good data between builds in the Actions cache.
- **CSP:** every new third-party origin goes into `config/security-headers.mjs` first; `node scripts/check-csp.mjs` passes after `npm run build`. Drop origins no longer used.
- **Untouched pages stay pixel-identical:** `visual-diff --mask-nav` against the `checkpoint-001` build reports ≤0.05% on every page the task didn't intend to change.
- **Tzion look, not Ruach's:** Newsreader headings (`var(--font-secondary)`), Montserrat body (`var(--font-main)`), `--wp--preset--color--dark-blue` #1E61A1, `--turquoise` #70B9BC, `--light-blue` #F2F9FF, card radius `border-radius: 30px 30px 0 30px` (square bottom-right corner, exactly like the Contact page cards), shadow `3px 5px 15px #00000029`. All new classes are prefixed `tz-`. Every new `<button>` starts from `all: unset` (the theme turns bare buttons into black uppercase pills that jump on hover) and gets a visible `:focus-visible` outline. Overlays use `z-index: 100000` (header is 9999). Honour `prefers-reduced-motion`.
- **Parasha titles and spellings are never edited.**
- **Next.js 16:** read the relevant guide in `node_modules/next/dist/docs/` before using a Next API (AGENTS.md).
- **Forms stay off on the preview:** with `NEXT_PUBLIC_API_BASE_URL` / Turnstile key unset, RSVP and the announcements form show "temporarily unavailable — email us".
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; PR bodies end with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

## Review Focus

1. **Tablets in landscape (touch at ≥1280px):** the desktop menu shows, there is no hover, and a tap on "Resources" must open the dropdown, not navigate or do nothing. → Task 4 e2e at 1366×1024 with `hasTouch`.
2. **No JavaScript (blocked scripts, slow phones):** video cards must still lead to the video and the Resources dropdown must still be reachable. Cards are real links to YouTube, enhanced into the player; the dropdown opens with `:hover`/`:focus-within`. → Task 3 and Task 4 e2e with `javaScriptEnabled: false`.
3. **The github.io preview lives under `/Tzion-Breslov-Project`:** new pages, gallery images, `/events.json` and menu links must all carry the base path, and CI currently only builds without it. → Task 2 adds a CI build + export check with `NEXT_PUBLIC_BASE_PATH=/Tzion-Breslov-Project`.
4. **Event times across Israel's daylight-saving change and UTC-stamped events:** an event Google stores as `…Z` must show Israel time, including in the week the clocks change. → Task 7 calendar tests.
5. **How people actually type the calendar markers:** "rsvp limit: 40", "RSVP Limit:40", "No RSVP." with punctuation, a marker in the middle of a longer description, a limit of 0. → Task 7 marker tests (limit 0 or non-numbers are ignored = no cap, and the build logs a warning).

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `scripts/lib/wording.mjs`, `scripts/check-wording.mjs`, `tests/wording/checkpoint-001.json` | Text extraction, ordered-subsequence check, committed baseline | 1 |
| `playwright.config.ts`, `e2e/helpers.ts`, `e2e/*.spec.ts` | Browser tests against `out/` served with the enforced CSP | 1+ |
| `scripts/baseline-site.mjs` | Build any checkpoint into `.tmp/baseline/<tag>/out` for visual comparison | 1 |
| `config/site-structure.mjs` + `.d.mts` | Routes added/removed, link rewrites, removed sitemaps, Instagram switch | 2, 4+ |
| `lib/pages/compose.ts`, `lib/pages/parts.ts`, `lib/pages/registry.ts` | Build a `PageContent` for a new page from Tzion parts | 2 |
| `lib/pages/{articles,classes,gallery,events,privacy}.ts` | One builder per new page | 2, 3, 5, 7, 9 |
| `content/copy/en.json` | All new English text, one object per feature | 2+ |
| `lib/video-library.mjs` + `.d.mts`, `lib/client/video-library.ts`, `content/shorts.json` | Video library logic, enhancer, the 26 short clips | 3 |
| `lib/client/dialog.ts`, `app/dialog.css` | Shared accessible modal (player, gallery viewer, RSVP) | 3 |
| `lib/navigation.mjs` + `.d.mts`, `lib/client/menu.ts`, `app/navigation.css` | Menu definition/rendering, dropdown behaviour and look | 4 |
| `scripts/lib/gallery.mjs`, `public/media/gallery/*` | Gallery manifest from files on disk | 5 |
| `lib/pages/contact-map.ts` | Map section inserted into the Contact page | 6 |
| `scripts/lib/google-calendar.mjs`, `scripts/sync-events.mjs`, `lib/events.mjs` + `.d.mts`, `content/events.json` | Calendar → events catalog, event card rendering | 7 |
| `worker/migrations/0002_rsvps_and_topics.sql`, `worker/src/events.ts`, `lib/client/{rsvp,submit,announcements}.ts` | RSVP + availability + Event announcements | 8 |

---

### Task 1: Safety net — wording check, browser tests, checkpoint comparison

**Files:**
- Create: `scripts/lib/wording.mjs`, `scripts/check-wording.mjs`, `scripts/wording.test.mjs`, `tests/wording/checkpoint-001.json` (generated), `playwright.config.ts`, `e2e/helpers.ts`, `e2e/smoke.spec.ts`, `scripts/baseline-site.mjs`
- Modify: `scripts/visual-diff.mjs` (add `--mask-nav`), `package.json`, `.github/workflows/ci.yml`, `.gitignore` (`/test-results/`, `/playwright-report/`, `/.tmp/` if missing), `AGENTS.md` (visual-diff rule)

**Interfaces:**
- Produces: `extractWording(html: string): string[]` — ordered list: `title:<document title>`, then every non-empty visible text node of `<body>` in document order (whitespace collapsed, entities decoded, `<script>/<style>/<noscript>/<template>` skipped, hidden text included), and `alt:<value>` for each non-empty `img[alt]` at its position.
- Produces: `isOrderedSubsequence(baseline: string[], current: string[]): { ok: true } | { ok: false; index: number; expected: string; context: string[] }` — greedy in-order match; `index` is the first baseline entry not found after the previous match.
- Produces: e2e helpers in `e2e/helpers.ts` — `trackPageErrors(page: Page): () => Error[]` (collects `pageerror`s, ignoring those whose stack contains `/themes/tzionbreslov/js/global.js`, a pre-existing theme bug kept for fidelity), `cspViolations(page): Promise<string[]>`, and `expectClean(page, errors)` (no page errors, no CSP violations), which every spec calls at the end. The test server sends the enforced CSP, so every interaction test is also a CSP test.
- Produces: `node scripts/baseline-site.mjs <tag>` → `.tmp/baseline/<tag>/out` (git worktree at the tag, `npm ci`, `npm run build`).

- [ ] **Step 1: Write the failing unit tests** in `scripts/wording.test.mjs`:
  - `extractWording` on a fixture page with `<title>About - Tzion Breslov</title>`, `<p>Enrich <strong>your</strong> life</p>`, `<img alt="Rabbi">`, `<script>var x="no"</script>` returns `["title:About - Tzion Breslov","Enrich","your","life","alt:Rabbi"]`.
  - `isOrderedSubsequence(["About","Resources","Contact"], ["Home","About","Resources","Classes","Articles","Contact"])` → `{ ok: true }`.
  - Changed word: baseline `["Enrich your life"]` vs current `["Enrich your lives"]` → `ok:false, index:0`.
  - Reordered: `["About","Contact"]` vs `["Contact","About"]` → `ok:false, index:1`.
  - Missing label after relink: baseline `["Read my full story"]` vs `["Read more"]` → `ok:false`.
- [ ] **Step 2: Run** `node --test scripts/wording.test.mjs` — expect FAIL (module missing).
- [ ] **Step 3: Implement** `scripts/lib/wording.mjs` with cheerio (`decodeEntities` default), walking `body` children recursively.
- [ ] **Step 4: Run** the test — expect PASS.
- [ ] **Step 5: Implement** `scripts/check-wording.mjs`:
  - `--write-baseline <outDir>` writes `{ "<path>": string[] }` for every route in `content/routes.json` (+ `/404.html` as `"/404/"`).
  - Default mode reads `out/`, and for every baseline path not removed (`isRemovedPath` from Task 2 — until then, none) requires `out/<path>index.html` and `isOrderedSubsequence(baseline, current).ok`.
  - On failure it prints the path, the expected text and 5 entries of context, then exits 1.
- [ ] **Step 6: Implement `scripts/baseline-site.mjs`.** Reuse `.tmp/baseline/<tag>/out` if it already exists; add `--fresh` to rebuild. Then generate the baseline:
  `node scripts/baseline-site.mjs checkpoint-001 && node scripts/check-wording.mjs --write-baseline .tmp/baseline/checkpoint-001/out` → commit `tests/wording/checkpoint-001.json`.
- [ ] **Step 7: Prove the check bites.** Build, then hand-edit `out/about-us/index.html` to change "Enrich your life" → "Enrich your lives", then run `npm run check:wording`. Expected: FAIL naming `/about-us/` and `Enrich your life`. Rebuild and run again: PASS.
- [ ] **Step 8: Write `playwright.config.ts`.**
  - `testDir: "e2e"`; webServer `node scripts/serve-out.mjs out` with `SECURITY_HEADERS=1`, `PORT=3100`, `reuseExistingServer: !process.env.CI`.
  - `baseURL: http://localhost:3100`.
  - Projects: `desktop` (Chromium, 1440×900) and `mobile` (Chromium, Pixel 7).
  - `e2e/smoke.spec.ts`: for every route from `siteRoutes()` (Task 2; until then, `content/routes.json`), the page loads with status 200, `trackPageErrors` is empty and there are no CSP violations.
- [ ] **Step 9: Add `--mask-nav` to `scripts/visual-diff.mjs`.**
  - Before each screenshot on both sides, set `visibility:hidden` on `header.site-header, .mobile-menu-wrap, #genesis-footer-widgets`.
  - Clip both screenshots to the top of `#genesis-footer-widgets` on the reference page.
  - Keep current behaviour without the flag.
- [ ] **Step 10: Wire scripts.**
  - In `package.json`, add:
    - `"test:unit": "node --test \"scripts/**/*.test.mjs\""`
    - `"check:wording": "node scripts/check-wording.mjs"`
    - `"test:e2e": "playwright test"`
    - `"baseline": "node scripts/baseline-site.mjs"`
  - Remove the broken `test:visual`.
  - `check` becomes `typecheck && typecheck:worker && lint && test:unit && test:worker && build && check:static-export && check:wording && test:e2e`.
  - In `ci.yml`, add `npx playwright install --with-deps chromium` before `npm run check`.
  - In `AGENTS.md`, replace the visual-diff rule with: "For structure work, compare against the `checkpoint-001` build: `npm run baseline -- checkpoint-001`, serve it with `PORT=3201 node scripts/serve-out.mjs .tmp/baseline/checkpoint-001/out`, then run `REF=http://localhost:3201 node scripts/visual-diff.mjs --mask-nav`. Pages a task doesn't intend to change stay ≤0.05%."
- [ ] **Step 11: Verify.** Run `npm run check`. Expected: all green, including `check:wording` and the e2e smoke tests on both projects.
- [ ] **Step 12: Commit, open the PR, merge after "check" passes, verify the checkpoint.**
  ```bash
  git switch -c structure/01-safety-net && git add -A && git commit -m "Add the wording check, browser tests and checkpoint comparison"
  git push -u origin structure/01-safety-net && gh pr create --fill
  gh pr checks --watch && gh pr merge --squash --delete-branch
  gh release view checkpoint-004 --json name   # expected: "Checkpoint 004: Add the wording check…"
  ```
  (`checkpoint-003` is this plan's own PR. If numbering differs, check that the newest checkpoint names this PR.)

---

### Task 2: Structure layer, page composition, and the Articles page

**Files:**
- Create: `config/site-structure.mjs`, `config/site-structure.d.mts`, `scripts/structure.test.mjs`, `lib/pages/compose.ts`, `lib/pages/parts.ts`, `lib/pages/registry.ts`, `lib/pages/articles.ts`, `content/copy/en.json`, `e2e/articles.spec.ts`
- Modify: `lib/content.ts`, `scripts/{check-static-export,check-csp,write-site-files,visual-diff,compare-live,check-wording}.mjs` (route lists come from `siteRoutes`), `.github/workflows/ci.yml` (base-path build), `README.md` (How it works)

**Interfaces:**
- Produces (`config/site-structure.mjs`):
  - `type RouteIndex = { site: string; routes: { path: string; key: string }[]; redirects: Record<string, string> }`.
  - `NEW_ROUTES: { path: string; key: string }[]`. Composed-page keys start with `tz:`. This task adds `{path:"/articles/",key:"tz:articles"}` and `{path:"/articles/page/2/",key:"tz:articles__page__2"}`.
  - `REMOVED_PATHS: string[]` (empty until Task 4) and `isRemovedPath(path: string): boolean`.
  - `LINK_REWRITES: Record<string, string>` (empty until Task 4).
  - `REMOVED_SITEMAPS: string[]` (empty until Task 4).
  - `TEMPLATE_KEYS = ["resources", "resources__page__2"]`: page JSONs kept as sources, even after their routes are removed.
  - `INSTAGRAM_ENABLED = true` (false from Task 4).
  - `siteRoutes(index: RouteIndex, opts?: { removed?: string[]; newRoutes?: { path: string; key: string }[] }): RouteIndex`: routes.json routes minus removed, plus `NEW_ROUTES`, deduplicated by path; redirects whose source is removed are dropped; `opts` replaces the module lists (for tests).
- Produces (`lib/pages/compose.ts`): `type ComposedPageDef = { path: string; title: string; description: string; slug: string; main: string; islands: Island[] }` and `composePage(def: ComposedPageDef): PageContent`. It takes `resources.json`, then:
  - **head:** drops the `title`, `meta[name=description]`, `og:*` / `twitter:*`, `canonical`, `shortlink` and oEmbed `alternate` items and `jsonld`. It adds `<title>{title} - Tzion Breslov</title>`, the description, `canonical` = site URL + path, and `og:title` / `og:description` / `og:url` / `og:type=website` / `og:site_name=Tzion Breslov`.
  - **body:** `bodyClass` has `page-id-28` replaced by `page-id-tz-{slug}`. `bodyScripts` are kept minus `uag-script-28-js` (the tabs initialiser). `header`, `footer` and `skipLinks` are kept as they are.
- Produces (`lib/pages/parts.ts`), all cut verbatim from `content/pages/resources.json` / `resources__page__2.json`; each throws `Error("structure: marker not found: <name>")` when a marker is missing:
  - `resourcesHero(): string`: entry-content children 0–2 (hero cover, `svg-img arrow-svg` divider, small spacer).
  - `renderHero({ image, heading, subheading? }): string`: the same markup with the image `src` (no `srcset`), `<h2><strong>` heading and optional subheading swapped.
  - `closingSections(): string`: the `spacer-large-height` spacer through the end of `.entry-content` (Live Speaking Engagements + quote/donate group).
  - `articlesGrid(page: 1 | 2): string`: the `uagb-block-1908e9b6` grid, with pagination hrefs `/resources/` → `/articles/` and `/resources/page/2/` → `/articles/page/2/`.
  - `wrapEntry(ariaLabel: string, inner: string): string`: the Genesis `site-inner › wrap › content-sidebar-wrap › main#genesis-content › article.page.entry › div.entry-content` wrapper.
  - `sectionHeading(text: string): string`: `<h1 class="wp-block-heading has-text-align-center has-dark-blue-color has-text-color is-style-secondary has-60-font-size tz-page-heading">`.
- Produces (`lib/content.ts`): `routeIndex()` returns `siteRoutes(raw)`; `loadPage(key)` delegates `tz:` keys to `registry.ts` (`buildPage(key: string): PageContent`).

- [ ] **Step 1: Write failing tests.** In `scripts/structure.test.mjs`:
  - `siteRoutes` appends `/articles/` and `/articles/page/2/` after the routes.json routes.
  - It never duplicates a path.
  - With a temporary `REMOVED_PATHS` passed as a parameter (`siteRoutes(index, { removed, newRoutes })` overload used by tests), `/about/` is dropped from both routes and redirects.
  - `isRemovedPath("/video/video-3/")` follows the list given.
- [ ] **Step 2: Run** `node --test scripts/structure.test.mjs` — FAIL.
- [ ] **Step 3: Implement** `config/site-structure.mjs` + `.d.mts` (pattern: `config/site-url.mjs`). PASS.
- [ ] **Step 4: Write `e2e/articles.spec.ts`** (fails first: 404).
  - `/articles/` shows the hero text "More purpose, passion and positivity" and "Resources for those seeking spiritual growth.", then the h1 "Articles".
  - It shows 9 `.uagb-post__inner-wrap` cards; the first title is exactly `Parashas Tetzaveh | Feb 12th 2022`.
  - Clicking pagination "2" replaces the grid in place (URL still `/articles/`). The cards now include exactly `Parashas Vayigash | Dec10th-11th 2021` and `Parashas Mikeitz  | Dec 3rd-4th 2021` (two spaces), and "« Previous" leads back.
  - Across both pages, all 18 titles equal the 18 titles in `resources.json` + `resources__page__2.json`, in the same order.
  - `/articles/page/2/` exists.
  - "Yes, I would like to donate" links to `/donate/`; "Live Speaking Engagements:" is present.
  - `trackPageErrors` is empty.
- [ ] **Step 5: Implement** `parts.ts`, `compose.ts`, `registry.ts`, and `articles.ts` (`main = wrapEntry("Articles", resourcesHero() + sectionHeading(copy.articles.heading) + articlesGrid(n) + closingSections())`, islands `["signup","post-grid"]`).
  - In `content/copy/en.json`, add `{ "articles": { "heading": "Articles", "title": "Articles", "description": "Weekly Parasha articles from Tzion Breslov." } }`.
  - Update `lib/content.ts`.
- [ ] **Step 6: Point the scripts at `siteRoutes`.** `check-static-export`, `check-csp` (still visiting `/resources/` interactions until Task 4), `write-site-files` (adds every `NEW_ROUTES` path to `page-sitemap.xml` as `<url><loc>{site}{path}</loc></url>`), `check-wording`, plus `visual-diff` and `compare-live` (their default page lists gain `/articles/`).
- [ ] **Step 7: Add the base-path CI step** in `ci.yml` (Review Focus 3): `npm run build && npm run check:static-export` with `NEXT_PUBLIC_BASE_PATH: /Tzion-Breslov-Project`.
- [ ] **Step 8: Verify.**
  - `npm run check`: green.
  - `node scripts/check-csp.mjs`: no violations.
  - Visual diff (AGENTS.md command) on all pre-existing pages: ≤0.05%.
- [ ] **Step 9: Commit / PR / merge / verify the checkpoint** (as in Task 1, branch `structure/02-articles`).

---

### Task 3: Classes page — Ruach's video library in Tzion's look

**Files:**
- Create: `lib/video-library.mjs` + `.d.mts`, `scripts/video-library.test.mjs`, `scripts/extract-shorts.mjs`, `content/shorts.json`, `lib/pages/classes.ts`, `lib/client/dialog.ts`, `lib/client/video-library.ts`, `app/dialog.css`, `app/video-library.css`, `e2e/classes.spec.ts`
- Modify: `scripts/lib/youtube-feed.mjs` (+ `scripts/youtube-feed.test.mjs`): read view counts; `lib/content.ts` (`Island` += `"video-library"`); `components/enhancers.tsx`; `components/site-document.tsx` (import the two CSS files); `config/site-structure.mjs` (`NEW_ROUTES` += `{path:"/classes/",key:"tz:classes"}`); `content/copy/en.json` (`classes`)

**Interfaces:**
- Produces `type LibraryVideo = { id: string; title: string; published: string; views?: number }`. Exported from `lib/video-library.mjs`:
  - `sortVideos(videos: LibraryVideo[], order: "latest" | "popular" | "oldest"): LibraryVideo[]`:
    - latest = `published` descending, ties by title;
    - oldest = ascending;
    - popular = `views` descending, videos without `views` after every video with them, ties by `published` descending.
  - `filterVideos(videos, query: string): LibraryVideo[]`: case-insensitive substring on title after trimming; an empty query returns all.
  - `formatMonthYear(iso: string): string`: en-US `{month:"short",year:"numeric",timeZone:"UTC"}`, e.g. "Nov 2026".
- Produces `parseYouTubeFeed` entries `{ id, title, published, views? }` (`views` from `<media:statistics views="N">`, omitted when absent). `mergeYouTubeVideos` keeps refreshing the fields of known IDs.
- Produces `content/shorts.json`: `{ "source": "…", "shorts": [{ "id", "title", "published" }] }`. 26 entries, newest first by the WordPress publish time in `video-sitemap.xml` (video-27 `2023-06-29T10:01:04Z` first … video-3 last). The duplicate `__-cuW-FZHA` appears once, with video-5's time. Titles are the iframe `title` exactly, with entities decoded (`&quot;` → `"`).
- Produces `lib/client/dialog.ts`: `openDialog(opts: { label: string; content: HTMLElement; opener: HTMLElement | null; className: string; onClose?: () => void }): { close(): void }`.
  - The dialog is `role="dialog"`, `aria-modal="true"`, with an overlay.
  - It traps Tab, closes on Escape and on an overlay click, and locks scroll (`html.tz-dialog-open`).
  - Closing runs the close animation (`data-state="closed"`, removed after 220 ms, at once with reduced motion), then returns focus to `opener`.
  - Used again by Tasks 5 and 8.
- Produces `enhanceVideoLibrary(root: ParentNode = document): () => void`; island `"video-library"`.

Page markup (server-rendered by `classes.ts`, in default order). `main = wrapEntry("Classes", resourcesHero() + library + spacer-large + closingSections())`, where `library` is:
`section.tz-vl[data-tz-video-library][aria-labelledby=tz-vl-title]`, containing:
- `div.tz-vl__profile`:
  - the footer logo `/wp-content/uploads/2023/06/footer-logo.png` on a dark-blue circle;
  - `h1#tz-vl-title` "Classes";
  - `p.tz-vl__meta` `<strong>@tzionbreslovproject</strong> · {n} videos`;
  - `a.tz-vl__channel` "Visit our YouTube channel" → `https://youtube.com/@tzionbreslovproject`, `target=_blank rel="noopener noreferrer"`.
- `div.tz-vl__bar`, containing:
  - `div.tz-vl__tabs[role=group][aria-label=…]` with buttons `[data-kind=video][aria-pressed=true]` "Videos" and `[data-kind=short][aria-pressed=false]` "Shorts";
  - a search toggle with a labelled input;
  - `div.tz-vl__sort[role=group]` with buttons "Latest" (pressed) / "Most popular" / "Oldest".
- `div.tz-vl__grid[data-kind=video]` and `div.tz-vl__grid[data-kind=short][hidden]`.
- `p.tz-vl__empty[hidden][role=status]` "No videos match that search."

Each card is an `article.tz-vl__card[data-id][data-title][data-published][data-views]` containing `a.tz-vl__trigger[href="https://www.youtube.com/watch?v={id}"][target=_blank][rel="noopener noreferrer"][aria-label="Play video: {title}"]`, which holds:
- `span.tz-vl__thumb` with `img[src="https://i.ytimg.com/vi/{id}/hqdefault.jpg"][alt=""][width=480][height=360][loading=lazy]` (object-fit cover, 16:9) and a play icon;
- `span.tz-vl__details` with `<strong>{title}</strong>`, and for videos only `<span>{views} views · {Mon YYYY}</span>` (just the date when there is no count).

Shorts show the title only (their only dates are WordPress upload times). Shorts stay 16:9; the clips are horizontal.

- [ ] **Step 1: Write failing tests.**
  - `scripts/video-library.test.mjs`:
    - `sortVideos` for all three orders;
    - views-missing videos last under "popular";
    - title tie-break;
    - `filterVideos("bitul")` matches `Rabbi Kalmus Daily Ray of Wisdom: What is Bitul?`;
    - `formatMonthYear("2026-11-03T22:09:52+00:00") === "Nov 2026"`.
  - `scripts/youtube-feed.test.mjs`: a feed entry with `<media:group><media:community><media:statistics views="42"/>` parses `views: 42`; without it, there is no `views` key.
- [ ] **Step 2: Run** `npm run test:unit` — FAIL.
- [ ] **Step 3: Implement** `lib/video-library.mjs` and the parser change. PASS.
- [ ] **Step 4: Generate the shorts.** Write and run `scripts/extract-shorts.mjs`; it reads `content/pages/video__video-N.json` iframes + `content/site-files/video-sitemap.xml`, and is one-time (it can't run after Task 4 deletes the pages, which the header comment says). Commit `content/shorts.json`. Check: 26 entries, the first is `CGRzYu-_078`, and no ID repeats.
- [ ] **Step 5: Write `e2e/classes.spec.ts`** (FAIL first).
  - Videos: "Videos" is pressed and the card dates are non-increasing.
  - Sort: "Oldest" makes them non-decreasing; "Most popular" orders by `data-views` with the no-views cards last.
  - Shorts: "Shorts" shows 26 cards, the first titled exactly as `content/shorts.json[0].title`, and the sort group is hidden.
  - Search: on Shorts, "bitul" leaves 1 card; nonsense shows "No videos match that search."; Escape in the search clears it.
  - Player:
    - there is no `iframe` before a click;
    - clicking a card opens `role=dialog` with an iframe `src` matching `youtube-nocookie.com/embed/{id}?autoplay=1&playsinline=1&rel=0` and the title bar text;
    - Escape closes it, removes the iframe and puts focus back on that card's link;
    - the close button ("Close video player") also closes it.
  - Channel link: "Visit our YouTube channel" `href`.
  - **Size parity:** at 1440, 1024, 768 and 390 px wide, the first `.tz-vl__thumb` width equals the first `.sby_video_thumbnail` width on `/resources/` ±2 px. (Today's Classes tab; `/resources/` still exists until Task 4. After Task 4 the test compares against fixed numbers recorded from this run.)
  - **No JS** (Review Focus 2): the first card's link `href` is `https://www.youtube.com/watch?v=…`.
  - The closing sections are present, and there are no page errors.
- [ ] **Step 6: Implement** `dialog.ts`, `video-library.ts` and `classes.ts`. Add the `classes` copy (all labels above, plus "Close video player", "Play video", "views", "Search videos", "Clear search", "Video type", "Sort videos").
  - **Player look (Ruach's, in Tzion colours):**
    - overlay `rgb(12 33 54 / .86)` + `backdrop-filter: blur(12px)`, fade .2 s;
    - dialog fixed centre, `width: min(1120px, 100% - 32px)`, entering with `opacity 0, translate(-50%,-47%) scale(.84)` → 1 over .48 s `cubic-bezier(.16,1,.3,1)`, exiting in .22 s to `scale(.94)`;
    - title bar in Montserrat 600 white;
    - close button a 42 px circle that turns turquoise on hover;
    - frame 16:9.
  - **Grid:** inside the theme `.wrap`, 3 columns with a 16 px gap at the breakpoints measured in Step 5.
  - **Theme resets:** `all: unset` on every `.tz-vl` button and on the search input.
- [ ] **Step 7: Verify.**
  - `npm run check`: green.
  - `node scripts/check-csp.mjs`: green (`i.ytimg.com` and the nocookie frame are already allowed).
  - Visual diff on pre-existing pages: ≤0.05%.
  - Look at `/classes/` at 1440 and 390 and attach screenshots to the PR.
- [ ] **Step 8: Commit / PR / merge / checkpoint** (`structure/03-classes`).

---

### Task 4: Navigation, old pages removed, everything relinked

**Files:**
- Create: `lib/navigation.mjs` + `.d.mts`, `scripts/navigation.test.mjs`, `lib/client/menu.ts`, `app/navigation.css`, `e2e/navigation.spec.ts`, `e2e/removed.spec.ts`
- Modify: `components/site-document.tsx` (apply navigation and link rewrites), `components/enhancers.tsx` (always run `enhanceMenus`), `config/site-structure.mjs` (removals, rewrites, sitemaps, `INSTAGRAM_ENABLED=false`), `scripts/write-site-files.mjs` (sitemaps), `scripts/check-static-export.mjs` (removed-link check; drop the old sitemap requirements), `scripts/check-csp.mjs` (`/classes/` and `/articles/` interactions instead of `/resources/`), `scripts/{visual-diff,compare-live}.mjs` (page lists), `scripts/import-wordpress.mjs` (drop the `/about/` REDIRECT; gate `addInstagramTab` on `INSTAGRAM_ENABLED`), `config/security-headers.mjs` (remove `https://www.youtube.com` from `frame`), `.github/workflows/deploy-github-pages.yml` (remove the Instagram sync/cache steps; keep `test:instagram`), `docs/instagram-setup.md` (dormant note), `e2e/classes.spec.ts` (fixed widths), `README.md`, `AGENTS.md`
- Delete: `content/pages/video__video-{1..27}.json`, `content/pages/category__uncategorized*.json`, `content/pages/author__esti-wolo*.json`, `content/pages/resources__page__3.json`, `content/site-files/{video,category,author}-sitemap.xml`. Keep `resources.json` and `resources__page__2.json` (templates).

**Interfaces:**
- Produces `lib/navigation.mjs`:
  - `type NavItem = { key: string; href?: string; pageId?: number; type: "post_type" | "custom"; target?: "_blank"; desktop?: { id: number | string; label: string }; mobile?: { id: number | string; label: string }; footer?: { label: string }; children?: NavItem[] }`.
  - `ORIGINAL_NAV: NavItem[]`: About (ids 34 / 343, page 26), Resources (33 / 342, page 28), Contact (32 / 341, page 29), Donate (mobile 347 / footer, page 345), Taste a Class (mobile 348 / footer, custom, `_blank`, `https://youtu.be/MELvfMA8_Uc`). Desktop buttons (`menu-item-11` "Taste A Class", `menu-item-504` Donate) are left untouched except for current marking.
  - `NAV: NavItem[]`: Home (`/`, new id `tz-home`), About, Resources (no `href`; `children`: Classes `/classes/` `tz-classes`, Articles `/articles/` `tz-articles`), Contact, then — mobile and footer only — Donate and Taste a Class. Footer only: Privacy, from Task 9. Events and Gallery are inserted by Tasks 7 and 5, before Contact, in the order Events · Gallery.
  - `renderNavigation(html: string, currentPath: string, items?: NavItem[]): string` rewrites the inner HTML of `ul#menu-main-menu-links`, `ul#menu-mobile-menu` and `ul#menu-mobile-menu-1`, plus the current marking on `menu-item-504` / `347` / `11`, wherever they occur in `html`.
    - Current page: `current-menu-item page_item page-item-{pageId} current_page_item` is inserted before `menu-item-{id}` (without the page_item part when there is no `pageId`), and `aria-current="page"` goes on the `<a>`.
    - A current child page adds `current-menu-ancestor` to its parent.
  - `rewriteLinks(html: string): string`: exact `href="…"` matches from `LINK_REWRITES` (`/resources/` → `/classes/`, `/about/` → `/about-us/`), applied to `page.main` in `SiteBody`.
  - `stripRemovedUrls(json: string): string` (in `config/site-structure.mjs`): replaces removed-page URLs inside JSON-LD — plain or escaped-slash form, e.g. the Parasha posts' `Person.url` `https:\/\/tzionbreslov.com\/author\/esti-wolo\/` — with the site root. `SiteDocument` applies it to every `jsonld` head item.
- Dropdown markup:
  - **Desktop:** `<li id="menu-item-33" class="menu-item tz-menu-parent menu-item-33"><button type="button" class="tz-submenu-toggle" aria-expanded="false" aria-controls="tz-sub-resources"><span>Resources</span></button><ul id="tz-sub-resources" class="tz-sub-menu">…<li><a href="/classes/"><span>Classes</span></a></li>…</ul></li>`.
  - **Mobile:** the same, with `tz-sub-resources-mobile`.
  - **Footer:** `<li class="menu-item tz-menu-group"><span class="tz-menu-group-label">Resources</span><ul class="tz-sub-menu">…</ul></li>`.
  - The parent uses neither `menu-item-has-children` nor `.sub-menu`, so the theme's `global.js` slideToggle and `a11y-menu` stay out of it.
- Produces `enhanceMenus(root: Document = document): () => void`: the toggle button flips `aria-expanded`; Escape closes and focuses the toggle; focus leaving the `li` closes it; a click outside closes it; works for mouse, touch and keyboard.
  - At ≥1280 px, CSS also opens on `.tz-menu-parent:hover` and `:focus-within` (no-JS path).
  - The panel: white, Montserrat 1.5 rem items, dark-blue text, current/hover `--blue` weight 800, card radius and shadow (Global Constraints), `position:absolute; z-index:10000` under a `position:relative` parent.
  - In the mobile menu the sub-list expands inline, indented, in the menu's white text.
- Produces `REMOVED_PATHS`:
  - `/resources/`, `/resources/page/2/`, `/resources/page/3/`;
  - `/video/video-1/` … `/video/video-27/`;
  - `/category/uncategorized/`, `/category/uncategorized/page/2/`;
  - `/author/esti-wolo/`, `/author/esti-wolo/page/2/`;
  - `/about/`.
  - `isRemovedPath` also matches anything under `/video/`, `/category/`, `/author/` or `/resources/`.
- Produces `REMOVED_SITEMAPS = ["video-sitemap.xml","category-sitemap.xml","author-sitemap.xml"]`.

- [ ] **Step 1: Write the golden test** (`scripts/navigation.test.mjs`). For each of the 10 header/footer fragments, with the page path that uses it, `renderNavigation(fragment, path, ORIGINAL_NAV)` returns the file **byte-for-byte**. Pairings:
  - `d07fb20f0762` / `5b8a845aead8` → `/`
  - `fde8b8aab1cd` / `c215e6be2de2` → `/about-us/`
  - `edb0eacaaf8f` / `eacacdcdfaec` → `/contact/`
  - `e051e670d406` / `b3b875b5ee47` → `/donate/`
  - `8c0a880ace6b` / `0deaa75ac4e9` → `/resources/`

  Then the new-structure tests:
  - with `NAV` on `/classes/`, the Classes link has `aria-current="page"`, the Resources parent has `current-menu-ancestor`, and no other item is current;
  - the desktop labels in order are `Home, About, Resources, Classes, Articles, Contact`;
  - the footer list in order is `Home, About, Resources, Classes, Articles, Contact, Donate, Taste a Class`;
  - the buttons still read `Taste A Class`, `Donate`;
  - `rewriteLinks('<a href="/resources/">ENRICH YOUR LIFE</a>')` gives `href="/classes/"`, and `href="/about/"` becomes `/about-us/`.
- [ ] **Step 2: Run** `npm run test:unit` — FAIL.
- [ ] **Step 3: Implement** `lib/navigation.mjs` until the golden and new tests pass.
- [ ] **Step 4: Write `e2e/navigation.spec.ts`** (FAIL first).
  - **Desktop 1440:**
    - hovering "Resources" shows Classes and Articles *above the hero* (`document.elementFromPoint` at the Classes link centre returns that link) at scrollY 0 and after scrolling;
    - keyboard: Tab to the Resources button, Enter → `aria-expanded="true"`, Tab reaches Classes then Articles, Escape closes and focus is back on the button;
    - clicking Articles goes to `/articles/` and marks it current.
  - **1280×800:** every top-level item has the same `offsetTop` (one line), and `#menu-main-menu-links`' right edge is left of `.title-area`'s left edge and doesn't overlap `#menu-main-menu-buttons`. If this fails, reduce `.nav-primary .genesis-nav-menu a` padding to 10 px for 1280–1439 px only, and re-run.
  - **Touch tablet 1366×1024 (`hasTouch: true`, Review Focus 1):** tapping Resources opens the panel without navigating; tapping Classes navigates.
  - **Mobile (Pixel 7):** the hamburger opens the menu; tapping Resources expands Classes/Articles without navigating; tapping Classes goes to `/classes/`.
  - **No JS (Review Focus 2):** on desktop, focusing the Resources button reveals the panel via `:focus-within`.
  - **Footer:** Quick Links text in order as in the unit test.
  - **Relinks:** on `/`, "ENRICH YOUR LIFE" and "Enrich your life" → `/classes/`, and "Read my full story" → `/about-us/`; on `/about-us/`, "Enrich your life" → `/classes/`.
  - Screenshots of the header and footer at 1280, 1440 and 390 are saved to `test-results/nav/` for the PR.
- [ ] **Step 5: Write `e2e/removed.spec.ts`.** Every `REMOVED_PATHS` entry returns the 404 page (served `404.html`).
- [ ] **Step 6: Implement.** `site-document.tsx` applies `renderNavigation(readShared(header), page.path ?? "/")`, the same to the footer, and `rewriteLinks(expandTokens(main))`. Plus `menu.ts`, `navigation.css` and the structure-module values above.
  - `SiteDocument` applies `stripRemovedUrls` to `jsonld` head items; `scripts/navigation.test.mjs` gains a test that the escaped-slash author `Person.url` from a Parasha post becomes the site root.
  - `write-site-files`:
    - skips `REMOVED_SITEMAPS`;
    - removes their `<sitemap>` entries from `sitemap_index.xml`;
    - removes `<url>` blocks whose `loc` is a removed path.
  - `check-static-export`:
    - no longer requires the three sitemaps;
    - fails if any `out/**/*.html` or `out/*.xml` contains a removed path as a root-relative `href`/`src`/`loc` or as an absolute URL on the site origin (the JSON-LD included);
    - fails if any HTML still contains `youtube.com/embed`.
  - Delete the files listed above.
- [ ] **Step 7: Verify.**
  - `npm run check`: green. `check:wording` passes, and removed pages are skipped.
  - `node scripts/check-csp.mjs`: green.
  - Visual diff with `--mask-nav` on Home, About, Contact, Donate, a Parasha post and 404: ≤0.05%.
  - Review the nav screenshots at 1280, 1440 and 390.
  - `git grep -n '"/resources/\|/video/video-' -- content lib components` shows only the templates and `config/site-structure.mjs`.
- [ ] **Step 8: Commit / PR** (attach the nav screenshots) **/ merge / checkpoint** (`structure/04-navigation`).

---

### Task 5: Gallery page

**Files:**
- Create: `scripts/lib/gallery.mjs`, `scripts/gallery.test.mjs`, `scripts/convert-gallery-placeholders.mjs` (one-time), `public/media/gallery/{01-class-gathering,02-group-selfie,03-rabbi-lecturing,04-rabbi-portrait,05-collage,06-collage,07-collage}.webp`, `public/media/gallery/gallery.json`, `lib/pages/gallery.ts`, `lib/client/gallery.ts`, `app/gallery.css`, `e2e/gallery.spec.ts`
- Modify: `scripts/write-site-files.mjs` (write `content/gallery.generated.json`, gitignored), `.gitignore`, `lib/navigation.mjs` (Gallery item), `config/site-structure.mjs` (`/gallery/`), `lib/content.ts` (`Island` += `"gallery"`), `components/enhancers.tsx`, `components/site-document.tsx`, `content/copy/en.json` (`gallery`)

**Interfaces:**
- Produces `readGallery(dir: string): Promise<{ src: string; width: number; height: number; alt: string }[]>`.
  - It includes every `.webp`, `.jpg`, `.jpeg` or `.png` in `dir`.
  - Order: by `gallery.json` `order` (lower first), then by filename.
  - `alt` comes from `gallery.json` `{ "files": { "<name>": { "alt": "…", "order": n } } }`, falling back to `copy.gallery.defaultAlt`.
  - `width` / `height` come from sharp metadata.
  - `src` is `/media/gallery/<name>`.
- Produces `enhanceGallery(root: ParentNode = document): () => void` and island `"gallery"`.
- Gallery item: `a.tz-gallery__item[href=/media/gallery/<file>]` (opens the image without JS) wrapping `img[width][height][alt][loading=lazy]`.
- Viewer (`openDialog`):
  - the image (`object-fit: contain`), a caption = alt, and the counter "3 of 7";
  - Previous / Next buttons (they wrap around), ArrowLeft / ArrowRight, a pointer swipe with a 40 px threshold (as `lib/client/instagram.ts`), and a close button.
  - Images crossfade over .3 s, with no transition under reduced motion.

Grid: 3 columns ≥1024 px, 2 ≥600 px, 1 below; the gap is 24 px. Images are shown whole at their natural ratio (`height:auto`) on a white background: the placeholders have Tzion's rounded corners and the collage gutters baked in as transparency, so nothing is cropped. Page: `wrapEntry("Gallery", renderHero({ image: "/wp-content/uploads/2023/06/hero2.png", heading: copy.gallery.heading }) + grid + spacer-large)`. No closing sections: the spec gives those to Classes and Articles only.

- [ ] **Step 1: Write the failing tests** (`scripts/gallery.test.mjs`, using a temp dir with 3 generated sharp images):
  - order follows `gallery.json`, then filename;
  - a new file with no entry appears with `defaultAlt`;
  - `width` / `height` are correct;
  - non-images are ignored.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.** PASS.
- [ ] **Step 4: Run `convert-gallery-placeholders.mjs`.** Using sharp, it writes the 7 webp files (quality 88, alpha kept) from:
  - `2023/06/Mask-Group-11.png`
  - `2023/06/PHOTO-2021-02-26-22-51-46-2.png`
  - `2023/06/R_Kalmus_lecture_screen_1_1.png`
  - `2023/07/PHOTO-2023-06-27-19-08-13-1.png`
  - `2023/06/Group-200.png`, `Group-215.png`, `Group-277.png`

  Write `gallery.json` with the alt text from the copy proposal:
  - "Rabbi Kalmus teaching a class around a table"
  - "A group photo from a Tzion Breslov gathering"
  - "Rabbi Kalmus lecturing at a podium"
  - "Portrait of Rabbi David Yisrael Kalmus"
  - "Collage of photos from Tzion Breslov classes" ×3, with "(1)", "(2)", "(3)"
- [ ] **Step 5: Write `e2e/gallery.spec.ts`** (FAIL first).
  - There are 7 items.
  - Opening the first shows a dialog with alt 1 and "1 of 7".
  - ArrowRight → "2 of 7"; from 1, ArrowLeft → "7 of 7".
  - A swipe left (pointer events) → next.
  - Escape closes it and focus returns to item 1; the close button closes it.
  - No JS: the item `href` is the image file.
  - "Gallery" is in the desktop menu before Contact and marked current here.
  - No page errors.
- [ ] **Step 6: Implement** the page, viewer, CSS, copy (`heading` "Gallery", `title`, `description`, `defaultAlt` "Photo from Tzion Breslov", `previous` "Previous photo", `next` "Next photo", `close` "Close", `counter` "{n} of {total}") and the nav item.
- [ ] **Step 7: Verify.** `npm run check`, `check-csp` and the visual diff (masked) are all green.
- [ ] **Step 8: Commit / PR / merge / checkpoint** (`structure/05-gallery`).

---

### Task 6: Map on the Contact page

**Files:**
- Create: `lib/pages/contact-map.ts`, `app/pages.css` (map card; later the privacy layout), `e2e/contact.spec.ts`
- Modify: `config/security-headers.mjs` (`SOURCES.maps = { frame: ["https://www.google.com"] }`), `components/site-document.tsx` (apply `insertContactMap` when `page.path === "/contact/"`), `scripts/check-static-export.mjs` (assert the map is in `/contact/`), `scripts/check-csp.mjs` (scroll the map into view on `/contact/`), `content/copy/en.json` (`map`)

**Interfaces:**
- Produces `insertContactMap(main: string): string`. It inserts the map section immediately after the contact columns block (`wp-block-columns is-style-col-spread`, which holds `form#gform_3` and the three cards), before the trailing `spacer-medium-height`. It throws `structure: marker not found: contact columns` if the block isn't found.
- Map section: `section.tz-map[aria-labelledby=tz-map-title]` holds a card in the Contact-card style (light-blue background, dark-blue 1 px border, the Contact card radius, box-shadow) containing:
  - `h2#tz-map-title` (copy `map.heading`, "Find us in Bet Shemesh");
  - an `iframe` with `src="https://www.google.com/maps?q=Bet%20Shemesh%2C%20Israel&z=13&output=embed"`, `title` "Map of Bet Shemesh, Israel", `loading="lazy"`, `referrerpolicy="strict-origin-when-cross-origin"`, `allowfullscreen`, 420 px tall on desktop and 300 px on mobile, with the card radius;
  - `a` "Get directions" → `https://www.google.com/maps/dir/?api=1&destination=Bet%20Shemesh%2C%20Israel`;
  - `a` "Open in Google Maps" → `https://www.google.com/maps/search/?api=1&query=Bet%20Shemesh%2C%20Israel`.

  Both links have `target=_blank rel="noopener noreferrer"` and are styled as the theme's `wp-block-button is-style-turquoise` / `is-style-outline`.

- [ ] **Step 1: Write `e2e/contact.spec.ts`** (FAIL first).
  - The iframe `src` contains `maps?q=Bet%20Shemesh%2C%20Israel` and `output=embed`.
  - Both link `href`s are as above.
  - The section comes after the "Beit Shemesh, Israel" card in DOM order.
  - The form and the three cards are unchanged; `check:wording` covers their text.
  - After scrolling to the map there are no CSP violations.
- [ ] **Step 2: Implement** the insertion, CSS, CSP source and copy.
- [ ] **Step 3: Verify.**
  - `npm run check` and `check-csp` are green.
  - The visual diff on Contact differs only from the map section down. Compare the region above it: `node scripts/visual-diff.mjs --mask-nav /contact/` shows the change starting at the map's offset. Note it in the PR.
- [ ] **Step 4: Commit / PR / merge / checkpoint** (`structure/06-contact-map`).
  - In the PR body, note: "Cloudflare 'Tzion security headers' rule must gain `https://www.google.com` in frame-src on switch day (owner go-ahead)."

---

### Task 7: Events page, calendar sync, twice-daily rebuilds

**Files:**
- Create: `scripts/lib/google-calendar.mjs`, `scripts/google-calendar.test.mjs`, `scripts/fixtures/calendar-*.ics`, `scripts/sync-events.mjs`, `content/events.json`, `lib/events.mjs` + `.d.mts`, `scripts/events.test.mjs`, `lib/pages/events.ts`, `app/events.css`, `docs/EVENT_CALENDAR.md`, `e2e/events.spec.ts`
- Modify: `package.json` (devDependency `ical.js` exactly `2.2.1`; script `sync:events`), `scripts/write-site-files.mjs` (write `public/events.json`, gitignored), `.gitignore`, `.github/workflows/deploy-github-pages.yml`, `lib/navigation.mjs` (Events item), `config/site-structure.mjs` (`/events/`), `content/copy/en.json` (`events`), `README.md`

**Interfaces:**
- Produces `type EventRecord = { id: string; title: string; summary: string; location: string; startsAt: string; endsAt: string; timeZone: string; allDay: boolean; rsvp: "open" | "off"; limit: number | null }`.
- Produces `buildCalendarCatalog(ics: string, opts?: { now?: Date; horizonDays?: number; maxEvents?: number }): { events: EventRecord[]; warnings: string[] }`. Adapted from Ruach `scripts/lib/google-calendar.mjs`, keeping its recurrence, exception, EXDATE, cancellation, all-day and horizon handling, with these changes:
  - **IDs:** a recurring occurrence's id is `sha256(uid + "\n" + recurrenceId).slice(0,24)`. A one-off event's id is `sha256(uid + "\nsingle").slice(0,24)`, so it is stable when the event is moved.
  - **Time zone:** the DTSTART TZID when it isn't UTC; else the calendar's `X-WR-TIMEZONE` if valid; else `Asia/Jerusalem`. A `…Z` event is shown in that zone.
  - **Description:** `<br>` / `</p>` become newlines; tags are stripped; HTML entities are decoded (named + numeric).
  - **Markers**, read from the full text before shortening:
    - a line matching `/^\s*no\s+rsvp\s*[.!]?\s*$/im` → `rsvp:"off"`;
    - `/^\s*rsvp\s+limit\s*:\s*(\d+)\s*[.!]?\s*$/im` → `limit` when ≥1. A limit of 0 or a non-number → `null`, plus a warning.
    - Marker lines are removed, then the text is shortened to 320 characters on a word boundary with "…".
  - **Defaults:** the title falls back to "Tzion Breslov event"; horizon 370 days, max 60.
- Produces `publicGoogleCalendarUrl(value: string): URL`, as Ruach.
- Produces `renderEventsList(events: EventRecord[], copy): string` and `formatEventWhen(e: EventRecord): string` in `lib/events.mjs`.
  - Example of `formatEventWhen`: "Sunday, November 8, 2026 · 7:30 PM – 9:00 PM (Israel time)". The zone label is "(Israel time)" for `Asia/Jerusalem`; otherwise it is the IANA name. All-day events read "Sunday, November 8, 2026"; multi-day events are shown as a range.
  - Card: `article.tz-event[data-event-id][data-starts-at][data-rsvp][data-limit]` with `h2` title, `p.tz-event__when`, `p.tz-event__where` (when a location is set) and `p.tz-event__summary` (newlines → `<br>`).
  - Empty state: `div.tz-events__empty` with "No events are currently scheduled" and "Sign up below to hear about the next gathering, or contact us." The signup arrives in Task 8; until then the second sentence is "Contact us to hear about the next gathering." with a link to `/contact/`.
- `content/events.json` = `{ "syncedAt": null, "events": [] }` (committed default). `public/events.json` = `{ "syncedAt", "events": [{ id, title, startsAt, endsAt, timeZone, rsvp, limit }] }` (gitignored).

- [ ] **Step 1: Write the failing tests.**
  - `scripts/google-calendar.test.mjs`:
    - Ruach's 4 tests, adapted: recurrence edit / EXDATE / all-day / cancelled / ordering; excludes ended events; keeps a TZID; URL validation.
    - One-off event moved from 18:00 to 19:00 → same id.
    - Two dates of a weekly class → different ids.
    - `DTSTART:20261108T173000Z` with `X-WR-TIMEZONE:Asia/Jerusalem` → `timeZone:"Asia/Jerusalem"`.
    - **DST (Review Focus 4):** a weekly 19:30 Asia/Jerusalem class on 2027-03-21 and 2027-03-28 (Israel's DST starts 2027-03-26) → `startsAt` `2027-03-21T17:30:00.000Z` then `2027-03-28T16:30:00.000Z`.
    - Entities: `Torah &amp; Tea` → `Torah & Tea`.
    - **Markers (Review Focus 5):**
      - `"Join us\nNo RSVP."` → off, summary "Join us";
      - `"rsvp limit: 40"`, `"RSVP Limit:40"`, and `"Bring a friend\nRSVP limit: 40\nParking nearby"` → 40, marker removed;
      - `"RSVP limit: 0"` → null + a warning;
      - a marker after 400 characters of text is still read.
  - `scripts/events.test.mjs`:
    - `formatEventWhen` for a timed event, an all-day event and a multi-day event;
    - `renderEventsList([])` contains the empty-state text;
    - a card escapes `<script>` in a title;
    - a location row only when one is set.
- [ ] **Step 2: Run** — FAIL. Run `npm i -D ical.js@2.2.1 --save-exact`.
- [ ] **Step 3: Implement** `google-calendar.mjs` and `events.mjs`. PASS.
- [ ] **Step 4: Implement `scripts/sync-events.mjs`.**
  - `GOOGLE_CALENDAR_ICAL_URL` unset → `::notice::` and keep the file, exit 0.
  - 3 attempts with 5 s and 10 s backoff and a 30 s timeout, `redirect:"error"`.
  - On failure: `::warning title=Google Calendar::` and keep the existing file, exit 0. `--strict` makes that a failure. A malformed calendar always fails.
  - Print warnings as `::warning::`.
  - Write `content/events.json` only when it changed.
- [ ] **Step 5: Update the deploy workflow.**
  - `schedule:` becomes two entries, `- cron: "0 7 * * *"` with `timezone: "Asia/Jerusalem"`, and `- cron: "0 21 * * *"` with `timezone: "Asia/Jerusalem"` (GitHub Actions supports `timezone` on schedules since March 2026). This replaces `41 4 * * *`.
  - Add `actions/cache/restore` and `save` for `content/events.json` (key `events-${{ github.run_id }}`, restore-keys `events-`), pinned to the same SHA as the Instagram cache steps.
  - Add `npm run sync:events` with `GOOGLE_CALENDAR_ICAL_URL: ${{ vars.GOOGLE_CALENDAR_ICAL_URL }}` before Build.
  - Add a `test:unit` step.
- [ ] **Step 6: Write `e2e/events.spec.ts`.**
  - `/events/` (with the empty default) shows the hero ("Upcoming events", image `/wp-content/uploads/2023/06/eagle-in-the-sky.png`) and the empty state.
  - "Events" is in the menu before Gallery and marked current.
  - `/events.json` is served and parses.
- [ ] **Step 7: Implement** the page, nav item, copy and `docs/EVENT_CALENDAR.md`. That doc adapts Ruach's owner steps:
  - calendar name "Tzion Breslov Events", public with full details;
  - copy the **public iCal address** (`…/public/basic.ics`) into the Actions **Variable** `GOOGLE_CALENDAR_ICAL_URL`;
  - the markers "No RSVP" and "RSVP limit: 40", each on its own line in the description;
  - every date of a repeating class takes its own RSVPs;
  - the page refreshes at 07:00 and 21:00 Israel time, or right away via Actions → Deploy GitHub Pages → Run workflow.
- [ ] **Step 8: Verify.**
  - `npm run check` and `check-csp` are green.
  - Locally, `GOOGLE_CALENDAR_ICAL_URL=<a public Google holiday calendar basic.ics> npm run sync:events && npm run build`, then look at `/events/` with real cards. Don't commit the result: `git checkout content/events.json`.
  - Masked visual diff is green.
- [ ] **Step 9: Commit / PR / merge / checkpoint** (`structure/07-events`).
  - After merge, run Deploy once by hand to confirm the cache and sync steps. The next morning, check the 07:00 run with `gh run list --workflow deploy-github-pages.yml --event schedule`.

---

### Task 8: RSVPs and "Event announcements" (built and tested; not deployed)

**Files:**
- Create: `worker/migrations/0002_rsvps_and_topics.sql`, `worker/src/events.ts`, `lib/client/submit.ts`, `lib/client/rsvp.ts`, `lib/client/announcements.ts`, `e2e/rsvp.spec.ts`, `scripts/fixtures/write-events-fixture.mjs`
- Modify: `.github/workflows/ci.yml` (fixture build + RSVP e2e), `e2e/events.spec.ts`, `lib/api-contract.ts`, `worker/src/{index,validation,database,providers,types}.ts`, `worker/test/worker.test.ts`, `vitest.worker.config.mts`, `wrangler.jsonc`, `.dev.vars.example`, `lib/client/forms.ts` (use `submit.ts`), `lib/events.mjs` (RSVP button + signup block), `lib/pages/events.ts`, `lib/content.ts` (`Island` += `"events"`), `components/enhancers.tsx`, `app/events.css`, `scripts/setup-resend.mjs` (Event announcements topic; add missing `.env.worker` lines instead of throwing), `content/copy/en.json` (`rsvp`, `announcements`)

**Interfaces:**
- **Contract (`lib/api-contract.ts`)**, types and `as const` values only:
  - `API_PATHS.rsvp = "/v1/rsvp"`, `API_PATHS.rsvpAvailability = "/v1/rsvp/availability"`; `TURNSTILE_ACTIONS.rsvp = "rsvp"`.
  - `SUBSCRIBE_TOPICS = ["newsletter","events"] as const`; `type SubscribeTopic`.
  - `SubscribeRequest` gains `topics?: SubscribeTopic[]`; a missing value means `["newsletter"]`, so the footer form is unchanged.
  - `type RsvpRequest = SecurityEnvelope & { eventId: string; name: string; email: string; guests: number; accessibility?: string; consent: "granted" }`.
  - `type RsvpSuccessResponse = { ok: true; requestId: string; confirmationId: string }`.
  - `type RsvpAvailabilityResponse = { ok: true; events: Record<string, { full: boolean; remaining: number | null }> }`.
  - `FIELD_LIMITS` += `name {min 2, max 100}`, `accessibility {max 1000}`, `guests {min 1, max 12}`.
  - Error codes: `EVENT_NOT_FOUND` (404), `EVENT_CLOSED` (409), `EVENT_FULL` (409), `EVENTS_UNAVAILABLE` (503).
  - `ApiInputField` includes the RSVP fields and `topics`.
- **Migration 0002** (additive only; `request_log` untouched, since its route CHECK is live in production):
  ```sql
  CREATE TABLE rsvps (
    id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, event_id TEXT NOT NULL, event_starts_at TEXT NOT NULL,
    name TEXT NOT NULL, email TEXT NOT NULL, email_hash TEXT NOT NULL,
    guests INTEGER NOT NULL CHECK (guests BETWEEN 1 AND 12), accessibility TEXT, created_at INTEGER NOT NULL);
  CREATE INDEX rsvps_event_id_idx ON rsvps(event_id);
  CREATE INDEX rsvps_event_starts_at_idx ON rsvps(event_starts_at);
  ALTER TABLE subscription_confirmations ADD COLUMN topics_json TEXT NOT NULL DEFAULT '["newsletter"]';
  ```
- **Worker env:** vars `EVENTS_FEED_URL` (`https://tzionbreslov.org/events.json`) and `RSVP_RETENTION_DAYS` (`"90"`, counted from the event's start). Secret `RESEND_EVENTS_TOPIC_ID` makes 9 required secrets.
- **`worker/src/events.ts`:**
  - `loadEventFeed(env: Env, now?: number): Promise<FeedEvent[]>` fetches with `redirect:"manual"` and requires status 200 + JSON + a valid shape, else throws `PublicError("EVENTS_UNAVAILABLE")`. Results are cached per isolate for 60 s.
  - `findRsvpEvent(feed, eventId): FeedEvent | null` returns null for unknown events and for `rsvp:"off"`.
- **`reserveRsvp(env, input, event, emailHash): Promise<{ id: string; created: boolean }>`:**
  - First returns the existing row for the `request_id`, with `created:false`.
  - Otherwise runs one statement: `INSERT INTO rsvps (…) SELECT … WHERE ?limit IS NULL OR COALESCE((SELECT SUM(guests) FROM rsvps WHERE event_id = ?), 0) + ?guests <= ?limit`.
  - 0 changes → re-checks the `request_id`, else `EVENT_FULL`.
- **`POST /v1/rsvp` order:**
  1. `validateRsvp`: envelope, name 2–100, email, guests integer 1–12, accessibility ≤1000, `consent === "granted"` (else `INVALID_INPUT` field `consent`), eventId `^[0-9a-f]{24}$`.
  2. Rate limits: IP 30 per 600 s, email 6 per 600 s.
  3. Turnstile action `rsvp`.
  4. Feed → `EVENT_NOT_FOUND`, then `EVENT_CLOSED` when now ≥ `startsAt`.
  5. `reserveRsvp`.
  6. When `created`, two emails:
     - guest: "RSVP received: {title}", with when (`formatEventWhen` imported from `lib/events.mjs`), guests and confirmation id; Reply-To `RESEND_REPLY_TO_EMAIL`; idempotency key `rsvp-guest/{requestId}`;
     - organizer, to `CONTACT_TO_EMAIL`: "New RSVP: {title}", with name, email, when, guests, accessibility, confirmation id; Reply-To the visitor; key `rsvp-organizer/{requestId}`.
  7. Respond 202 `RsvpSuccessResponse`.
- **`GET /v1/rsvp/availability`:** for every feed event with `rsvp:"open"`, returns `{ full, remaining }`; `remaining` is null when there's no limit. CORS `Access-Control-Allow-Origin` for `ALLOWED_ORIGINS`, `Cache-Control: public, max-age=60`.
- **Subscriptions:** `validateSubscription` accepts optional `topics` (deduplicated, non-empty, newsletter|events). `createSubscriptionConfirmation` stores `topics_json`. On confirm, `subscribeToTopics(env, email, topics)` replaces `subscribeToNewsletter` and maps each topic to `RESEND_NEWSLETTER_TOPIC_ID` / `RESEND_EVENTS_TOPIC_ID`.
- **Cleanup cron:** also `DELETE FROM rsvps WHERE event_starts_at < datetime('now', '-' || ? || ' days')`.
- **Client:** `submitPublicForm(path: string, payload: Record<string, unknown>): Promise<Response>` and `envelopeFields(startedAt: number, token: string)` in `lib/client/submit.ts`. `enhanceRsvp(root)` and `enhanceAnnouncements(root)` run under island `"events"`.
- **Events page additions:**
  - **RSVP button** `button.tz-event__rsvp` "RSVP" on cards with `rsvp:"open"`. The client hides it when `startsAt` ≤ now. With an API configured, it fetches availability and replaces the button of a full event with `p.tz-event__full` "This event is full".
  - **RSVP dialog** (`openDialog`): title "RSVP: {title}", a when line, then the fields Name / Email / "Number of guests" (number 1–12, default 1) / "Accessibility or dietary needs (optional)" / a consent checkbox "I agree to the privacy notice and consent to this submission." (the privacy link arrives in Task 9), plus a hidden honeypot, a Turnstile mount and a submit button "Send RSVP".
  - **RSVP results:**
    - success: "Thank you — your RSVP is in. A confirmation is on its way to your inbox.";
    - full: "Sorry — this event is now full.";
    - closed: "RSVPs for this event have closed.";
    - unavailable (preview): "RSVPs open when the new site launches. Until then, email us at tzionbreslovproject@gmail.com."
  - **"Get event announcements" block** after the list:
    - email field; checkboxes "Event announcements" (checked) and "Newsletter"; button "Sign up";
    - at least one box is required ("Choose at least one list.");
    - success: the existing signup confirmation text, reused unchanged.

- [ ] **Step 1: Rewrite and add the Worker tests first** (`worker/test/worker.test.ts`). Extend `mockProviders` to answer `EVENTS_FEED_URL` with a test feed (per-test overridable: 500, 302 redirect, malformed). Add `beforeEach` `DELETE FROM rsvps`. Tests:
  - replace "keeps removed RSVP … closed" with: RSVP to an open event → 202, one row, 2 emails (guest subject `RSVP received: Weekly class`, organizer to `team@example.test` with Reply-To the visitor);
  - same `requestId` again → same `confirmationId`, still 1 row, no new emails;
  - limit 3: 2 guests then 2 guests → 202, then 409 `EVENT_FULL`;
  - concurrent: two 2-guest RSVPs at once against limit 3 → exactly one succeeds;
  - event started → 409 `EVENT_CLOSED`;
  - `rsvp:"off"` and unknown id → 404 `EVENT_NOT_FOUND`;
  - feed 500 / 302 / malformed → 503 `EVENTS_UNAVAILABLE`;
  - guests 0, 13 and "2.5" → `INVALID_INPUT` field `guests`; missing consent → field `consent`; Turnstile action mismatch → rejected;
  - availability GET → `{ full, remaining }` with CORS for `https://site.test` and none for other origins;
  - subscribe with `topics:["events"]` → confirm → the Resend contact call carries only `topic_events`; legacy body without topics → only `topic_newsletter` (rewrite the old "ignores legacy fields" test);
  - origin and preflight path loops include `/v1/rsvp`;
  - the scheduled cleanup deletes an RSVP whose event started 91 days ago and keeps one from 89 days ago.
- [ ] **Step 2: Run** `npm run test:worker` — the new tests FAIL.
- [ ] **Step 3: Implement** the contract, migration, Worker changes, `wrangler.jsonc` and the vitest bindings (`RESEND_EVENTS_TOPIC_ID: "topic_events"`, `EVENTS_FEED_URL: "https://site.test/events.json"`, `RSVP_RETENTION_DAYS: "90"`). Run `npm run test:worker` and `npm run typecheck:worker` — PASS.
- [ ] **Step 4: Write the browser tests.**
  - In the default build (no events, no API configured), `e2e/events.spec.ts` gains two checks on the "Get event announcements" form: it needs at least one box ticked, and submitting shows the unavailable message with tzionbreslovproject@gmail.com.
  - `e2e/rsvp.spec.ts` runs only when `TZ_E2E_EVENTS=1` (`test.skip` otherwise), against a fixture build:
    - Build env: `EVENTS_FIXTURE=scripts/fixtures/events.e2e.json` (read only by `write-site-files` and `lib/pages/events.ts`, at build time), `NEXT_PUBLIC_API_BASE_URL=https://api.tzionbreslov.org` (already allowed by the CSP) and `NEXT_PUBLIC_TURNSTILE_SITE_KEY=1x00000000000000000000AA`.
    - `scripts/fixtures/write-events-fixture.mjs` writes the fixture with times relative to now: one open event tomorrow, one "No RSVP" event, one limited event and one that started an hour ago.
    - The spec stubs `https://challenges.cloudflare.com/**` with a minimal `window.turnstile` (`render` returns an id, `getResponse` returns `"test-token"`), and stubs the API with `page.route`.
  - `e2e/rsvp.spec.ts` asserts:
    - the open event shows "RSVP"; the "No RSVP" and started events don't;
    - an availability of `{full:true}` for the limited event shows "This event is full";
    - the dialog opens with focus on Name, and Escape returns focus to the button;
    - a 202 shows the success message, a 409 `EVENT_FULL` shows the full message, and a network error shows the error message;
    - there are no CSP violations.
  - `.github/workflows/ci.yml` gains a step after the .org build: `node scripts/fixtures/write-events-fixture.mjs && npm run build && TZ_E2E_EVENTS=1 npx playwright test e2e/rsvp.spec.ts`, with the env above.
- [ ] **Step 5: Implement** the client modules, the events page additions and the copy. `forms.ts` switches to `submit.ts` with no behaviour change: the existing `check-csp` `/contact/` flow and the Worker tests stay green.
- [ ] **Step 6: Update `scripts/setup-resend.mjs`.** It creates the topic "Event announcements" with `default_subscription:"opt_out"` and the description "Tzion Breslov event announcements." and writes `RESEND_EVENTS_TOPIC_ID`. **Do not run it** (owner go-ahead).
- [ ] **Step 7: Verify.**
  - `npm run check` and `check-csp` are green.
  - `npx wrangler d1 migrations apply tzion-breslov-production --local` applies 0002 cleanly on top of 0001 (local database only).
  - **Nothing is deployed.**
- [ ] **Step 8: Commit / PR / merge / checkpoint** (`structure/08-rsvp`). The PR body lists the deploy steps deferred to switch day (Task 11).

---

### Task 9: Privacy page

**Files:**
- Create: `lib/pages/privacy.ts`, `e2e/privacy.spec.ts`
- Modify: `config/site-structure.mjs` (`/privacy/`), `lib/navigation.mjs` (footer-only Privacy item at the end of Quick Links), `lib/events.mjs` (consent label links to `/privacy/`), `app/pages.css` (legal layout: max-width 760 px, Newsreader `h2` in dark blue, 1.8 rem Montserrat body, a light-blue rule between sections), `content/copy/en.json` (`privacy`)

**Interfaces:**
- Copy shape: `privacy: { title: "Privacy notice", updated: "Last updated {date}", intro, sections: { heading: string; paragraphs: string[] }[] }`.
- The sections describe the site **as built**:
  1. **What you send us:** contact form (first/last name, email, phone, address, message); newsletter and event announcements (email and chosen lists, with a confirmation email); RSVP (name, email, number of guests, optional accessibility/dietary note, consent).
  2. **How we use it:** reply to you, send only the lists you confirmed, run events, protect the forms from abuse.
  3. **Where it goes:**
     - GitHub Pages hosts the site;
     - Cloudflare provides DNS, the forms service, its database and Turnstile (spam protection);
     - Resend delivers email and keeps confirmed subscriptions;
     - YouTube receives a request only when you press play (privacy-enhanced mode);
     - Google Maps when the Contact page map loads or you open directions;
     - Google Fonts serves the site's typefaces on every page;
     - PayPal will process donations once they are switched on.
  4. **How long:**
     - contact messages are emailed, not stored;
     - unconfirmed sign-ups expire after 24 hours;
     - confirmed subscriptions stay with Resend until you unsubscribe or ask us to delete them;
     - RSVPs are deleted 90 days after the event;
     - security records: request logs 30 days, email-delivery events 90 days, rate-limit records only hashed and short-lived.
  5. **Cookies and tracking:** no analytics, advertising or tracking cookies.
  6. **Your choices:** the unsubscribe link in every email; write to tzionbreslovproject@gmail.com for access, correction or deletion.

  Hero: `renderHero({ image: "/wp-content/uploads/2023/06/clouds-in-the-sky-1.png", heading: "Privacy notice" })`. No closing sections.

- [ ] **Step 1: Write `e2e/privacy.spec.ts`** (FAIL first).
  - `/privacy/` has the 6 section headings in order.
  - Every page's footer Quick Links ends with "Privacy" → `/privacy/` (one static check over `out/`).
  - The RSVP consent label links to `/privacy/`.
- [ ] **Step 2: Implement** the page, nav item, copy and CSS.
- [ ] **Step 3: Verify.** `npm run check`, `check-csp` and the masked visual diff are green.
- [ ] **Step 4: Commit / PR / merge / checkpoint** (`structure/09-privacy`).
  - PR body: "Owner to read and approve the privacy text before launch."

---

### Task 10: "Manage your monthly donation" link

**Files:**
- Modify: `components/donate-form.tsx`, `lib/client/donations.ts`, `app/enhancements.css`, `content/copy/en.json` (`donate.manageMonthly`, `donate.manageMonthlyNote`), `e2e/donate.spec.ts` (create)

**Interfaces:**
- Produces `PAYPAL_AUTOPAY_URL = "https://www.paypal.com/myaccount/autopay/"` in `lib/client/donations.ts` (the owner confirms it in plan review).
- The link `a.tz-donate__manage` "Manage your monthly donation" (`target=_blank rel="noopener noreferrer"`) sits directly under the frequency fieldset and is always visible.
- `p.tz-donate__manage-note`: "Already giving monthly through PayPal? Change or cancel it in your PayPal account." Style: 1.4 rem Montserrat 700, dark blue, underlined; turquoise on hover.

- [ ] **Step 1: Write `e2e/donate.spec.ts`** (FAIL first). On `/donate/`, after the island mounts, the link has that `href` and `target`, and the existing donate form labels are unchanged (amount buttons $100 / $150 / $300 / $600, "How often would you like to donate?").
- [ ] **Step 2: Implement.** `npm run check` is green. Donate is the intentional visual-diff exception: note the diff region in the PR.
- [ ] **Step 3: Commit / PR / merge / checkpoint** (`structure/10-donate-manage`).

---

### Task 11: Switch-day runbook and final verification

**Files:**
- Modify: `README.md` (Switch day section), `PROJECT_MEMORY.md` (Status, decisions), `ROLLBACK.md` (live-service rows confirmed), `docs/superpowers/plans/2026-11-06-site-structure.md` (tick boxes)

- [ ] **Step 1: Write the switch-day steps** into README → "Switch day", each with its undo, all **owner go-ahead only**:
  1. **Database:** note the D1 Time Travel bookmark (`npx wrangler d1 time-travel info tzion-breslov-production`), then `npm run db:migrate:remote` (0002).
  2. **Resend:** `node scripts/setup-resend.mjs` creates "Event announcements"; then `npx wrangler secret put RESEND_EVENTS_TOPIC_ID`.
  3. **Worker:** note the current version (`npx wrangler deployments list`), then `npm run worker:deploy`; smoke-test `/health`, the RSVP preflight and availability.
  4. **CSP rule:** update the Cloudflare "Tzion security headers" rule to the new `CSP`/`CSP_REPORT_ONLY`: `frame-src` gains `https://www.google.com` and loses `https://www.youtube.com`.
  5. **Redirect rules** (single redirects, 301), exported before creation:
     - `/resources/` → `/classes/`;
     - `/video/*` → `/classes/`;
     - `/resources/page/*`, `/category/uncategorized/*` and `/author/esti-wolo/*` → `/articles/`;
     - `/about/` → `/about-us/`.
  6. **Calendar:** set the `GOOGLE_CALENDAR_ICAL_URL` variable (docs/EVENT_CALENDAR.md).
- [ ] **Step 2: Final verification on `main`.**
  - `npm run check`;
  - `node scripts/check-csp.mjs`;
  - masked visual diff of every pre-existing page against the `checkpoint-001` build;
  - `npm run check:wording`;
  - a manual pass of every new page at 1440, 1280, 768 and 390 against the spec's goals 1–9.

  Record the results in PROJECT_MEMORY.md.
- [ ] **Step 3: Commit / PR / merge / checkpoint** (`structure/11-switch-day-runbook`).

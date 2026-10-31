# Visual regression suite — design

Implements `requirements.md`. Every file:line reference below was verified against commit `3df871e`.

## 1. Shape

A fifth Playwright lane, parallel to the four that exist (`playwright.config.ts` fixtures,
`playwright.mocked-api.config.ts`, `playwright.journeys.config.ts`, `playwright.a11y.config.ts`):

```
e2e/
  playwright.visual.config.ts     # new lane
  visual/
    _helpers.ts                   # stabilise(page) — the whole determinism contract
    screenshot.css                # stylePath: injected only at capture time
    marketing.spec.ts             # 7 routes
    auth.spec.ts                  # 6 routes
    app-*.spec.ts                 # 12 authenticated routes, grouped
    public.spec.ts               # /p/[slug], /f/[slug], /b/[slug]
    states.spec.ts                # drawers, dialogs, overflow tables
    __screenshots__/              # committed baselines, per project
scripts/
  visual-baselines.sh             # regenerate inside the pinned container
```

Everything lives under `e2e/` so the `non_e2e` path filter (`verify.yml:56-58`) keeps an
e2e-only PR out of `coverage-delta`, which has no coverage data for Playwright (R3.14).

## 2. Nondeterminism: the full inventory and its mitigation

This table is the heart of the design. Each row is a verified source of pixel difference between
two runs of identical code. **R3.6 cannot hold unless every row is handled.**

| # | Source | Evidence | Mitigation |
|---|---|---|---|
| 1 | Fonts fetched from `fonts.googleapis.com` with `display=swap` — every text metric depends on network timing, and a slow or failed fetch paints the fallback face | `web/src/app/layout.tsx:16-23` | **Self-host via `next/font`** (§3). This is an app change, and the one real prerequisite |
| 2 | Baselines are font-stack dependent on the machine that made them | no `container:` in any job; `verify.yml:813` bare `ubuntu-latest` | Run capture *and* compare in `mcr.microsoft.com/playwright:v1.63.0-noble` (tag verified to exist) |
| 3 | `daysAgo()` feeds every `createdAt` / `expiresAt` / `submittedAt` in the fixture set | `web/src/lib/api/fixtures.ts:59` | `page.clock.setFixedTime()` before navigation — freezes `Date.now()` at module evaluation, so the fixture data itself becomes fixed |
| 4 | `relativeDate` / `timeAgo` read `Date.now()` and bucket with `Math.round`, so a label flips minutes apart | `web/src/lib/utils.ts:99`, `:121` | Same fixed clock (#3) |
| 5 | `formatDate` calls `toLocaleDateString(undefined, …)` — output follows runner locale, and the parse is TZ-sensitive | `web/src/lib/utils.ts:125-129` | `locale: 'en-US'` + `timezoneId: 'UTC'` in config `use` |
| 6 | `full()` / `group()` call bare `toLocaleString()` | `web/src/lib/utils.ts:16`, `web/src/lib/plural.ts:4` | Same pinned locale (#5) |
| 7 | Footer renders `new Date().getFullYear()` on every marketing page | `web/src/components/marketing/site-footer.tsx:77` | Same fixed clock (#3) |
| 8 | 24h analytics series builds hourly buckets from `new Date()`, so axis labels change hourly | `web/src/lib/api/fixtures.ts:700-723` | Same fixed clock (#3) |
| 9 | Recharts `<Area>` animates on mount (~1.5 s); `isAnimationActive` is never set false, and the CSS `reduce-motion` kill-switch cannot reach a JS animation | `web/src/components/charts/index.tsx:120-132`; kill-switch at `globals.css:240-253` | **Honour reduced motion in the chart** (§4). An a11y fix in its own right |
| 10 | `ResponsiveContainer` renders nothing on first pass, then emits float path coords from a measured width | `charts/index.tsx:85` | Fixed viewport + `stabilise()` waits for the `<path>` to exist |
| 11 | `minTickGap={28}` makes the visible tick set depend on measured width | `charts/index.tsx:97` | Fixed viewport; `maxDiffPixelRatio` absorbs antialiasing |
| 12 | `animate-pulse` skeletons — an infinite 2 s opacity keyframe | `web/src/components/ui/index.tsx:564-566`; call sites incl. `forms/page.tsx:118`, `bio/page.tsx:411`, `qr/page.tsx:67` | `animations: 'disabled'` in the screenshot options, **and** `stabilise()` asserts no skeleton remains — a skeleton in frame means content never loaded |
| 13 | Toasts auto-dismiss on a `Date.now()` timer that pauses on hover, and set `--toast-inset` on the root, changing total page height | `web/src/components/ui/toast.tsx:162-169`, `:69-79` | `stabilise()` asserts `[data-testid="toast"]` count is 0 |
| 14 | Row actions are `opacity-0` until `group-hover`, so a parked cursor changes the frame | `web/src/components/links/link-row.tsx:27` | Specs do not use pointer hover; where a click is unavoidable, reset the pointer to a documented inert coordinate |
| 15 | `row-action` forces `opacity: 1` under `@media (hover: none)` — same code, different pixels on a touch-emulating context | `globals.css:300-304` | Deliberate: mobile project uses a touch context, so this is *covered*, not hidden. Separate baseline per project |
| 16 | `prefers-color-scheme` decides the theme when `mode: ""` (the default) — CI and a laptop differ | `theme-provider.tsx` `DEFAULT_APPEARANCE.mode = ""`, resolved at `:77`; `globals.css:110` | `colorScheme` pinned per project **and** `snapurl.appearance` seeded via `addInitScript` |
| 17 | `--accent`, `--density`, `--radius` come from `localStorage` and change padding and corner geometry | pre-paint script `app/layout.tsx:25-40`; `--density` used at `app-shell/index.tsx:66` | Seed a fixed appearance object (#16) |
| 18 | `data-auth` pre-paint hint shows/hides marketing chrome | `globals.css:269-272`, `lib/session-hint.ts` | Explicit per spec: signed-out is the default; signed-in marketing is its own target |
| 19 | `TableWrap` renders from *measured* overflow — first paint is always `overflow=false`, and a ±1 px width change flips the fade, the pill and the sticky-column shadow together | `web/src/components/ui/index.tsx:393-418`, `:489` | `stabilise()` waits `fonts.ready` then two `requestAnimationFrame`s so layout + effects have flushed; viewport widths chosen away from the flip threshold |
| 20 | Scrollbar gutter rendering is platform-dependent and feeds back into `clientWidth` → #19 | `overflow-x-auto` at `ui/index.tsx:429` | Container pins the platform; `screenshot.css` hides scrollbars at capture time |
| 21 | QR SVG composes **asynchronously** (blank frame first) and a `MutationObserver` re-renders it on any theme change | `web/src/components/qr/qr-preview.tsx:26`, `:30-37` | `stabilise()` waits for the QR container to be non-empty |
| 22 | `useWorkspace({ live: true })` polls every 60 s and re-enables `refetchOnWindowFocus` | `web/src/lib/api/hooks/workspace.ts:54` | Harmless under fixtures (same data returns), but keep per-test runtime well under 60 s |
| 23 | Fixture write paths generate random slugs/ids that render as visible text | `fixtures.ts:626`, `:959`, `:1097`, `:1127` | R3.8: visual specs are read-only. Not mitigated — avoided |
| 24 | Unicode glyph icons (`☰ ✕ ▾ ✓ ⌕ ▲▼`) and emoji flags in `BarList` resolve from whatever font the platform has | `app-shell/index.tsx:292`, `:314`, `:176`; `charts/index.tsx:169` | Container pins the font set. **Verify during bring-up** that the image carries a colour-emoji font; if not, add one to the lane's setup |
| 25 | `<linearGradient id="fillPrimary">` is a hardcoded, non-unique SVG id — two charts on a page collide, and which wins is document-order dependent | `charts/index.tsx:88` | Deterministic for a given DOM, so it does not break R3.6. Noted as a latent bug to file separately, not fixed here |
| 26 | 120 ms artificial latency in every fixture response | `fixtures.ts:823` | Absorbed by `stabilise()`'s skeleton assertion (#12) |

`page.clock.setFixedTime` is the right primitive for #3/#4/#7/#8 rather than `clock.install`:
it freezes clock *reads* while leaving timers running, so React, the 120 ms fixture latency and the
toast timer all still work. This matches [Playwright's own recommendation](https://playwright.dev/docs/clock)
to prefer `setFixedTime` and reach for `install` only when the page must observe time passing.

## 3. Prerequisite: self-host the fonts

Row #1 is the one thing that cannot be solved from the test side. `display=swap` means the page
paints in a fallback face and reflows when the webfont arrives, so text metrics depend on network
timing; and `document.fonts.ready` resolves on *failure* as well as success, so a Google Fonts
hiccup silently produces a fallback-rendered frame and a red suite. Against R4.4 (zero flake
budget) that is disqualifying.

Replace the three `<link>` tags with `next/font/google`, which downloads at build time and serves
the files from the app's own origin. Independent of this suite, that also:

- removes a third-party request that leaks every visitor's IP to Google — directly relevant to the
  privacy posture in `.kiro/steering/security-and-context.md`;
- removes a render-blocking cross-origin stylesheet from the critical path;
- lets `next/font` subset and preload, and eliminates the swap reflow (a real CLS win).

Add a `docs/DECISIONS.md` entry: fonts move to build-time self-hosting, with a "revisit if" clause
for adding a family that `next/font/google` does not carry.

**Fallback if the maintainer rejects the app change:** keep the `<link>` tags, have the visual lane
block `fonts.googleapis.com` / `fonts.gstatic.com` via `page.route` and pin a local font stack with
`screenshot.css`. This is strictly worse — the baselines then show a face that production never
renders — and it is recorded here only so the trade-off is explicit.

## 4. Prerequisite: honour reduced motion in charts

`globals.css:240-253` already kills every CSS transition and animation under both
`:root.reduce-motion` and `@media (prefers-reduced-motion: reduce)`. Recharts animates in
JavaScript, so it ignores both and keeps animating for a user who asked for no motion. That is an
accessibility inconsistency independent of testing.

Add a `useReducedMotion()` hook that reads `window.matchMedia('(prefers-reduced-motion: reduce)')`
**and** the `reduce-motion` class the theme provider sets (`theme-provider.tsx:87`), and pass
`isAnimationActive={!reduced}` to every `<Area>`. The visual lane then sets
`reducedMotion: 'reduce'` in `use` and gets a statically-rendered chart with no test-only code
in the production bundle.

If the chart still proves unstable after this, fall back to masking the plot area via
`mask: [page.getByTestId('traffic-chart')]` and record the lost coverage in the spec header.

## 5. The `stabilise()` contract

One helper, called by every spec immediately before every screenshot. Order matters.

```
seedAppearance(page)      // addInitScript: snapurl.appearance = {mode, accent:'Cobalt',
                          //   density:'1', radius:'9px', reduceMotion:true}   (#16, #17)
page.clock.setFixedTime(VISUAL_EPOCH)                                          // (#3,4,7,8)
seedSession(page)         // existing e2e/support/session.ts, authed routes only
goto(route)
await stabilise(page):
  1. expect(skeletons).toHaveCount(0)        // content actually loaded        (#12, #26)
  2. expect(toasts).toHaveCount(0)                                            // (#13)
  3. if chart present: expect(chart path).toBeVisible()                       // (#10)
  4. if QR present:    expect(qr svg).not.toBeEmpty()                         // (#21)
  5. await document.fonts.ready
  6. await 2 × requestAnimationFrame          // layout + RO effects flushed  (#19)
```

`VISUAL_EPOCH` is a fixed UTC instant (e.g. `2026-01-15T09:00:00Z`) exported as a named constant
with a comment explaining that changing it rewrites every baseline.

Note the existing `e2e/support/` has **no** settle helper today — `stabilise()` is new, and it is
the single most important artefact in this spec.

## 6. Config sketch

```ts
// e2e/playwright.visual.config.ts
const PORT = 3100;  // NOT 3000 — the fixtures and mocked-api lanes share that port
export default defineConfig({
  testDir: "./visual",
  snapshotPathTemplate: "{testDir}/__screenshots__/{projectName}/{testFileName}/{arg}{ext}",
  fullyParallel: false,
  retries: 0,              // a visual failure is a finding, never retried away
  workers: 1,
  forbidOnly: !!process.env.CI,
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: "en-US",            // (#5, #6)
    timezoneId: "UTC",          // (#5)
    reducedMotion: "reduce",    // (#9 — with the §4 change)
    deviceScaleFactor: 1,
  },
  expect: {
    toHaveScreenshot: {
      animations: "disabled",   // (#12) Playwright fast-forwards CSS animations
      caret: "hide",
      scale: "css",
      stylePath: "./visual/screenshot.css",   // hides scrollbars (#20)
      maxDiffPixelRatio: 0.002,               // absorbs antialiasing (#11), not layout
    },
  },
  projects: [
    { name: "desktop",      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, colorScheme: "light" } },
    { name: "tablet",       use: { ...devices["Desktop Chrome"], viewport: { width: 768,  height: 1024 }, colorScheme: "light" } },
    { name: "mobile",       use: { ...devices["Pixel 7"], colorScheme: "light" } },   // touch ctx — covers (#15)
    { name: "desktop-dark", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, colorScheme: "dark" }, testMatch: /(marketing|app-links|app-analytics)/ },
    { name: "webkit",       use: { ...devices["Desktop Safari"], viewport: { width: 1440, height: 900 }, colorScheme: "light" }, testMatch: /(marketing|auth|app-links|app-team|public)/ },
  ],
  webServer: {
    command: `pnpm --filter snapurl-web exec next build && pnpm --filter snapurl-web exec next start --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
    env: { NEXT_PUBLIC_USE_FIXTURES: "true", SNAPURL_ALLOW_UNCONFIGURED_BUILD: "true" },
  },
});
```

`maxDiffPixelRatio: 0.002` is a starting point: at 1440×900 that tolerates ~2 600 pixels, enough for
glyph antialiasing but far too small to hide a shifted element. Tune it during bring-up with the
real twice-in-a-row numbers from R3.6 — do not raise it to silence a genuine diff.

## 7. CI job

```yaml
  visual:
    name: Visual regression (fixtures, containerised)
    needs: changes
    if: needs.changes.outputs.code == 'true'
    runs-on: ubuntu-latest
    timeout-minutes: 25
    container:
      image: mcr.microsoft.com/playwright:v1.63.0-noble   # must match @playwright/test
      options: --ipc=host                                 # Chromium shared-memory headroom
    steps: checkout → pnpm/action-setup → setup-node@22 → install → build:packages
           → pnpm --filter snapurl-e2e test:visual
           → upload-artifact (if: !cancelled()) e2e/playwright-report-visual/
```

Notes:

- The image already carries the browsers at `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright`, so the
  version-keyed cache and the two `playwright install` steps that the `e2e` job needs
  (`verify.yml:842-856`) are all **dropped** here. The image tag *is* the pin.
- **This is the first `container:` job in the repo.** Expect bring-up friction: `setup-node`'s pnpm
  cache path, and the container running as root.
- Add `visual` to `ci-gate`'s `needs` list (`verify.yml:1037`) — that one-line edit is all that is
  required to make it a required check; the gate's node script iterates whatever is in `needs` and
  treats `success` and `skipped` as passing.
- Uploading the report is consistent with the existing `e2e` job (`verify.yml:868-877`) and safe
  here *because* the lane is fixtures-only: no real data can appear in a diff image. The
  no-artifact rule in `qa-lab.yml:5-12` exists for runs that drive real data; it does not apply.
- Keep the image tag and `e2e/package.json`'s `@playwright/test` version in lockstep. A Dependabot
  bump to one without the other silently invalidates every baseline. Worth a `scripts/` assertion
  or a comment at both sites.

## 8. Baseline lifecycle

Regenerate through the same image, never on the host:

```sh
# scripts/visual-baselines.sh
docker run --rm --ipc=host -v "$PWD":/w -w /w \
  mcr.microsoft.com/playwright:v1.63.0-noble \
  sh -c 'corepack enable && pnpm install --frozen-lockfile && pnpm build:packages \
         && pnpm --filter snapurl-e2e exec playwright test -c playwright.visual.config.ts --update-snapshots'
```

Docker owns the process lifetime, so nothing long-lived is ever a child of the agent's shell —
the same reason `.kiro/steering/session-hygiene.md` prefers `pnpm staging:up`. Give the call an
explicit long timeout; it includes a full Next.js production build.

The review step is not optional (R2.1): the PR that adds or changes a baseline must state that the
images were viewed, and `git diff --stat` on `__screenshots__/` is the list to review.

## 9. Known coverage gaps, stated up front

- Empty states are unreachable in fixtures mode — the dataset is always populated. Those live in
  the `mocked-api` lane (`e2e/mocked-api/empty-states.spec.ts` already models the viewport matrix
  this design borrows). A future phase could add a visual project there.
- `/p/[slug]` never 404s under fixtures: `previewFor()` falls back to `LINKS[0]` for an unknown
  slug (`fixtures.ts:541-542`). The not-found rendering is therefore not covered.
- Three of the four fixture bio pages have `blocks: []`, so only `/b/acme` exercises a populated
  bio page.
- Firefox is not covered at all.
- Chart *plot* fidelity depends on §4 landing; if it is masked instead, chart rendering is uncovered.

### 9.1 Bug-injection gate results (issue #872, qa-oracles.md §4)

The suite was proven to fail by injecting known visual defects one at a time on a
throwaway branch (nothing merged), each isolated (file-backup revert) against a
clean control run (87 passed, 0 diffs). Full evidence and run links are in the
#872 PR. Results:

| # | Injected defect | Caught? | Caught by |
|---|---|---|---|
| 1 | `--density` multiplier `7px`→`14px` (app-shell padding) | ✅ | app routes on every viewport; drawers |
| 2 | light `--surface` `#ffffff`→`#e8edf3` (near-white grey) | ❌ *(sub-threshold)* | — |
| 3 | footer `flex-col sm:flex-row`→`flex-row` | ✅ | **mobile only** |
| 4 | sidebar/mobile-nav breakpoint `lg`→`xl` | ❌ *(no render change at the 3 viewports)* | — |
| 5 | remove `tap-target` `min-height/width: 44px` | ✅ | **mobile + tablet, NOT desktop** ✓ |

Injection 5 confirms the viewport projects are correctly scoped: the rule is
`@media (max-width: 1023.98px)`, and only mobile (390) and tablet (768) caught
it — desktop (1440) did not, exactly as required.

**The two uncaught injections are characterized properties, not route/viewport
blind spots — recorded here rather than papered over:**

- **Injection 2 is a comparator-threshold property, not a gap.** Playwright's
  per-pixel YIQ comparator tolerates imperceptible colour shifts (this is what
  absorbs antialiasing). `#ffffff`→`#e8edf3` is below that threshold so no pixel
  counts as different. **Verified it is NOT a coverage hole:** re-injecting a
  *meaningful* colour change (`--surface`→`#ff0000`) reds 86 of 87 targets across
  all three viewports. So the gate catches any real colour regression; only a
  sub-perceptual shift slips through, which is the intended antialiasing
  tolerance, not missing coverage.
- **Injection 4 produces no rendered change at the three chosen viewports.**
  Tailwind `xl` is 1280px; raising the sidebar/MobileNav swap from `lg` (1024) to
  `xl` only changes rendering in the 1024–1279px band, which none of
  390 / 768 / 1440 occupies (desktop 1440 ≥ 1280 still shows the sidebar; tablet
  768 and mobile 390 were already below `lg` showing MobileNav). The suite is
  therefore blind to regressions confined to the **1024–1279px band** — a real
  gap, left unclosed deliberately: a fourth "small-desktop" viewport would double
  the baseline weight (no Git LFS, §10) for a narrow band, so it is recorded here
  rather than added. Revisit alongside the T7 viewport expansion.

Injection 3 (footer) was caught by mobile only, not tablet, because
`flex-col sm:flex-row` only differs below Tailwind `sm` (640px); tablet (768) and
desktop (1440) both render the row layout already, so there is nothing for them
to catch. That is correct behaviour for this specific change, not a gap.

## 10. Risks

| Risk | Mitigation |
|---|---|
| Baseline churn makes every UI PR noisy | Viewport-clipped shots over `fullPage`; curated dark/WebKit subsets; a review question on every new baseline |
| Repo weight, no LFS (R4.1) | ~110 PNGs, 20-50 MB initially, and git keeps every superseded version. Measure after phase 1 and reconsider scope before adding WebKit |
| First `container:` job in the repo | Bring it up as its own PR with a single smoke spec before any baseline lands |
| Suite passes while UI is broken | The bug-injection gate (R3.15) is the only evidence that it can fail |
| Playwright/image version drift | Lockstep rule in §7 |

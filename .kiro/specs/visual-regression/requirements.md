# Visual regression suite — requirements

Status: proposed, not started. Target: `web/` (Next.js dashboard + marketing pages).
Owner: maintainer. Derived from the gap analysis in session 2026-10-30.

## 1. Why this exists

`grep -rn 'toHaveScreenshot\|toMatchSnapshot' e2e web/src` returns **zero matches**. Nothing in the
repo asserts on appearance. Every layout, spacing, colour-token and responsive regression is
currently caught only by a human looking at the page, or by an agent QA session that happens to
screenshot the right route. The 2026-10-02 frontend review found 33 findings, ~28 of which were
confirmed; several (`team-role-editor-layout`, `drawer-narrow-layout`,
`scrollable-region-focusable`, `#859` "Team row actions unreachable on narrow screens") are
**purely visual/layout** defects that a pixel baseline would have caught on the PR that introduced
them.

## 1a. Where this spec departs from the one-paragraph plan, on purpose

The original recommendation read: "every page at three viewports, in Chromium and WebKit … mask
the parts that change, like dates, charts and QR codes." This spec does it differently in two places:

- **Dates are frozen, not masked.** `page.clock.setFixedTime` before navigation makes the fixture
  data itself fixed (`fixtures.ts:59` `daysAgo()` reads `Date.now()`). Date text, relative-time
  labels, the footer year and chart axes then render identically, **and stay under test**. A mask
  would hide a broken date format. Charts are stabilised (reduced motion, #868) and QR codes are
  waited for, not masked. Masking is the fallback for anything that still flakes, and every mask
  must name what it hides (R3.7).
- **WebKit covers a curated subset, not every page.** WebKit needs its own full baseline set. ~84
  more PNGs roughly doubles repo weight in a repo with no Git LFS (R4.1). #873 makes the call after
  #870 has measured the real weight. "WebKit on every page" stays an option at that point, not a
  default.

## 1b. Sprint mapping

T1 #867, T2 #868 → Sprint 1 · T3 #869, T4 #870 → Sprint 2 · T5 #871 → Sprint 3 ·
T6 #872, T7 #873 → Sprint 4. Program index: `.kiro/specs/README.md`.

## 2. What a screenshot baseline is, and is not — read this first

`.kiro/steering/qa-oracles.md` §1 forbids deriving an expected value by reading the implementation.
A screenshot baseline is **generated from the implementation**, so on its own it is not an oracle.
It is a **change detector**: it answers "did this PR alter the rendering?" and nothing else.

This has three binding consequences:

- **R2.1** Every baseline MUST be reviewed by a human once, at the moment it is created or updated,
  and that approval is the oracle. A baseline committed without someone looking at the image
  freezes whatever the UI did that day, bugs included.
- **R2.2** A baseline diff is **not** a defect report. It is a prompt to look. The reviewer decides
  whether the UI regressed, the change was intended, or the harness is unstable. A visual-suite
  failure therefore does not go through the `findings.jsonl` adjudication path in qa-oracles §2 —
  it is a CI failure on a PR, resolved by the PR author and reviewer.
- **R2.3** The repository currently has **44 open UI/UX findings** (epic #743) and the confirmed
  defects from `.qa-runs/2026-10-02-frontend-review/adjudication.md`. Baselines captured today
  encode those defects as "expected". That is acceptable — the suite's job is to stop *new* drift —
  but it MUST be stated in the spec file header so nobody mistakes a green visual run for "the UI
  is correct".

## 3. Functional requirements

### Coverage

- **R3.1** Cover every user-reachable route in `web/src/app/` that renders without a server-side
  dependency: 7 marketing pages (`/`, `/product`, `/pricing`, `/self-host`, `/for-developers`,
  `/privacy`, `/terms`), 6 auth pages (`/login`, `/register`, `/forgot-password`,
  `/reset-password`, `/verify-email`, `/invite`), 12 authenticated routes (`/links`, `/links/[id]`,
  `/analytics`, `/conversions`, `/qr`, `/bio`, `/forms`, `/domains`, `/team`, `/developers`,
  `/settings`, `/reports`), and 3 public dynamic pages (`/p/[slug]`, `/f/[slug]`, `/b/[slug]`).
  That is **28 route targets**.
- **R3.2** Capture each route at three viewport widths that straddle the app's real breakpoints
  (Tailwind v4 defaults, no config override): **390×844** (mobile, below `sm` 640), **768×1024**
  (tablet, between `sm` and `lg`), **1440×900** (desktop, above `lg` 1024). The `lg`/1024 line is
  where `app-shell` swaps the sidebar for a drawer (`web/src/components/app-shell/index.tsx:225`,
  `:282`) and where `tap-target` grows controls (`web/src/app/globals.css:286`), so all three sides
  of that boundary must be covered.
- **R3.3** Cover both colour schemes on a curated subset, not on every route. Dark mode is a
  token swap (`globals.css:110`, `:163`), so a handful of representative pages proves the token
  set; doubling all 84 shots for dark mode is not worth the baseline churn.
- **R3.4** Cover **Chromium** on all targets, and **WebKit** on a curated desktop subset (~10
  routes). WebKit on Linux rasterises text differently from Chromium, so it needs its own baseline
  set; applying it to all 84 targets would double maintenance for a thin marginal catch.
- **R3.5** Cover the high-value *interactive* states that a page-level shot misses: the create-link
  drawer, the mobile nav drawer open, the QR panel, and a table in its overflow state. These are
  where the known layout defects clustered.

### Determinism

- **R3.6** Two consecutive runs of the suite on unchanged code MUST produce zero diffs. This is the
  acceptance test for the harness and MUST be demonstrated (run the suite twice, second run green)
  before any baseline is committed.
- **R3.7** The suite MUST neutralise every nondeterminism source catalogued in `design.md` §2.
  Anything that cannot be neutralised MUST be masked, and every mask MUST carry a comment naming
  what it hides and why, so a mask is never silently hiding a regression.
- **R3.8** The suite MUST NOT create, edit or delete fixture data. Fixture write paths generate
  random slugs and ids (`web/src/lib/api/fixtures.ts:959`, `:1097`, `:1127`, `:626`) which render
  as visible text. Visual specs are read-only.

### Environment

- **R3.9** Baselines MUST be generated and compared in the **same container image**, pinned to the
  same version as `@playwright/test` (currently `1.63.0`). Playwright's own guidance is to run in
  the environment the baselines came from. Bare-runner baselines are not reproducible on a
  developer machine and will produce permanent false diffs.
- **R3.10** A developer MUST be able to regenerate baselines locally with one command that uses
  that identical image, without hand-starting a long-lived server (`.kiro/steering/session-hygiene.md`).
- **R3.11** The suite runs in **fixtures mode** (`NEXT_PUBLIC_USE_FIXTURES=true`). This is a
  deliberate exception to `qa-oracles.md` §5 ("never QA against fixtures"), justified because
  (a) the thing under test is rendering, not backend behaviour, (b) fixtures give a fixed dataset,
  which a live database cannot, and (c) no real or personal data can end up in a committed PNG in
  a public repo. §5's prohibition targets functional QA, which this suite does not attempt.

### CI

- **R3.12** The suite MUST run on every PR that touches `web/`, `packages/contract`, or `e2e/`, and
  MUST become a required gate via `ci-gate`'s `needs` list (`.github/workflows/verify.yml:1037`).
- **R3.13** On failure CI MUST upload the Playwright HTML report containing expected/actual/diff
  images, so the reviewer can see the diff without reproducing locally.
- **R3.14** All suite files and baselines MUST live under `e2e/`, so the `non_e2e` path filter
  (`verify.yml:56-58`) keeps an e2e-only PR out of the `coverage-delta` gate, which has no meaning
  for Playwright.
- **R3.15** The suite MUST be proven to fail before it is trusted, per `qa-oracles.md` §4: inject
  known visual defects one at a time, show the suite goes RED for each, revert every injection.

## 4. Non-functional requirements and limits

- **R4.1 Repository weight.** ~84 Chromium targets + ~10 WebKit + ~15 state/dark shots ≈ **110
  PNGs**. At 1440px full-page these can run 200-500 KB each, so the first baseline set is roughly
  **20-50 MB**, and every intentional UI change rewrites some of them — git keeps both versions
  forever and the repo has **no Git LFS**. Mitigations are mandatory, not optional:
  viewport-clipped shots rather than `fullPage` wherever the below-fold content is covered by
  another target; `maxDiffPixelRatio` instead of exact equality; and a hard review question on
  every PR that adds a baseline ("is this target already covered?").
- **R4.2 CI time.** Budget ≤ 12 minutes for the Chromium lane including the Next.js production
  build. If it exceeds that, cut viewports before cutting routes.
- **R4.3 No new runtime dependency.** `toHaveScreenshot` is built into `@playwright/test`. No
  hosted service (Chromatic, Percy, Argos) is introduced; per `.kiro/steering/architecture.md` that
  would need an ADR, and it would also put rendered app data on a third party.
- **R4.4 Flake budget: zero.** A visual suite that flakes gets ignored, and an ignored gate is worse
  than no gate because it trains people to re-run CI until it passes. If a target cannot be made
  stable, delete the target.

## 5. Out of scope

- Cross-browser coverage on Firefox.
- Real-backend visual testing. The real-stack lane is `e2e/journeys/` and stays functional.
- Component-level (Storybook-style) snapshots. No Storybook exists in the repo.
- Accessibility assertions. Already covered by `e2e/a11y/` and `@axe-core/playwright`.
- Replacing the human release pass. A pixel baseline cannot tell you a screen is confusing.

## 6. Acceptance criteria

1. `pnpm --filter snapurl-e2e test:visual` runs green twice in a row on unchanged code (R3.6).
2. Every committed baseline was viewed by the maintainer, recorded in the PR description (R2.1).
3. The `visual` job is in `ci-gate`'s `needs` list and fails the PR on an unapproved diff (R3.12).
4. The bug-injection gate caught every injected defect, with the result table in the PR (R3.15).
5. A developer can regenerate all baselines with one documented command (R3.10).
6. `docs/TESTING.md` (or equivalent) explains how to read a diff and how to approve a new baseline.

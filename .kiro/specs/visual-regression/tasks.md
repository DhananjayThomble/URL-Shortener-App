# Visual regression suite — tasks

Seven PRs, in dependency order. Each is one GitHub issue. Do not combine them: the container job
and the first baseline set each carry enough risk to deserve an isolated, revertable PR.

Tracking epic: **#866**. Task issues: T1 #867 · T2 #868 · T3 #869 · T4 #870 · T5 #871 · T6 #872 ·
T7 #873. Sprints: T1, T2 → 1 · T3, T4 → 2 · T5 → 3 · T6, T7 → 4 (see `.kiro/specs/README.md`).

Port note: `e2e/playwright.webkit.config.ts` also defaults to 3100. The visual lane runs inside its
container's own network namespace, so the two never collide in CI or through
`scripts/visual-baselines.sh`. Running both on the host at once would collide.

Legend: `[ ]` not started · `[~]` in progress · `[x]` done

---

## T1 — Self-host the webfonts via `next/font`
**Blocks everything.** Row #1 in `design.md` §2. Issue label: `FrontEnd`, `performance`.

- [ ] Replace the three `<link>` tags in `web/src/app/layout.tsx:16-23` with `next/font/google`
      for Archivo, Public Sans and IBM Plex Mono, keeping the same weights
      (Archivo 500/600/700/800, Public Sans 400/500/600, IBM Plex Mono 400/500/600).
- [ ] Wire the generated CSS variables to the existing `--font-sans` / `--font-display` /
      `--font-mono` tokens (`web/src/app/globals.css:192`, `:221`) so no component changes.
- [ ] Drop the now-dead `preconnect` hints to `fonts.googleapis.com` / `fonts.gstatic.com`.
- [ ] Confirm the production build emits the font files locally and no request leaves the origin
      (check the network panel, or grep the built output for `fonts.gstatic.com`).
- [ ] Add a `docs/DECISIONS.md` entry: build-time self-hosted fonts, rationale (determinism,
      privacy, no render-blocking third party), with a "revisit if" clause for a family
      `next/font/google` does not carry.
- [ ] Verify: `pnpm type-check`, `pnpm build`, `pnpm --filter snapurl-e2e test:e2e`.

**Done when:** the app renders identically with no network request to Google, and DECISIONS records
the choice.

---

## T2 — Honour reduced motion in the charts
Row #9. An accessibility fix that happens to unblock stable chart screenshots.
Issue label: `FrontEnd`, `UI/UX`.

- [ ] Add a `useReducedMotion()` hook reading **both** `window.matchMedia('(prefers-reduced-motion:
      reduce)')` and the `reduce-motion` class the theme provider sets
      (`web/src/components/theme/theme-provider.tsx:87`), reacting to changes in either.
- [ ] Pass `isAnimationActive={!reduced}` to every `<Area>` in
      `web/src/components/charts/index.tsx:120-132`.
- [ ] Unit-test the hook both ways (class set / media query set) in `web/`.
- [ ] Verify: `pnpm --filter snapurl-web test`, `pnpm type-check`.

**Done when:** with reduced motion requested, the traffic chart renders at its final state with no
mount animation, and a test proves it.

---

## T3 — The harness: config, `stabilise()`, container, one smoke spec
No baselines yet. This PR proves the mechanism and brings up the repo's first `container:` job's
image locally. Issue label: `agent:tests`, `infra`.

- [ ] `e2e/playwright.visual.config.ts` per `design.md` §6 — port **3100**, pinned `locale`,
      `timezoneId`, `reducedMotion`, `deviceScaleFactor`, `snapshotPathTemplate`, `retries: 0`,
      and the five projects.
- [ ] `e2e/visual/_helpers.ts`: `VISUAL_EPOCH`, `seedAppearance()`, `stabilise()` implementing the
      six ordered steps in `design.md` §5. Comment each step with the table row it defends.
- [ ] `e2e/visual/screenshot.css`: hide scrollbars (row #20). Every rule needs a comment naming
      what it neutralises.
- [ ] `scripts/visual-baselines.sh` per `design.md` §8, Docker-managed, with a usage comment.
- [ ] `test:visual` and `test:visual:update` scripts in `e2e/package.json`.
- [ ] One smoke spec: `/` at the desktop project only.
- [ ] **Bring-up checks, recorded in the PR body:**
  - [ ] Run the suite twice in a row inside the container — second run green, zero diffs (R3.6).
  - [ ] Report the actual diff-pixel count of a no-op run, and set `maxDiffPixelRatio` just above
        it rather than keeping the guessed `0.002`.
  - [ ] Confirm the image renders colour emoji (row #24) — the `BarList` country flags are the
        tell. If not, add a font package to the lane.
  - [ ] Confirm whether scrollbars take layout space in this image, and whether the chosen viewport
        widths sit clear of `TableWrap`'s overflow flip threshold (rows #19, #20).

**Done when:** one baseline exists, regenerates reproducibly through the script, and the twice-green
evidence is in the PR.

---

## T4 — Baselines, phase 1: Chromium, 28 routes × 3 viewports
The bulk of the work. Issue label: `agent:tests`.

- [ ] `marketing.spec.ts` — `/`, `/product`, `/pricing`, `/self-host`, `/for-developers`,
      `/privacy`, `/terms` (signed-out chrome; row #18).
- [ ] `auth.spec.ts` — `/login`, `/register`, `/forgot-password`, plus `/reset-password`,
      `/verify-email`, `/invite` with a fixed non-empty `?token=`.
- [ ] `app-*.spec.ts` — the 12 authenticated routes via `seedSession()`, split across a few files
      so one failure does not obscure the rest. Use `lnk_spring` for `/links/[id]`: it is the
      richest fixture (routing rules, UTM, social card, password, tags, folder, expiry).
- [ ] `public.spec.ts` — `/p/spring-sale` (password-protected), `/f/spring-feedback` (live form),
      `/b/acme` (the only populated bio page).
- [ ] Decide `fullPage` per target and justify it: default to viewport-clipped, use `fullPage`
      only where below-fold content is not covered by another target (R4.1).
- [ ] Generate baselines through `scripts/visual-baselines.sh`.
- [ ] **Review every image before committing** (R2.1) and say so in the PR body. Note any
      already-known defect a baseline freezes, cross-referencing epic #743.
- [ ] Record the real repo-weight number (`du -sh e2e/visual/__screenshots__`) in the PR.

**Done when:** ~84 reviewed baselines are committed and the suite is green twice in a row.

---

## T5 — CI wiring
Changes a workflow, so it needs maintainer merge. Issue label: `agent:infra`, `needs-human`, `infra`.

- [ ] Add the `visual` job to `.github/workflows/verify.yml` per `design.md` §7 — containerised on
      `mcr.microsoft.com/playwright:v1.63.0-noble`, `--ipc=host`, `timeout-minutes: 25`, gated on
      `needs.changes.outputs.code == 'true'`.
- [ ] Upload `e2e/playwright-report-visual/` with `if: ${{ !cancelled() }}`, `retention-days: 7`,
      matching the existing `e2e` job's shape (R3.13).
- [ ] Add `visual` to `ci-gate`'s `needs` list (`verify.yml:1037`).
- [ ] Add a comment at both the image tag and `e2e/package.json`'s `@playwright/test` pin stating
      they must move together, and tell Dependabot about the pair (grouped update or an explicit
      note in `.github/dependabot.yml`).
- [ ] Confirm `actionlint` passes (it gates on the `workflows` path filter and will run on this PR).
- [ ] Verify an e2e-only PR still leaves `non_e2e` false so `coverage-delta` skips (R3.14).

**Done when:** the job runs on a PR, fails on an unapproved diff with a downloadable report, and is
required via `ci-gate`.

---

## T6 — Bug-injection gate
Required by `.kiro/steering/qa-oracles.md` §4. Until this is done the suite is **not trusted**.
Throwaway branch, nothing merged from it. Issue label: `qa-program`, `agent:tests`.

- [ ] Inject, one at a time, and record caught / not caught plus which target caught it:
  - [ ] change a spacing token (e.g. the sidebar's `--density` multiplier at `app-shell/index.tsx:66`)
  - [ ] change one colour token in `globals.css` (light theme only)
  - [ ] flip a `flex-col sm:flex-row` to always-row (`site-footer.tsx:77`)
  - [ ] raise the `lg` sidebar breakpoint so the drawer shows at desktop width
  - [ ] remove the `tap-target` min-height rule (`globals.css:286`) — must be caught by mobile,
        not desktop
  - [ ] shift one table column's width so `TableWrap` overflow flips (rows #19, #20)
- [ ] Revert every injection; confirm the branch is discarded.
- [ ] Post the results table on the issue. A defect nothing caught is a coverage gap to fix or to
      document in `design.md` §9.

**Done when:** the table is posted and every uncaught injection has either a new target or a
recorded gap.

---

## T7 — WebKit lane and the dark subset
Last, because it roughly doubles baseline count for the covered routes. Only after T4's weight
number is known. Issue label: `agent:tests`.

- [ ] Enable the `webkit` and `desktop-dark` projects on the curated `testMatch` subsets.
- [ ] Generate and review those baselines.
- [ ] Re-measure repo weight; if the total has grown past roughly 60 MB, cut targets rather than
      accepting the growth.
- [ ] Document in `docs/TESTING.md`: how to read a diff, how to approve a new baseline, and the
      R2.1 rule that an unreviewed baseline is worthless.

**Done when:** both lanes are green twice in a row and the contributor docs explain the workflow.

---

## Dependency order

```
T1 ─┐
T2 ─┴─> T3 ─> T4 ─> T5 ─> T6 ─> T7
```

T1 and T2 are independent of each other and can go in parallel. Nothing after T3 can start before
the twice-green evidence exists.

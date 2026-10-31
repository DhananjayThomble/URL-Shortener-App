# Testing — the visual-regression lane

This document is the contributor guide for SnapURL's **visual-regression suite**:
the fifth Playwright lane that catches unintended UI pixel changes. It was built
across issues #869 (harness), #870 (phase-1 baselines), #871 (required CI gate),
#872 (bug-injection proof) and #873 (WebKit + dark lanes, these docs).

For the other Playwright lanes (fixtures e2e, mocked-api, journeys, a11y) and
the backend/contract suites, see `docs/ARCHITECTURE.md` and
`.kiro/steering/qa-oracles.md`.

---

## What the lane is

- **Config:** `e2e/playwright.visual.config.ts`.
- **Specs + helper:** `e2e/visual/` — `_helpers.ts` holds `stabilise()` (the
  determinism contract) plus `VISUAL_EPOCH`, `seedAppearance()` and
  `captureRoute()`; the `*.spec.ts` files capture one route each.
- **Baselines:** `e2e/visual/__screenshots__/<project>/<file>/<name>.png`,
  committed and reviewed.
- **Projects (viewports/engines):**
  - `desktop` 1440×900, `tablet` 768×1024, `mobile` 390×844 (touch) — Chromium,
    **full route set**.
  - `desktop-dark` 1440×900 dark — Chromium, **subset** (marketing + app-core).
  - `webkit` 1440×900 — WebKit, **subset** (marketing + auth + public).
- **Scope:** fixtures mode only (`NEXT_PUBLIC_USE_FIXTURES=true`), so no real or
  personal data can ever appear in a diff image. Do **not** point this lane at
  the real stack.

The dark and WebKit lanes are deliberately curated subsets, not full matrices:
WebKit on Linux rasterises text differently from Chromium and dark mode is a
token swap, so a handful of representative pages proves each without doubling
maintenance (and repo weight — see below) for every route.

## How to run it

Always run through the **pinned container**, never on the host — baselines are
font- and platform-dependent, and only the container reproduces the environment
CI compares in.

```sh
# Compare against committed baselines (what CI does):
bash scripts/visual-baselines.sh --help   # (reads the image + usage)
# or directly, the same image CI uses:
docker run --rm --ipc=host -e CI=true -v "$PWD":/w -w /w \
  mcr.microsoft.com/playwright:v1.63.0-noble@sha256:eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27 \
  sh -c 'corepack enable && pnpm install --frozen-lockfile && pnpm build:packages \
         && pnpm --filter snapurl-e2e test:visual'
```

In CI this is the **Visual regression (fixtures, containerised)** job in
`.github/workflows/verify.yml`, a required check via `ci-gate`'s `needs` list.
A `git push` of a UI change that moves pixels without an updated baseline reds
that job and therefore the gate.

> Never run the suite on the bare host for baseline purposes: host fonts and
> rasterisation differ from the container and the baselines will not reproduce.

## How to read a diff from the CI artifact

When the visual job fails, it uploads **`playwright-report-visual`** (the job's
"Upload Playwright report" step; artifacts tab of the run). Download it and open
the HTML report: each failing target shows three images — **expected** (the
committed baseline), **actual** (what this run rendered) and **diff** (the
highlighted pixels). That tells you exactly which route, which viewport/engine,
and which pixels changed, without reproducing locally.

## How to approve a new baseline

A baseline change is a deliberate act, not an automatic one.

1. Make your UI change.
2. Regenerate the affected baselines **in the container**:
   ```sh
   docker run --rm --ipc=host -e CI=true -v "$PWD":/w -w /w \
     mcr.microsoft.com/playwright:v1.63.0-noble@sha256:eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27 \
     sh -c 'corepack enable && pnpm install --frozen-lockfile && pnpm build:packages \
            && pnpm --filter snapurl-e2e test:visual:update'
   ```
3. **Look at every changed image.** `git diff --stat -- e2e/visual/__screenshots__`
   is the list; open each one and confirm the change is what you intended.
4. Commit the baselines **with** the code change, and state in the PR body that
   the images were reviewed.

### An unreviewed baseline is worthless

A baseline is a **change detector, not an oracle**: it is generated from the
implementation, so an unreviewed baseline just freezes whatever the UI did that
day — including a bug. **A green visual run does not mean the UI is correct; it
means nothing has changed since someone last looked.** Never update a baseline to
"make the suite pass" without looking at what moved and why. (This is the same
rule `.kiro/steering/qa-oracles.md` §4 states for every suite.)

## Trusting the suite — the bug-injection gate

Per qa-oracles.md §4, a suite is not trusted until it has been proven to fail.
`scripts/visual-bug-injection.sh` injects known visual defects one at a time on a
throwaway tree, shows the suite reds for each, and reverts them (nothing is ever
committed). The #872 run's results and its two documented limitations (a
sub-perceptual colour shift below the comparator threshold; a regression confined
to the 1024–1279px band that no active viewport occupies) are recorded in
`.kiro/specs/visual-regression/design.md` §9.1.

## Version lockstep — do not break it

The lane renders inside a container pinned **by digest**; its Playwright version
must match the npm pin, or every committed baseline is silently invalidated:

- **container image:** the `visual` job's `container.image` in
  `.github/workflows/verify.yml` and the `IMAGE=` in `scripts/visual-baselines.sh`
  (`mcr.microsoft.com/playwright:v1.63.0-noble@sha256:…`).
- **npm pin:** `e2e/package.json` → `"@playwright/test": "1.63.0"`.

When bumping Playwright, change **both** to the same version in the same PR,
re-resolve the image's `@sha256` digest for the new tag, and **regenerate the
baselines** in the new image (a version change legitimately moves pixels). A bump
to one alone must be held, not merged. The pairing is also recorded in
`.github/dependabot.yml`.

## Repo weight (no Git LFS)

There is **no Git LFS** in this repo — git keeps every superseded PNG forever, so
the baseline set's weight is a standing cost. Current size:

```
du -sh e2e/visual/__screenshots__   # ~12 MB for 113 baselines (as of #873)
```

Budget: if the total grows past ~60 MB, **cut targets** rather than accept the
growth. Prefer viewport-clipped shots over `fullPage`, and keep the dark/WebKit
lanes as curated subsets.

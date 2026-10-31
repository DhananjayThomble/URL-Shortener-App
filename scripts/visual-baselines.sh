#!/usr/bin/env bash
# =============================================================================
# Regenerate visual-regression baselines inside the pinned Chromium container.
# Issue #869 (harness) / #870 (baselines). Design: .kiro/specs/visual-regression
# /design.md §8.
#
# Baselines are font-stack and platform dependent (design §2 rows #2/#20/#24), so
# they MUST be generated in the same image CI compares against — never on the
# host. Docker owns the process lifetime, so nothing long-lived is ever a child
# of the caller's shell (the same reason .kiro/steering/session-hygiene.md
# prefers `pnpm staging:up`).
#
# The image is pinned BY DIGEST, not by the floating v1.63.0-noble tag, so a
# re-tag upstream can never silently change the rendering stack under the
# baselines. The tag is kept alongside the digest for human readability only.
# Keep this digest and e2e/package.json's @playwright/test version in lockstep:
# a bump to one without the other invalidates every baseline (design §7).
#
# Usage:
#   bash scripts/visual-baselines.sh            # update all baselines
#   bash scripts/visual-baselines.sh --project=desktop home-smoke.spec.ts
# Extra args are forwarded to `playwright test`.
# =============================================================================
set -euo pipefail

# mcr.microsoft.com/playwright:v1.63.0-noble — multi-arch index digest, resolved
# 2026-10-31. Selects the correct arch (amd64 CI runner / arm64 host) itself.
IMAGE="mcr.microsoft.com/playwright:v1.63.0-noble@sha256:eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "visual-baselines: regenerating in ${IMAGE}"
echo "visual-baselines: repo root ${REPO_ROOT}"

# --ipc=host gives Chromium the shared-memory headroom it needs (design §7).
# The container runs as root; corepack enable makes pnpm available from the
# packed packageManager field. A full Next.js production build runs inside, so
# this is slow — the caller should wrap it in a long timeout.
docker run --rm --ipc=host \
  -v "${REPO_ROOT}":/w -w /w \
  "${IMAGE}" \
  sh -c 'corepack enable \
    && pnpm install --frozen-lockfile \
    && pnpm build:packages \
    && pnpm --filter snapurl-e2e exec playwright test -c playwright.visual.config.ts --update-snapshots "$@"' \
  sh "$@"

echo "visual-baselines: done. Review e2e/visual/__screenshots__ with: git diff --stat -- e2e/visual/__screenshots__"

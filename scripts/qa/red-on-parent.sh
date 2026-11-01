#!/usr/bin/env bash
# Regression-backfill harness — prove a regression test fails on its fix's PARENT
# (spec: .kiro/specs/regression-rule/ R5, design §4; evidence in
# docs/qa/regression-backfill-901.md).
#
# Given a fix commit and the test file(s) it added, this checks out a detached
# worktree at the fix's PARENT, copies ONLY those test files from the fix onto
# the parent tree, and runs them there. A FAIL means the regression test has
# teeth; a PASS means it is a fake regression test (file a test-only issue).
#
# It never modifies the fix commit, main, or the committed tests: the files are
# copied from the fix into a throwaway /tmp worktree that is removed on exit.
#
# Usage:
#   scripts/qa/red-on-parent.sh <fix> <runner> <filter> <config-or-->  <testfile...>
#     <runner> = vitest | journey | mocked-api
#     <filter> = pnpm workspace filter (e.g. @snapurl/contract, snapurl-e2e)
#     <config-or--> = for playwright runners, the -c config path; "-" for vitest
#
# Examples:
#   # unit
#   scripts/qa/red-on-parent.sh 9102593 vitest @snapurl/contract - \
#       packages/contract/src/auth.test.ts
#   # mocked-api (no stack; builds its own web server on MOCKED_API_PORT)
#   scripts/qa/red-on-parent.sh f3c1a56 mocked-api snapurl-e2e \
#       playwright.mocked-api.config.ts \
#       e2e/mocked-api/table-row-actions.spec.ts e2e/support/row-actions.ts
#   # journey (needs `pnpm staging:up` already running; builds web from parent)
#   QA_PREBUILT_WEB=1 scripts/qa/red-on-parent.sh 57cc416 journey snapurl-e2e \
#       playwright.journeys.config.ts e2e/journeys/j849-bio-encoded-domain.spec.ts
#
# For a journey whose fix touches the API (e.g. #792), bring staging up from the
# PARENT worktree first so the api image is pre-fix; this script only builds web.
set -uo pipefail

FIX="$1"; RUNNER="$2"; FILTER="$3"; CONFIG="$4"; shift 4
FILES=("$@")

REPO_ROOT="$(git rev-parse --show-toplevel)"
PARENT="$(git -C "$REPO_ROOT" rev-parse "${FIX}^")"
WT="/tmp/rob-${FIX}"

cleanup() { git -C "$REPO_ROOT" worktree remove --force "$WT" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "### fix=$FIX parent=$PARENT runner=$RUNNER filter=$FILTER"
git -C "$REPO_ROOT" worktree add --detach "$WT" "$PARENT" >/dev/null 2>&1 \
  || { echo "WORKTREE_ADD_FAILED"; exit 2; }

for f in "${FILES[@]}"; do
  mkdir -p "$WT/$(dirname "$f")"
  git -C "$REPO_ROOT" show "${FIX}:${f}" > "$WT/$f" || { echo "COPY_FAILED $f"; exit 2; }
done

cd "$WT" || exit 2
pnpm install --frozen-lockfile >/dev/null 2>&1 || true
pnpm -w build:packages >/dev/null 2>&1 || true

run_vitest() {
  local specs=()
  for f in "${FILES[@]}"; do [[ "$f" == *.test.ts ]] && specs+=("src/${f#*/src/}"); done
  pnpm --filter "$FILTER" exec vitest run "${specs[@]}"
}
run_pw() {
  local specs=()
  for f in "${FILES[@]}"; do [[ "$f" == *.spec.ts ]] && specs+=("$(basename "$f")"); done
  [[ "$RUNNER" == journey && "${QA_PREBUILT_WEB:-}" == 1 ]] && export QA_WEB_PORT="${QA_WEB_PORT:-3000}"
  pnpm --filter "$FILTER" exec playwright test -c "$CONFIG" "${specs[@]}"
}

case "$RUNNER" in
  vitest) run_vitest ;;
  journey|mocked-api) run_pw ;;
  *) echo "UNKNOWN_RUNNER $RUNNER"; exit 2 ;;
esac
rc=$?

if [ "$rc" -eq 0 ]; then
  echo "VERDICT $FIX -> GREEN-ON-PARENT (NO TEETH — fake regression test, file an issue)"
else
  echo "VERDICT $FIX -> RED-ON-PARENT (has teeth)"
fi
# Exit 0: the harness ran successfully. The verdict line is the signal, not $?.
exit 0

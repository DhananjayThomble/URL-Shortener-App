#!/usr/bin/env bash
# =============================================================================
# Visual-suite bug-injection gate — issue #872, qa-oracles.md §4.
#
# "A suite is not trusted until it has been proven to fail." This script injects
# known visual defects ONE AT A TIME, runs the visual suite against the committed
# baselines, records caught / not-caught per injection, and REVERTS each — so the
# tree is left exactly as it started. Nothing from a run is ever committed.
#
# Run it INSIDE the pinned container, the same way baselines are generated
# (scripts/visual-baselines.sh), because git does NOT work inside that container
# (a worktree's .git points outside the bind mount) — so apply/revert here is by
# FILE BACKUP (cp), never by git:
#
#   docker run --rm --ipc=host -e CI=true -v "$PWD":/w -w /w \
#     mcr.microsoft.com/playwright:v1.63.0-noble@sha256:eff16c30e6f3f4af0a03fa4b706120d5e9b0891c344a27d64559aff5900a4a27 \
#     sh -c 'corepack enable && pnpm install --frozen-lockfile && pnpm build:packages \
#            && sh scripts/visual-bug-injection.sh'
#
# (Use the SAME digest as the `visual` CI job / scripts/visual-baselines.sh.)
#
# A control run with no injection must stay green; any injection that stays green
# is either a characterized comparator/breakpoint property or a coverage gap, and
# per §4 must be resolved (add a target or record it in design.md §9) — never
# left silent. The #872 run's findings are recorded in
# .kiro/specs/visual-regression/design.md §9.1.
# =============================================================================
set -u
cd "$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")/.." && pwd)"

F_SHELL=web/src/components/app-shell/index.tsx
F_CSS=web/src/app/globals.css
F_FOOT=web/src/components/marketing/site-footer.tsx

BK="$(mktemp -d)"
cp "$F_SHELL" "$BK/shell"; cp "$F_CSS" "$BK/css"; cp "$F_FOOT" "$BK/foot"
bk_for() { case "$1" in *app-shell*) echo "$BK/shell";; *globals.css) echo "$BK/css";; *site-footer*) echo "$BK/foot";; esac; }
restore_all() { cp "$BK/shell" "$F_SHELL"; cp "$BK/css" "$F_CSS"; cp "$BK/foot" "$F_FOOT"; }
trap restore_all EXIT

run_suite() {
  local out rc; out="$(pnpm --filter snapurl-e2e test:visual 2>&1)"; rc=$?
  echo "RC=$rc  $(printf '%s\n' "$out" | grep -E "[0-9]+ (passed|failed)" | tail -1)"
  if [ "$rc" -eq 0 ]; then
    echo "RESULT: NOT CAUGHT (suite stayed green) — resolve per qa-oracles §4"
  else
    echo "RESULT: CAUGHT. Per-project passed (total-passed = caught):"
    for p in desktop tablet mobile; do
      echo "  [$p] passed=$(printf '%s\n' "$out" | grep -E "✓ +[0-9]+ \[$p\]" | wc -l | tr -d ' ')"
    done
  fi
}

inject() { # label | file | sed -E expr
  echo "=== INJECTION: $1 ==="
  sed -i -E "$3" "$2"
  if cmp -s "$2" "$(bk_for "$2")"; then echo "RESULT: EDIT DID NOT APPLY"; echo; return; fi
  run_suite
  cp "$(bk_for "$2")" "$2"
  cmp -s "$2" "$(bk_for "$2")" && echo "revert OK" || echo "REVERT FAILED: $2"
  echo
}

echo "=== CONTROL (no injection — must be green) ==="; run_suite; echo

inject "INJ1 density 7px->14px (app-shell)" "$F_SHELL" \
  's/py-\[calc\(7px\*var\(--density\)\)\]/py-[calc(14px*var(--density))]/'
inject "INJ2 light --surface #ffffff->#e8edf3 (globals.css, subtle — see design §9.1)" "$F_CSS" \
  '0,/--surface: #ffffff;/s//--surface: #e8edf3;/'
inject "INJ3 footer flex-col sm:flex-row->flex-row (site-footer)" "$F_FOOT" \
  's/flex flex-col sm:flex-row items-start sm:items-center/flex flex-row items-center/'
inject "INJ4 sidebar+mobilenav lg->xl (app-shell, see design §9.1)" "$F_SHELL" \
  's/hidden lg:flex flex-col gap-\[5px\]/hidden xl:flex flex-col gap-[5px]/; s/<div className="lg:hidden">/<div className="xl:hidden">/'
inject "INJ5 remove tap-target min-height/width 44px (globals.css)" "$F_CSS" \
  '/@utility tap-target \{/,/^\}/{/min-height: 44px;/d; /min-width: 44px;/d;}'

echo "=== SWEEP COMPLETE (tree restored by trap) ==="

#!/usr/bin/env bash
# Regression test for issue #471: every direct entry point that consumes
# packages/*'s built dist/ — not just `pnpm dev:web` — must build
# packages/* first. packages/*/package.json `exports` maps point exclusively
# at ./dist/*, which does not exist on a fresh clone until `build:packages`
# runs, so a bare `pnpm --filter <project> <script>` bypasses the root
# scripts (`pnpm test`, `pnpm type-check`) that already build first.
#
#   bash scripts/dev-web-builds-packages.test.sh
#
# Covers two representative entry points:
#   1. `pnpm dev:web` — a real `next dev` server; the failure here was a
#      webpack "Module not found" that a type-check would not catch.
#   2. `pnpm --filter ./infra test` — the exact repro from the issue's
#      widening comment (vitest failing to resolve @snapurl/database).
set -uo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT" || exit 1

pass=0; fail=0
ok()  { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
bad() { fail=$((fail + 1)); printf '  FAIL %s\n' "$1"; [ -n "${2:-}" ] && printf '         %s\n' "$2"; }

# web/package.json hardcodes `next dev --port 3000`; `dev:web` does not
# accept a port override, so this test uses that fixed port.
PORT=3000
LOG=$(mktemp)
trap 'kill_server' EXIT

kill_server() {
  pkill -f "next dev --port $PORT" 2>/dev/null
  [ -n "${SERVER_PID:-}" ] && kill "$SERVER_PID" 2>/dev/null
  rm -f "$LOG"
}

# Simulate a fresh clone: no package build output anywhere.
rm -rf packages/*/dist

# web/package.json hardcodes port 3000 with no override; if something else is
# already listening there, assertion 1 would pass against that server
# instead of the one this test starts, and the rest of the run would be
# checking the wrong process. Fail fast and say so rather than continuing.
if curl -sS -o /dev/null "http://localhost:$PORT/" 2>/dev/null; then
  echo "FAIL precondition: port $PORT is already in use by another process"
  echo "         stop whatever is listening on $PORT and re-run"
  exit 1
fi

# Sanity check the precondition the bug depended on.
if [ -d packages/contract/dist ] || [ -d packages/domain/dist ]; then
  bad "precondition: packages/*/dist removed" "dist still present after rm -rf"
else
  ok "precondition: packages/*/dist removed"
fi

# Run the real script from package.json — not a hand-rolled equivalent — so a
# future edit to package.json is what this test actually guards.
pnpm dev:web >"$LOG" 2>&1 < /dev/null &
SERVER_PID=$!

deadline=$((SECONDS + 90))
up=0
status=""
while [ "$SECONDS" -lt "$deadline" ]; do
  status=$(curl -sS -o /tmp/dev-web-test-body.$$ -w '%{http_code}' "http://localhost:$PORT/login" 2>/dev/null)
  # curl prints "000" (not empty) on a connection failure, so "up" must be
  # gated on a real HTTP status, not merely on curl having produced output.
  if [ -n "$status" ] && [ "$status" != "000" ]; then
    up=1
    break
  fi
  sleep 1
done

if [ "$up" -eq 1 ]; then
  ok "pnpm dev:web served /login (status $status)"
else
  bad "pnpm dev:web served /login" "server never came up within 90s; log: $LOG"
fi

if [ -d packages/contract/dist ] && [ -d packages/domain/dist ]; then
  ok "build:packages ran before the dev server (dist present)"
else
  bad "build:packages ran before the dev server (dist present)" "packages/*/dist missing"
fi

# Checked on the response body whenever the server answered at all —
# regardless of HTTP status — because the failure mode this guards against is
# a 500 whose body names the missing module. A status-gated check here would
# pass vacuously on that exact failure (curl -f fails on a 500, "up" would be
# 0, and the body would never be inspected).
if [ "$up" -eq 1 ] && grep -q "Cannot resolve\|Can't resolve '@snapurl" /tmp/dev-web-test-body.$$ 2>/dev/null; then
  bad "no module-not-found error for @snapurl/*" "found in response body (status $status)"
else
  ok "no module-not-found error for @snapurl/*"
fi

rm -f /tmp/dev-web-test-body.$$

# Tear the dev server down explicitly before starting entry point 2. It was
# left running (and, on startup, still mid-build) by design so the first
# block above can probe it; leaving it alive here would let its own
# `build:packages` race against the one the next command triggers, both
# writing to the same packages/*/dist concurrently.
kill_server
SERVER_PID=""

# --- Entry point 2: `pnpm --filter ./infra test` -----------------------
# The exact repro from the issue's widening comment. Remove dist again (the
# dev:web run above rebuilt it) and run infra's test script directly, the
# way a contributor or reviewer would, bypassing the root `pnpm test`
# script that builds packages first.
rm -rf packages/*/dist

if pnpm --filter ./infra test >/tmp/infra-test.$$ 2>&1; then
  ok "pnpm --filter ./infra test (packages/*/dist absent beforehand)"
else
  bad "pnpm --filter ./infra test (packages/*/dist absent beforehand)" \
    "exit $?; see /tmp/infra-test.$$: $(tail -5 /tmp/infra-test.$$ | tr '\n' ' ')"
fi
rm -f /tmp/infra-test.$$

echo
echo "passed: $pass, failed: $fail"
[ "$fail" -eq 0 ]

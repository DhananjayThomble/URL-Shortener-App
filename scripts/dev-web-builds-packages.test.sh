#!/usr/bin/env bash
# Regression test for issue #471: `pnpm dev:web` (and `pnpm dev`) must build
# `packages/*` before starting the Next.js dev server, otherwise every route
# that imports `@snapurl/contract` or `@snapurl/domain/*` fails to resolve and
# the whole `(app)` layout 500s.
#
#   bash scripts/dev-web-builds-packages.test.sh
#
# This starts a real `next dev` server (via the `dev:web` script), so it is
# slower than a unit test, but the bug can only be observed through the
# module resolver at that layer — the failure was a webpack "Module not
# found", not a type error caught by `type-check`.
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
disown

deadline=$((SECONDS + 90))
up=0
while [ "$SECONDS" -lt "$deadline" ]; do
  if curl -fsS "http://localhost:$PORT/login" -o /tmp/dev-web-test-body.$$ 2>/dev/null; then
    up=1
    break
  fi
  sleep 1
done

if [ "$up" -eq 1 ]; then
  ok "pnpm dev:web served /login"
else
  bad "pnpm dev:web served /login" "server never came up within 90s; log: $LOG"
fi

if [ -d packages/contract/dist ] && [ -d packages/domain/dist ]; then
  ok "build:packages ran before the dev server (dist present)"
else
  bad "build:packages ran before the dev server (dist present)" "packages/*/dist missing"
fi

if [ "$up" -eq 1 ] && grep -q "Cannot resolve\|Can't resolve '@snapurl" /tmp/dev-web-test-body.$$ 2>/dev/null; then
  bad "no module-not-found error for @snapurl/*" "found in response body"
else
  ok "no module-not-found error for @snapurl/*"
fi

rm -f /tmp/dev-web-test-body.$$

echo
echo "passed: $pass, failed: $fail"
[ "$fail" -eq 0 ]

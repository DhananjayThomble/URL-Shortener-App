#!/usr/bin/env bash
# Cross-cutting assertion the unit tests and the other smoke scripts cannot make.
#
# Unit tests exercise rollupClicks() against a test database, and
# scripts/smoke-redirect.sh proves a click lands in click_events. Neither proves
# the end-to-end chain that only exists when the *composed* stack is running:
# a real redirect served by the redirect container writes a row that the *worker
# container's* rollup loop then folds into click_daily. That loop only runs in a
# live worker, on its own timer (ROLLUP_INTERVAL_SECONDS, default 30s), so it is
# structurally invisible to a single-process test. This script drives a real
# redirect through the redirect service and then waits for the worker to roll it
# up, asserting both halves.
#
#   usage: bash scripts/integration-assertions.sh
#
# Reads only the two service URLs and the database. Prints no secrets or env.
set -uo pipefail

API="${API:-http://localhost:3001/api/v1}"
RD="${RD:-http://localhost:3002}"
RUN="i$(date +%s)"
SLUG="$RUN-rollup"
EMAIL="integration-$(date +%s)@example.com"
PASS="a-long-enough-password-123"
PASSES=0; FAILS=0

ok()  { PASSES=$((PASSES+1)); echo "  PASS  $1"; }
bad() { FAILS=$((FAILS+1));  echo "  FAIL  $1"; echo "        $2"; }

# Reach the database whichever way this environment allows: psql directly when
# the client is installed (CI), or through the Compose container (local dev).
DB_URL="${DATABASE_URL:-postgres://snapurl:snapurl@localhost:5433/snapurl}"
if command -v psql >/dev/null 2>&1; then
  dbq() { psql "$DB_URL" -tAc "$1" 2>/dev/null; }
else
  dbq() { docker exec snapurl-postgres psql -U snapurl -d snapurl -tAc "$1" 2>/dev/null; }
fi

# loc <path> [extra curl args...] -> prints "STATUS|LOCATION"
loc() {
  local path="$1"; shift
  curl -s -o /dev/null -D - "$RD/$path" "$@" 2>/dev/null \
    | awk 'BEGIN{s="";l=""} /^HTTP/{s=$2} tolower($1)=="location:"{l=$2} END{gsub(/\r/,"",l); print s"|"l}'
}

echo "== setup =="
S=$(curl -s -X POST "$API/auth/register" -H 'Content-Type: application/json' \
  -d "{\"name\":\"Integration Tester\",\"email\":\"$EMAIL\",\"password\":\"$PASS\"}")
ACCESS=$(echo "$S" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).accessToken||""')
[ -n "$ACCESS" ] && ok "registered a workspace" || bad "register" "$S"

curl -s -X POST "$API/links" -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' \
  -d "{\"destination\":\"https://example.com/rollup\",\"domain\":\"localhost:3002\",\"slug\":\"$SLUG\",\"tags\":[],\"redirectType\":\"302\",\"rules\":[],\"forwardQuery\":true,\"deepLink\":false,\"hideReferrer\":false,\"publicPreview\":true}" >/dev/null
ok "created a plain 302 link"

echo
echo "== a real redirect =="
# A real 302 with a real Location, served by the redirect container. This is
# also what generates the click the worker must later roll up.
RES="$(loc "$SLUG")"
if [ "$RES" = "302|https://example.com/rollup" ]; then
  ok "302 to the destination"
else
  bad "302 to the destination" "expected [302|https://example.com/rollup], got [$RES]"
fi

echo
echo "== the click lands in click_events =="
# The redirect service records clicks asynchronously, so poll rather than
# assume the row is there the instant the 302 came back.
EVENTS=0
for i in $(seq 1 20); do
  EVENTS="$(dbq "select count(*) from click_events where link_id in (select id from links where slug = '$SLUG')" | tr -d '[:space:]')"
  [ "${EVENTS:-0}" -ge 1 ] && break
  sleep 1
done
if [ "${EVENTS:-0}" -ge 1 ]; then
  ok "the redirect recorded a click in click_events ($EVENTS)"
else
  bad "click not recorded in click_events" "count=$EVENTS after 20s"
fi

echo
echo "== the worker rolls it up into click_daily =="
# The compose worker runs its rollup loop every ROLLUP_INTERVAL_SECONDS (default
# 30s), so allow ~90s (three cycles plus slack) for the click to appear in the
# daily rollup. This is the assertion no unit test and no other smoke script
# makes: proof the live worker folds click_events into click_daily.
DAILY=0
for i in $(seq 1 90); do
  DAILY="$(dbq "select coalesce(sum(clicks),0) from click_daily where link_id in (select id from links where slug = '$SLUG')" | tr -d '[:space:]')"
  [ "${DAILY:-0}" -ge 1 ] && break
  sleep 1
done
if [ "${DAILY:-0}" -ge 1 ]; then
  ok "the worker rolled the click into click_daily ($DAILY)"
else
  bad "click did not survive rollup into click_daily" "sum(clicks)=$DAILY after 90s"
fi

echo
echo "----------------------------------------"
echo "  $PASSES passed, $FAILS failed"
echo "----------------------------------------"
[ "$FAILS" -eq 0 ]

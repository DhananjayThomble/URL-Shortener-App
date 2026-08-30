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

# A realistic desktop-browser User-Agent for the redirect that must survive the
# rollup into click_daily. This MUST NOT be a bot UA: the redirect service tags
# every click with isBot() (packages/domain/src/visitor.ts), whose BOT_PATTERN
# matches curl/wget/etc. Bots ARE stored in click_events (so the decision stays
# reversible), but rollupClicks (apps/worker/src/jobs/rollup.ts) folds only
# non-bot clicks into click_daily.clicks (count(*) filter where is_bot = false).
# curl's default UA (e.g. curl/8.x) matches BOT_PATTERN, so a click driven with
# the default UA lands in click_events but is excluded from click_daily forever.
# The UA below contains no BOT_PATTERN token (no bot/crawler/spider/preview/
# headless/etc.), so the click is eligible for rollup. Do NOT "simplify" this
# back to curl's default, or the click_daily assertion below will never count.
BROWSER_UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

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
# also what generates the click the worker must later roll up, so it is driven
# with a non-bot browser UA (see BROWSER_UA above): the click_daily rollup
# excludes bot clicks, and curl's default UA is classified as a bot.
RES="$(loc "$SLUG" -H "User-Agent: $BROWSER_UA")"
if [ "$RES" = "302|https://example.com/rollup" ]; then
  ok "302 to the destination"
else
  bad "302 to the destination" "expected [302|https://example.com/rollup], got [$RES]"
fi

echo
echo "== the click lands in click_events, exactly once =="
# The redirect now AWAITS the click write before it sends the 302 (issue #277),
# so the row exists synchronously by the time the redirect returns. We still
# poll briefly to absorb commit/visibility lag, but the assertion is now
# EXACTLY ONE row: this script drives exactly one redirect to this slug, so a
# single click_events row is the correct count. A count other than 1 means
# either the write was lost (fire-and-forget regression) or duplicated. Note:
# this count is over click_events regardless of is_bot, so it holds for a bot
# UA too; the click_daily check below is the one that requires a non-bot UA.
EVENTS=0
for i in $(seq 1 20); do
  EVENTS="$(dbq "select count(*) from click_events where link_id in (select id from links where slug = '$SLUG')" | tr -d '[:space:]')"
  [ "${EVENTS:-0}" -ge 1 ] && break
  sleep 1
done
if [ "${EVENTS:-0}" -eq 1 ]; then
  ok "the redirect recorded exactly one click in click_events ($EVENTS)"
else
  bad "redirect did not record exactly one click in click_events" "expected exactly 1, got count=$EVENTS after 20s"
fi

echo
echo "== the worker rolls it up into click_daily =="
# The compose worker runs its rollup loop every ROLLUP_INTERVAL_SECONDS (default
# 30s), so allow ~90s (three cycles plus slack) for the click to appear in the
# daily rollup. This is the assertion no unit test and no other smoke script
# makes: proof the live worker folds click_events into click_daily.
#
# NOTE: the 90s budget assumes the compose worker's default ~30s rollup
# interval. docker-compose.yml sets no ROLLUP_INTERVAL_SECONDS override, so the
# default holds today. If that override is ever raised in docker-compose.yml,
# raise this poll count to match (roughly 3x the interval), or a slow-but-
# working rollup will look like a rollup bug here.
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

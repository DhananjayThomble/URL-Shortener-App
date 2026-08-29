#!/usr/bin/env bash
# Exercises the redirect hot path against a running API + redirect service.
#   usage: bash scripts/smoke-redirect.sh
set -uo pipefail

API="${API:-http://localhost:3001/api/v1}"
RD="${RD:-http://localhost:3002}"
RUN="x$(date +%s)"
EMAIL="redirect-$(date +%s)@example.com"
PASS="a-long-enough-password-123"
PASSES=0; FAILS=0

ok()  { PASSES=$((PASSES+1)); echo "  PASS  $1"; }
bad() { FAILS=$((FAILS+1));  echo "  FAIL  $1"; echo "        $2"; }

# Reach the database whichever way this environment allows: psql directly when
# the client is installed (CI, where Postgres is a service container), or
# through the Compose container (local development).
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

expect() { # expect <label> <expected> <actual>
  if [ "$3" = "$2" ]; then ok "$1"; else bad "$1" "expected [$2], got [$3]"; fi
}
contains() {
  if echo "$3" | grep -q "$2"; then ok "$1"; else bad "$1" "got [$3]"; fi
}

echo "== setup =="
S=$(curl -s -X POST "$API/auth/register" -H 'Content-Type: application/json' \
  -d "{\"name\":\"Redirect Tester\",\"email\":\"$EMAIL\",\"password\":\"$PASS\"}")
ACCESS=$(echo "$S" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).accessToken||""')
[ -n "$ACCESS" ] && ok "registered a workspace" || bad "register" "$S"

mklink() { curl -s -X POST "$API/links" -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' -d "$1"; }

mklink "{\"destination\":\"https://example.com/plain\",\"domain\":\"localhost:3002\",\"slug\":\"$RUN-plain\",\"tags\":[],\"redirectType\":\"302\",\"rules\":[],\"forwardQuery\":true,\"deepLink\":false,\"hideReferrer\":false,\"publicPreview\":true}" >/dev/null
mklink "{\"destination\":\"https://example.com/utm\",\"domain\":\"localhost:3002\",\"slug\":\"$RUN-utm\",\"tags\":[],\"redirectType\":\"302\",\"rules\":[],\"forwardQuery\":true,\"deepLink\":false,\"hideReferrer\":false,\"publicPreview\":true,\"utm\":{\"source\":\"newsletter\",\"campaign\":\"spring\"}}" >/dev/null
mklink "{\"destination\":\"https://example.com/noforward\",\"domain\":\"localhost:3002\",\"slug\":\"$RUN-noforward\",\"tags\":[],\"redirectType\":\"302\",\"rules\":[],\"forwardQuery\":false,\"deepLink\":false,\"hideReferrer\":false,\"publicPreview\":true}" >/dev/null
mklink "{\"destination\":\"https://example.com/perm\",\"domain\":\"localhost:3002\",\"slug\":\"$RUN-perm\",\"tags\":[],\"redirectType\":\"301\",\"rules\":[],\"forwardQuery\":true,\"deepLink\":false,\"hideReferrer\":false,\"publicPreview\":true}" >/dev/null
mklink "{\"destination\":\"https://example.com/locked\",\"domain\":\"localhost:3002\",\"slug\":\"$RUN-locked\",\"password\":\"hunter2\",\"tags\":[],\"redirectType\":\"302\",\"rules\":[],\"forwardQuery\":true,\"deepLink\":false,\"hideReferrer\":false,\"publicPreview\":true}" >/dev/null
mklink "{\"destination\":\"https://example.com/gone\",\"domain\":\"localhost:3002\",\"slug\":\"$RUN-expired\",\"expiresAt\":\"2020-01-01T00:00:00.000Z\",\"expiresTo\":\"https://example.com/moved\",\"tags\":[],\"redirectType\":\"302\",\"rules\":[],\"forwardQuery\":true,\"deepLink\":false,\"hideReferrer\":false,\"publicPreview\":true}" >/dev/null
mklink "{\"destination\":\"https://example.com/soon\",\"domain\":\"localhost:3002\",\"slug\":\"$RUN-scheduled\",\"activatesAt\":\"2099-01-01T00:00:00.000Z\",\"scheduledTo\":\"https://example.com/coming-soon\",\"tags\":[],\"redirectType\":\"302\",\"rules\":[],\"forwardQuery\":true,\"deepLink\":false,\"hideReferrer\":false,\"publicPreview\":true}" >/dev/null
mklink "{\"destination\":\"https://example.com/soon2\",\"domain\":\"localhost:3002\",\"slug\":\"$RUN-scheduled-bare\",\"activatesAt\":\"2099-01-01T00:00:00.000Z\",\"tags\":[],\"redirectType\":\"302\",\"rules\":[],\"forwardQuery\":true,\"deepLink\":false,\"hideReferrer\":false,\"publicPreview\":true}" >/dev/null
mklink "{\"destination\":\"https://example.com/already\",\"domain\":\"localhost:3002\",\"slug\":\"$RUN-activated\",\"activatesAt\":\"2020-01-01T00:00:00.000Z\",\"tags\":[],\"redirectType\":\"302\",\"rules\":[],\"forwardQuery\":true,\"deepLink\":false,\"hideReferrer\":false,\"publicPreview\":true}" >/dev/null
mklink "{\"destination\":\"https://www.youtube.com/watch?v=abc123\",\"domain\":\"localhost:3002\",\"slug\":\"$RUN-deep\",\"deepLink\":true,\"tags\":[],\"redirectType\":\"302\",\"rules\":[],\"forwardQuery\":true,\"hideReferrer\":false,\"publicPreview\":true}" >/dev/null
mklink "{\"destination\":\"https://www.youtube.com/watch?v=abc123\",\"domain\":\"localhost:3002\",\"slug\":\"$RUN-nodeep\",\"deepLink\":false,\"tags\":[],\"redirectType\":\"302\",\"rules\":[],\"forwardQuery\":true,\"hideReferrer\":false,\"publicPreview\":true}" >/dev/null
mklink "{\"destination\":\"https://example.com/rest\",\"domain\":\"localhost:3002\",\"slug\":\"$RUN-geo\",\"tags\":[],\"redirectType\":\"302\",\"forwardQuery\":true,\"deepLink\":false,\"hideReferrer\":false,\"publicPreview\":true,\"rules\":[{\"id\":\"r-in\",\"when\":{\"country\":\"IN\"},\"then\":\"https://example.in/store\"},{\"id\":\"r-ios\",\"when\":{\"device\":\"ios\"},\"then\":\"https://apps.apple.com/app\"}]}" >/dev/null
ok "created twelve links"

echo
echo "== basic redirect =="
expect "302 to the destination" "302|https://example.com/plain" "$(loc "$RUN-plain")"
expect "unknown slug is 404"    "404|"                          "$(loc "$RUN-nope")"

echo
echo "== the 301 hazard =="
R=$(curl -s -o /dev/null -D - "$RD/$RUN-plain" | tr -d '\r')
contains "302 sends no-store (destinations can change)" "no-store" "$R"
R=$(curl -s -o /dev/null -D - "$RD/$RUN-perm" | tr -d '\r')
contains "301 is capped at 5 minutes, not forever" "max-age=300" "$R"
expect "301 uses status 301" "301|https://example.com/perm" "$(loc "$RUN-perm")"

echo
echo "== query and UTM =="
contains "query string is forwarded" "a=1" "$(loc "$RUN-plain?a=1")"
expect "forwardQuery=false drops it" "302|https://example.com/noforward" "$(loc "$RUN-noforward?a=1")"
contains "stored UTM is appended" "utm_source=newsletter" "$(loc "$RUN-utm")"
contains "click-time UTM wins over stored" "utm_source=twitter" "$(loc "$RUN-utm?utm_source=twitter")"

echo
echo "== routing chain =="
contains "India goes to the India store" "example.in" "$(loc "$RUN-geo" -H 'CloudFront-Viewer-Country: IN' -H 'CloudFront-Viewer-City: Pune')"
contains "iOS goes to the App Store" "apps.apple.com" "$(loc "$RUN-geo" -H 'User-Agent: Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')"
contains "everyone else gets the default" "example.com/rest" "$(loc "$RUN-geo" -H 'CloudFront-Viewer-Country: FR')"

echo
echo "== gates =="
contains "expired link uses expiresTo (G5)" "example.com/moved" "$(loc "$RUN-expired")"
contains "not-yet-live link uses scheduledTo" "example.com/coming-soon" "$(loc "$RUN-scheduled")"
# 404 rather than 410: nothing is gone, it has not started. And no fallback
# configured must not fall through to the destination.
expect "not-yet-live link with no fallback is 404" "404|" "$(loc "$RUN-scheduled-bare")"
expect "a past activation date is simply live" "302|https://example.com/already" "$(loc "$RUN-activated")"
contains "locked link is sent to unlock (G3)" "unlock=1" "$(loc "$RUN-locked")"
TOKEN=$(curl -s -X POST "$API/public/links/$RUN-locked/unlock" -H 'Content-Type: application/json' \
  -d '{"password":"hunter2"}' | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).unlockToken||""')
contains "unlock token opens the link (G3)" "example.com/locked" "$(loc "$RUN-locked?k=$TOKEN")"
contains "a token for another link is refused" "unlock=1" "$(loc "$RUN-locked?k=not-a-real-token")"

echo
echo "== deep linking =="
ANDROID='User-Agent: Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36'
IPHONE='User-Agent: Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile Safari/604.1'

DEEP=$(loc "$RUN-deep" -H "$ANDROID")
contains "Android gets an intent URL"          "intent://www.youtube.com" "$DEEP"
contains "the intent names the YouTube package" "com.google.android.youtube" "$DEEP"
# The property the feature rests on: no app, no dead end.
contains "the intent carries a web fallback"   "S.browser_fallback_url"   "$DEEP"

# iOS is served by Universal Links on the plain https URL, and a custom scheme
# there would surface "Cannot Open Page" whenever the app is absent.
contains "iPhone gets the plain URL"    "https://www.youtube.com/watch" "$(loc "$RUN-deep" -H "$IPHONE")"
contains "desktop gets the plain URL"   "https://www.youtube.com/watch" "$(loc "$RUN-deep")"
contains "the flag off means untouched" "https://www.youtube.com/watch" "$(loc "$RUN-nodeep" -H "$ANDROID")"
# A host with no app must pass straight through even with the flag on.
contains "an unknown host is untouched"  "example.com/plain" "$(loc "$RUN-plain" -H "$ANDROID")"

echo
echo "== the + preview convention =="
contains "trailing + goes to the trust page" "/p/$RUN-plain" "$(loc "$RUN-plain%2B")"

echo
echo "== privacy =="
if dbq "select column_name from information_schema.columns where table_name='click_events' and column_name='ip'" | grep -q .; then
  bad "click_events stores no IP" "an ip column exists"
else ok "click_events has no ip column"; fi
HASHES=$(dbq "select count(distinct visitor_hash) from click_events where link_id in (select id from links where slug like '$RUN%')" | tr -d '[:space:]')
[ -n "$HASHES" ] && ok "clicks recorded with visitor hashes ($HASHES distinct)" || bad "click recording" "no rows"

# City comes from CloudFront's edge header, already resolved — the reason no IP
# is needed to produce it. See docs/DECISIONS.md.
CITY=$(dbq "select count(*) from click_events where city = 'Pune' and link_id in (select id from links where slug like '$RUN%')" | tr -d '[:space:]')
[ "${CITY:-0}" -ge 1 ] && ok "the CloudFront city header is recorded" || bad "city not recorded" "count=$CITY"

# The other half of that decision: a city name is a population, a coordinate is
# a location, and only one of them belongs here.
if dbq "select column_name from information_schema.columns where table_name='click_events' and column_name in ('latitude','longitude','lat','lon')" | grep -q .; then
  bad "click_events stores no coordinates" "a latitude/longitude column exists"
else ok "click_events has no coordinate columns"; fi

echo
echo "----------------------------------------"
echo "  $PASSES passed, $FAILS failed"
echo "----------------------------------------"
[ "$FAILS" -eq 0 ]

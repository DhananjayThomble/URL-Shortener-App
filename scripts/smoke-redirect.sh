#!/usr/bin/env bash
# Exercises the redirect hot path against a running API + redirect service.
#
# The same assertions run against any target: a locally-started pair of
# processes, a composed stack, or a real deployed CloudFront-fronted
# environment. That last mode is the point of this script's design: the two
# deployment showstoppers (a real slug returning 302 instead of 404, and a
# country-scoped rule matching so click_events.country is populated) only exist
# once a CDN is in front of the origin, so they are invisible to local testing
# and to CI. Pointing this at the deployed base URL is the only way to answer
# "does the deployed thing actually redirect?".
#
#   usage: bash scripts/smoke-redirect.sh
#
# Environment contract (all optional; defaults target a local dev stack):
#
#   API   API base URL. Default http://localhost:3001/api/v1.
#   RD    Redirect service base URL. Default http://localhost:3002.
#
#   LINK_DOMAIN  The domain new links are created on. Default derived from RD by
#         stripping the scheme and any path (http://localhost:3002 ->
#         localhost:3002, https://snap.example.com/x -> snap.example.com).
#
#         LINK_DOMAIN MUST equal the API's DEFAULT_DOMAIN. On register the API
#         (apps/api/src/auth/auth.service.ts) seeds exactly one system domain
#         equal to env.DEFAULT_DOMAIN for the new workspace, and link creation
#         (apps/api/src/links/links.service.ts resolveDomain) rejects any other
#         domain with 400 "isn't a domain you can use". So a freshly-registered
#         throwaway user can ONLY create links on DEFAULT_DOMAIN.
#
#         It must ALSO exactly match the Host header curl sends to RD: the
#         redirect resolver (apps/redirect/src/resolver.ts) matches
#         lower(domains.domain) = normaliseHost(Host), and normaliseHost only
#         lowercases/trims (it does NOT strip the port). So for
#         RD=http://localhost:3002 the domain must be exactly localhost:3002.
#         Deriving from RD keeps both requirements aligned by construction as
#         long as the deployment sets DEFAULT_DOMAIN to the redirect host.
#
#   SMOKE_EMAIL / SMOKE_PASSWORD  Optional credentials for an existing account,
#         used when open registration is disabled in the target environment.
#         When set, the script logs in instead of self-registering. When unset
#         (the default) it self-registers a unique throwaway user per run, as it
#         always has. If neither a register nor a login yields a token the setup
#         assertion fails and the run reports it rather than proceeding blind.
#
# Targeting a deployed environment: set RD to the redirect base URL and API to
# the API base URL (they may be the same CloudFront host with different paths,
# or different hosts), and ensure DEFAULT_DOMAIN there equals the redirect host
# so LINK_DOMAIN derives correctly (or set LINK_DOMAIN explicitly to match it).
# The script creates its own fixture links and DELETEs every one of them on exit
# (even on failure), so it is safe to point at a real environment.
set -uo pipefail

API="${API:-http://localhost:3001/api/v1}"
RD="${RD:-http://localhost:3002}"
# Derive the link-creation domain from RD unless one is given explicitly. With
# the default RD this yields the byte string localhost:3002, identical to what
# this script hardcoded before, so the compose `integration` CI path is
# unaffected. See the header for why this must equal DEFAULT_DOMAIN and the
# Host curl sends.
LINK_DOMAIN="${LINK_DOMAIN:-$(printf '%s' "$RD" | sed -E 's#^[a-zA-Z]+://##; s#/.*$##')}"
RUN="x$(date +%s)"
EMAIL="redirect-$(date +%s)@example.com"
PASS="a-long-enough-password-123"
PASSES=0; FAILS=0

# A realistic desktop-browser User-Agent for any redirect whose click must
# survive into the analytics breakdown. This MUST NOT be a bot UA: the redirect
# service tags every click with isBot() (packages/domain/src/visitor.ts), whose
# BOT_PATTERN matches curl/wget/etc. Bots ARE stored in click_events (so the
# decision stays reversible), but the worker's rollup (apps/worker/src/jobs/
# rollup.ts) folds only is_bot=false AND blocked_reason IS NULL clicks into the
# breakdown_daily rows the analytics API reads. curl's default UA (curl/8.x)
# matches BOT_PATTERN, so a click driven with the default UA lands in
# click_events but never reaches the country breakdown. The UA below contains no
# BOT_PATTERN token, so its click is eligible for rollup. Do NOT "simplify" this
# back to curl's default, or the country-population poll below will never pass.
BROWSER_UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"

# Every link id we create, so cleanup can remove each one on exit.
CREATED_IDS=()

ok()  { PASSES=$((PASSES+1)); echo "  PASS  $1"; }
bad() { FAILS=$((FAILS+1));  echo "  FAIL  $1"; echo "        $2"; }
skip() { echo "  SKIP  $1"; }

# Remove every fixture link we created, on any exit path (success, assertion
# failure, or interruption). Runs via the EXIT trap installed before the first
# link is created, so a real environment is left litter-free even if the script
# dies mid-run. Preserves the caller's intended exit status: it captures $?,
# does its work, and re-exits with the original code so the FAILS-based result
# is never clobbered.
cleanup() {
  local code=$?
  if [ -n "${ACCESS:-}" ] && [ "${#CREATED_IDS[@]}" -gt 0 ]; then
    echo
    echo "== cleanup =="
    local id
    for id in "${CREATED_IDS[@]}"; do
      [ -n "$id" ] || continue
      curl -s -o /dev/null -X DELETE "$API/links/$id" -H "Authorization: Bearer $ACCESS" 2>/dev/null || true
    done
    echo "  removed ${#CREATED_IDS[@]} fixture link(s)"
  fi
  exit "$code"
}

# Reach the database whichever way this environment allows: psql directly when
# the client is installed (CI, where Postgres is a service container), or
# through the Compose container (local development).
DB_URL="${DATABASE_URL:-postgres://snapurl:snapurl@localhost:5433/snapurl}"
if command -v psql >/dev/null 2>&1; then
  dbq() { psql "$DB_URL" -tAc "$1" 2>/dev/null; }
else
  dbq() { docker exec snapurl-postgres psql -U snapurl -d snapurl -tAc "$1" 2>/dev/null; }
fi

# Direct-DB assertions only make sense where the database is actually reachable
# (local dev and CI/compose), where DATABASE_URL is set and either psql is
# on PATH or the snapurl-postgres container is up. Against a deployed CDN the DB
# is not exposed, so those checks are SKIPPED (not failed) and the always-run
# API-based equivalents below carry the load. Detect it once here.
DB_AVAILABLE=0
if [ -n "${DATABASE_URL:-}" ]; then
  if command -v psql >/dev/null 2>&1; then
    if dbq "select 1" | grep -q 1; then DB_AVAILABLE=1; fi
  elif docker exec snapurl-postgres true >/dev/null 2>&1; then
    DB_AVAILABLE=1
  fi
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
if [ -n "${SMOKE_EMAIL:-}" ] && [ -n "${SMOKE_PASSWORD:-}" ]; then
  # Open registration may be disabled in a deployed environment; log in to a
  # pre-provisioned account instead. That account's workspace must own
  # LINK_DOMAIN (or it must be a live system domain) for link creation to work.
  S=$(curl -s -X POST "$API/auth/login" -H 'Content-Type: application/json' \
    -d "{\"email\":\"$SMOKE_EMAIL\",\"password\":\"$SMOKE_PASSWORD\"}")
  ACCESS=$(echo "$S" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).accessToken||""')
  [ -n "$ACCESS" ] && ok "logged in to the smoke account" || bad "login" "$S"
else
  S=$(curl -s -X POST "$API/auth/register" -H 'Content-Type: application/json' \
    -d "{\"name\":\"Redirect Tester\",\"email\":\"$EMAIL\",\"password\":\"$PASS\"}")
  ACCESS=$(echo "$S" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).accessToken||""')
  [ -n "$ACCESS" ] && ok "registered a workspace" || bad "register" "$S"
fi

# Install the cleanup trap BEFORE creating any link, so nothing is left behind
# even if a link-creation or an assertion below fails and the script exits.
trap cleanup EXIT

# The id of the most recently created link, set by mklink. Captured into a
# global (rather than echoed and read via command substitution) so mklink runs
# in the current shell and its CREATED_IDS append is not lost to a subshell.
# Read this straight after a mklink call to grab a specific link's id.
LAST_ID=""

# mklink <json> -> POSTs a new link, appends its id to CREATED_IDS for cleanup,
# and records the created id in the global LAST_ID (empty string if creation
# failed). Keeps the response body off stdout to preserve the previous quiet
# behaviour.
mklink() {
  local resp
  resp=$(curl -s -X POST "$API/links" -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' -d "$1")
  LAST_ID=$(echo "$resp" | node -pe 'try{JSON.parse(require("fs").readFileSync(0,"utf8")).id||""}catch(e){""}')
  [ -n "$LAST_ID" ] && CREATED_IDS+=("$LAST_ID")
}

mklink "{\"destination\":\"https://example.com/plain\",\"domain\":\"$LINK_DOMAIN\",\"slug\":\"$RUN-plain\",\"tags\":[],\"redirectType\":\"302\",\"rules\":[],\"forwardQuery\":true,\"deepLink\":false,\"hideReferrer\":false,\"publicPreview\":true}"
mklink "{\"destination\":\"https://example.com/utm\",\"domain\":\"$LINK_DOMAIN\",\"slug\":\"$RUN-utm\",\"tags\":[],\"redirectType\":\"302\",\"rules\":[],\"forwardQuery\":true,\"deepLink\":false,\"hideReferrer\":false,\"publicPreview\":true,\"utm\":{\"source\":\"newsletter\",\"campaign\":\"spring\"}}"
mklink "{\"destination\":\"https://example.com/noforward\",\"domain\":\"$LINK_DOMAIN\",\"slug\":\"$RUN-noforward\",\"tags\":[],\"redirectType\":\"302\",\"rules\":[],\"forwardQuery\":false,\"deepLink\":false,\"hideReferrer\":false,\"publicPreview\":true}"
mklink "{\"destination\":\"https://example.com/perm\",\"domain\":\"$LINK_DOMAIN\",\"slug\":\"$RUN-perm\",\"tags\":[],\"redirectType\":\"301\",\"rules\":[],\"forwardQuery\":true,\"deepLink\":false,\"hideReferrer\":false,\"publicPreview\":true}"
mklink "{\"destination\":\"https://example.com/locked\",\"domain\":\"$LINK_DOMAIN\",\"slug\":\"$RUN-locked\",\"password\":\"hunter2\",\"tags\":[],\"redirectType\":\"302\",\"rules\":[],\"forwardQuery\":true,\"deepLink\":false,\"hideReferrer\":false,\"publicPreview\":true}"
mklink "{\"destination\":\"https://example.com/gone\",\"domain\":\"$LINK_DOMAIN\",\"slug\":\"$RUN-expired\",\"expiresAt\":\"2020-01-01T00:00:00.000Z\",\"expiresTo\":\"https://example.com/moved\",\"tags\":[],\"redirectType\":\"302\",\"rules\":[],\"forwardQuery\":true,\"deepLink\":false,\"hideReferrer\":false,\"publicPreview\":true}"
mklink "{\"destination\":\"https://example.com/soon\",\"domain\":\"$LINK_DOMAIN\",\"slug\":\"$RUN-scheduled\",\"activatesAt\":\"2099-01-01T00:00:00.000Z\",\"scheduledTo\":\"https://example.com/coming-soon\",\"tags\":[],\"redirectType\":\"302\",\"rules\":[],\"forwardQuery\":true,\"deepLink\":false,\"hideReferrer\":false,\"publicPreview\":true}"
mklink "{\"destination\":\"https://example.com/soon2\",\"domain\":\"$LINK_DOMAIN\",\"slug\":\"$RUN-scheduled-bare\",\"activatesAt\":\"2099-01-01T00:00:00.000Z\",\"tags\":[],\"redirectType\":\"302\",\"rules\":[],\"forwardQuery\":true,\"deepLink\":false,\"hideReferrer\":false,\"publicPreview\":true}"
mklink "{\"destination\":\"https://example.com/already\",\"domain\":\"$LINK_DOMAIN\",\"slug\":\"$RUN-activated\",\"activatesAt\":\"2020-01-01T00:00:00.000Z\",\"tags\":[],\"redirectType\":\"302\",\"rules\":[],\"forwardQuery\":true,\"deepLink\":false,\"hideReferrer\":false,\"publicPreview\":true}"
mklink "{\"destination\":\"https://www.youtube.com/watch?v=abc123\",\"domain\":\"$LINK_DOMAIN\",\"slug\":\"$RUN-deep\",\"deepLink\":true,\"tags\":[],\"redirectType\":\"302\",\"rules\":[],\"forwardQuery\":true,\"hideReferrer\":false,\"publicPreview\":true}"
mklink "{\"destination\":\"https://www.youtube.com/watch?v=abc123\",\"domain\":\"$LINK_DOMAIN\",\"slug\":\"$RUN-nodeep\",\"deepLink\":false,\"tags\":[],\"redirectType\":\"302\",\"rules\":[],\"forwardQuery\":true,\"hideReferrer\":false,\"publicPreview\":true}"
# Capture the geo link's id explicitly at creation time. The always-run
# country-population poll below needs THIS link's id; deriving it from the last
# CREATED_IDS entry would silently query the wrong link if the fixtures are ever
# reordered or another link is appended after this one. mklink still appends to
# CREATED_IDS, so cleanup is unaffected.
mklink "{\"destination\":\"https://example.com/rest\",\"domain\":\"$LINK_DOMAIN\",\"slug\":\"$RUN-geo\",\"tags\":[],\"redirectType\":\"302\",\"forwardQuery\":true,\"deepLink\":false,\"hideReferrer\":false,\"publicPreview\":true,\"rules\":[{\"id\":\"r-in\",\"when\":{\"country\":\"IN\"},\"then\":\"https://example.in/store\"},{\"id\":\"r-ios\",\"when\":{\"device\":\"ios\"},\"then\":\"https://apps.apple.com/app\"}]}"
GEO_ID="$LAST_ID"

# Assert every fixture was actually created rather than reporting an
# unconditional pass. If fewer links exist than the number of mklink calls
# (e.g. a bad LINK_DOMAIN causing 400 domain-mismatch rejections), fail here at
# the real problem instead of only via downstream redirect failures.
EXPECTED_LINKS=12
if [ "${#CREATED_IDS[@]}" -eq "$EXPECTED_LINKS" ]; then
  ok "created $EXPECTED_LINKS links"
else
  bad "created $EXPECTED_LINKS links" "expected $EXPECTED_LINKS, got ${#CREATED_IDS[@]} (check LINK_DOMAIN matches DEFAULT_DOMAIN)"
fi

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
echo "== deployment showstoppers =="
# These three are the checks the issue names: the failures that are invisible to
# local unit tests and only appear once a CDN is in front of the origin. They
# run in EVERY mode (local, compose, deployed) so a deploy that produces a
# 404-on-everything stack fails loudly.
#
#   (1) a real slug returns 302, not 404  -> "302 to the destination" above.
#   (2) a country-scoped routing rule matches -> "India goes to the India store"
#       above (CloudFront-Viewer-Country: IN on $RUN-geo).
#   (3) click_events.country is populated -> proven directly from click_events
#       via the DB in DB-available mode (local/compose/CI, no worker required),
#       and via the analytics countries[] poll in deployed mode (no DB, but a
#       worker is running there to roll clicks up). See below.
#
# TODO (Phase 7 / #276, #289): once a real deploy exists, add a deployed-only
# assertion that a DIRECT (unsigned) request to the raw redirect Function URL
# returns 403 — proof that OAC + AWS_IAM auth keep the origin reachable only
# through CloudFront. The stack exposes that URL as the RedirectFunctionUrl
# CfnOutput; wire it in here (e.g. via a FUNCTION_URL env var) and assert 403,
# while $RD (the CloudFront base) continues to prove the via-CDN 302s above.
# Not done locally/in compose: there is no Function URL there (compose hits the
# container directly), so this must stay gated to the deployed target.

# Drive a real redirect through the country-ruled $RUN-geo link with a non-bot
# browser UA and a CloudFront-Viewer-Country header. This is what populates
# click_events.country. It runs in BOTH modes: the DB-direct check (DB mode)
# needs the click row, and the analytics poll (deployed mode) needs a non-bot
# click that the worker can fold into the rollup. The browser UA (not curl's
# default, which BOT_PATTERN classifies as a bot) keeps the click eligible for
# rollup where a worker exists.
# GEO_ID was captured explicitly when the $RUN-geo link was created (above), so
# both proofs target the geo link by identity, not by array position.
loc "$RUN-geo" -H "User-Agent: $BROWSER_UA" -H 'CloudFront-Viewer-Country: IN' -H 'CloudFront-Viewer-City: Pune' >/dev/null

if [ "$DB_AVAILABLE" -eq 1 ]; then
  # DB-available (local/compose/CI): prove click_events.country DIRECTLY, the
  # same way the city check below proves the city header is recorded. This reads
  # the raw click_events row, so it needs NO worker (the `verify` job runs only
  # api+redirect, no worker) and is a strictly stronger proof than the rollup
  # path. Do NOT run the analytics poll here: without a worker the rollup never
  # populates the countries[] breakdown, and the direct query already proves it.
  CTRY=$(dbq "select count(*) from click_events where country = 'IN' and link_id in (select id from links where slug like '$RUN%')" | tr -d '[:space:]')
  [ "${CTRY:-0}" -ge 1 ] && ok "click_events.country is populated (click_events.country='IN')" || bad "click_events.country not recorded" "count=$CTRY"
else
  # Deployed (no DB): the only way to observe population through the public
  # surface is the analytics countries[] breakdown, which reads the
  # worker-populated breakdown_daily rollup (apps/api/src/analytics/
  # analytics.service.ts + apps/worker/src/jobs/rollup.ts). A worker IS running
  # in a deployed environment, so poll GET /analytics until the country appears.
  # The rollup folds only non-bot clicks, hence the non-bot UA on the driving
  # redirect above and the ~90s poll budget (worker rollup interval default
  # ~30s, three cycles). The API maps country codes to names via COUNTRY_NAMES
  # (IN -> "India"), so match on either the code or the mapped name.
  COUNTRY_FOUND=0
  if [ -n "$GEO_ID" ]; then
    for i in $(seq 1 90); do
      A=$(curl -s "$API/analytics?linkId=$GEO_ID&range=24h" -H "Authorization: Bearer $ACCESS")
      HIT=$(echo "$A" | node -pe 'try{const d=JSON.parse(require("fs").readFileSync(0,"utf8"));(d.countries||[]).some(c=>c.label==="IN"||c.label==="India")?"1":""}catch(e){""}')
      [ "$HIT" = "1" ] && { COUNTRY_FOUND=1; break; }
      sleep 1
    done
  fi
  if [ "$COUNTRY_FOUND" -eq 1 ]; then
    ok "click_events.country is populated (analytics shows IN/India)"
  else
    bad "click_events.country not populated via analytics" "no IN/India in countries[] after 90s (linkId=$GEO_ID)"
  fi
fi

echo
echo "== privacy =="
# These read the database directly, so they run only where the DB is reachable
# (local dev, CI, compose). Against a deployed CDN the DB is not exposed, so they
# are skipped rather than failed; the always-run analytics poll above carries the
# click_events.country proof in that mode.
if [ "$DB_AVAILABLE" -eq 1 ]; then
  if dbq "select column_name from information_schema.columns where table_name='click_events' and column_name='ip'" | grep -q .; then
    bad "click_events stores no IP" "an ip column exists"
  else ok "click_events has no ip column"; fi
  HASHES=$(dbq "select count(distinct visitor_hash) from click_events where link_id in (select id from links where slug like '$RUN%')" | tr -d '[:space:]')
  [ -n "$HASHES" ] && ok "clicks recorded with visitor hashes ($HASHES distinct)" || bad "click recording" "no rows"

  # City comes from CloudFront's edge header, already resolved — the reason no IP
  # is needed to produce it. See docs/DECISIONS.md. This is the DB-side proof
  # that a CloudFront geo header (here the city) is recorded on the click.
  CITY=$(dbq "select count(*) from click_events where city = 'Pune' and link_id in (select id from links where slug like '$RUN%')" | tr -d '[:space:]')
  [ "${CITY:-0}" -ge 1 ] && ok "the CloudFront city header is recorded" || bad "city not recorded" "count=$CITY"

  # The other half of that decision: a city name is a population, a coordinate is
  # a location, and only one of them belongs here.
  if dbq "select column_name from information_schema.columns where table_name='click_events' and column_name in ('latitude','longitude','lat','lon')" | grep -q .; then
    bad "click_events stores no coordinates" "a latitude/longitude column exists"
  else ok "click_events has no coordinate columns"; fi
else
  skip "direct-DB privacy checks: no DB access (deployed mode)"
fi

# A tracking pixel cannot run inside a 302 — it needs an HTML interstitial to
# execute third-party script in the visitor's browser. Asserting that a
# successful redirect is still a bare 3xx turns "we don't do that" from a
# claim on the landing page into something CI enforces. See DECISIONS.md.
RH=$(curl -s -o /dev/null -D - "$RD/$RUN-plain" | tr -d '\r')
if echo "$RH" | grep -qi "content-type: *text/html"; then
  bad "a redirect is a redirect, not an interstitial" "$(echo "$RH" | head -3)"
else ok "a redirect is a redirect, not an interstitial"; fi

BODY_BYTES=$(curl -s "$RD/$RUN-plain" | wc -c | tr -d '[:space:]')
if [ "$BODY_BYTES" -lt 256 ]; then ok "the redirect carries no page to hang a pixel on ($BODY_BYTES bytes)";
else bad "redirect body is large enough to be a page" "$BODY_BYTES bytes"; fi

echo
echo "----------------------------------------"
echo "  $PASSES passed, $FAILS failed"
echo "----------------------------------------"
[ "$FAILS" -eq 0 ]

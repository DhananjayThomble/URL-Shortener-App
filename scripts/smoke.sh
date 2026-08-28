#!/usr/bin/env bash
# End-to-end smoke test against a running API.
# Exercises the happy path plus each of the contract gaps that was closed.
#   usage: bash scripts/smoke.sh
set -uo pipefail

API="${API:-http://localhost:3001/api/v1}"
EMAIL="smoke-$(date +%s)@example.com"
PASS="a-long-enough-password-123"
# Slugs are globally unique on the shared system domain, so each run needs
# its own. A collision here would be the product behaving correctly.
RUN="r$(date +%s)"
PASSES=0
FAILS=0

ok()   { PASSES=$((PASSES+1)); echo "  PASS  $1"; }
bad()  { FAILS=$((FAILS+1));  echo "  FAIL  $1"; echo "        $2"; }

check() { # check <label> <expected-substring> <body>
  if echo "$3" | grep -q "$2"; then ok "$1"; else bad "$1" "$(echo "$3" | head -c 300)"; fi
}

status() { # status <label> <expected-code> <actual-code> <body>
  if [ "$2" = "$3" ]; then ok "$1 ($3)"; else bad "$1" "expected $2, got $3: $(echo "$4" | head -c 200)"; fi
}

echo "== health =="
BODY=$(curl -s "$API/health")
check "health reports ok" '"status":"ok"' "$BODY"

echo
echo "== auth =="
BODY=$(curl -s -X POST "$API/auth/register" -H 'Content-Type: application/json' \
  -d "{\"name\":\"Smoke Tester\",\"email\":\"$EMAIL\",\"password\":\"$PASS\"}")
check "register returns a session" '"accessToken"' "$BODY"
ACCESS=$(echo "$BODY"  | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).accessToken  || ""')
REFRESH=$(echo "$BODY" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).refreshToken || ""')
check "register derives initials" '"initials":"ST"' "$BODY"

BODY=$(curl -s "$API/auth/me" -H "Authorization: Bearer $ACCESS")
check "me returns the owner" '"role":"owner"' "$BODY"

CODE=$(curl -s -o /dev/null -w '%{http_code}' "$API/auth/me")
status "me without a token is refused" "401" "$CODE" ""

BODY=$(curl -s -X POST "$API/auth/register" -H 'Content-Type: application/json' \
  -d "{\"name\":\"Dupe\",\"email\":\"$EMAIL\",\"password\":\"$PASS\"}")
check "duplicate email is rejected" 'already exists' "$BODY"

BODY=$(curl -s -X POST "$API/auth/register" -H 'Content-Type: application/json' \
  -d '{"name":"Short","email":"short@example.com","password":"tiny"}')
check "short password names the field" 'password:' "$BODY"

echo
echo "== workspace =="
BODY=$(curl -s "$API/workspaces/current" -H "Authorization: Bearer $ACCESS")
check "workspace has the default domain" 'localhost:3002' "$BODY"
check "workspace reports a currency (G7)" '"currency"' "$BODY"

echo
echo "== links =="
BODY=$(curl -s -X POST "$API/links" -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' \
  -d "{\"destination\":\"https://example.com/landing\",\"domain\":\"localhost:3002\",\"slug\":\"${RUN}-one\",\"tags\":[\"smoke\"],\"redirectType\":\"302\",\"rules\":[],\"forwardQuery\":true,\"deepLink\":false,\"hideReferrer\":false,\"publicPreview\":true}")
check "create returns the link" "\"slug\":\"${RUN}-one\"" "$BODY"
check "sparkline is present (G8)" '"sparkline"' "$BODY"
LINK_ID=$(echo "$BODY" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).id || ""')
SPARK=$(echo "$BODY" | node -pe 'const l=JSON.parse(require("fs").readFileSync(0,"utf8")); (l.sparkline||[]).length')
if [ "$SPARK" = "30" ]; then ok "sparkline is exactly 30 days (G8)"; else bad "sparkline length" "got $SPARK"; fi

BODY=$(curl -s -X POST "$API/links" -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' \
  -d "{\"destination\":\"https://example.com/x\",\"domain\":\"localhost:3002\",\"slug\":\"${RUN}-one\",\"tags\":[],\"redirectType\":\"302\",\"rules\":[],\"forwardQuery\":true,\"deepLink\":false,\"hideReferrer\":false,\"publicPreview\":true}")
check "duplicate slug is rejected" 'already taken' "$BODY"

BODY=$(curl -s -X POST "$API/links" -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' \
  -d '{"destination":"https://example.com/y","domain":"localhost:3002","slug":"login","tags":[],"redirectType":"302","rules":[],"forwardQuery":true,"deepLink":false,"hideReferrer":false,"publicPreview":true}')
check "reserved slug is rejected" 'reserved' "$BODY"

BODY=$(curl -s -X POST "$API/links" -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' \
  -d '{"destination":"not-a-url","domain":"localhost:3002","tags":[],"redirectType":"302","rules":[],"forwardQuery":true,"deepLink":false,"hideReferrer":false,"publicPreview":true}')
check "bad destination names the field" 'destination:' "$BODY"

BODY=$(curl -s -X POST "$API/links" -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' \
  -d '{"destination":"https://example.com/ab","domain":"localhost:3002","tags":[],"redirectType":"302","forwardQuery":true,"deepLink":false,"hideReferrer":false,"publicPreview":true,"rules":[{"id":"a","when":{},"then":"https://a.example.com","weight":60},{"id":"b","when":{},"then":"https://b.example.com","weight":30}]}')
check "split weights must total 100" '90%' "$BODY"

BODY=$(curl -s -X POST "$API/links" -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' \
  -d '{"destination":"https://example.com/auto","domain":"localhost:3002","tags":[],"redirectType":"302","rules":[],"forwardQuery":true,"deepLink":false,"hideReferrer":false,"publicPreview":true}')
check "slug is generated when omitted" '"slug"' "$BODY"

BODY=$(curl -s "$API/links" -H "Authorization: Bearer $ACCESS")
check "list returns items and total" '"total"' "$BODY"
check "list exposes nextCursor (G4)" 'nextCursor' "$BODY"

BODY=$(curl -s "$API/links?limit=1" -H "Authorization: Bearer $ACCESS")
COUNT=$(echo "$BODY" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).items.length')
if [ "$COUNT" = "1" ]; then ok "limit is honoured (G4)"; else bad "limit" "got $COUNT items"; fi

echo
echo "== G1: PATCH /links/:id =="
BODY=$(curl -s -X PATCH "$API/links/$LINK_ID" -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' \
  -d '{"destination":"https://example.com/edited","comment":"changed after printing"}')
check "destination can be edited (G1)" 'https://example.com/edited' "$BODY"
check "expiresTo is readable (G5)" 'expiresTo' "$BODY"

echo
echo "== G3: password-protected links =="
BODY=$(curl -s -X POST "$API/links" -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' \
  -d "{\"destination\":\"https://example.com/secret\",\"domain\":\"localhost:3002\",\"slug\":\"${RUN}-locked\",\"password\":\"open-sesame\",\"tags\":[],\"redirectType\":\"302\",\"rules\":[],\"forwardQuery\":true,\"deepLink\":false,\"hideReferrer\":false,\"publicPreview\":true}")
check "passwordProtected is reported" '"passwordProtected":true' "$BODY"
if echo "$BODY" | grep -q 'passwordHash'; then bad "password hash leaked in response" "$BODY"; else ok "password hash is not in the response"; fi

BODY=$(curl -s -X POST "$API/public/links/${RUN}-locked/unlock" -H 'Content-Type: application/json' -d '{"password":"wrong"}')
check "wrong password is refused (G3)" "isn't right" "$BODY"

BODY=$(curl -s -X POST "$API/public/links/${RUN}-locked/unlock" -H 'Content-Type: application/json' -d '{"password":"open-sesame"}')
check "correct password returns a token (G3)" 'unlockToken' "$BODY"

echo
echo "== public preview =="
BODY=$(curl -s "$API/public/links/${RUN}-one/preview")
check "preview works without auth" 'example.com/edited' "$BODY"
check "preview states no cookies" '"setsCookies":false' "$BODY"
if echo "$BODY" | grep -q 'workspaceId\|"tags"\|"clicks"'; then bad "preview leaks private fields" "$BODY"; else ok "preview exposes nothing private"; fi

echo
echo "== analytics =="
BODY=$(curl -s "$API/analytics?range=30d" -H "Authorization: Bearer $ACCESS")
check "analytics returns totals" '"totals"' "$BODY"
SERIES=$(echo "$BODY" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).series.length')
if [ "$SERIES" = "30" ]; then ok "series is zero-filled to 30 days"; else bad "series length" "got $SERIES"; fi

BODY=$(curl -s "$API/conversions?range=30d" -H "Authorization: Bearer $ACCESS")
check "conversions reports its currency (G7)" '"currency"' "$BODY"

echo
echo "== team, domains, developers =="
check "members lists the owner"  "$EMAIL" "$(curl -s "$API/members" -H "Authorization: Bearer $ACCESS")"
check "2FA is off by default (G6)" '"twoFactor":false' "$(curl -s "$API/members" -H "Authorization: Bearer $ACCESS")"
check "domains lists the default" 'localhost:3002' "$(curl -s "$API/domains" -H "Authorization: Bearer $ACCESS")"
# Regression: a correlated subquery here silently counted zero.
DLINKS=$(curl -s "$API/domains" -H "Authorization: Bearer $ACCESS" | node -pe 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); (d[0]&&d[0].links)||0')
if [ "$DLINKS" -gt 0 ]; then ok "domain reports its link count ($DLINKS)"; else bad "domain link count" "got $DLINKS, expected > 0"; fi
# Regression: the shared system domain is not the caller's to delete.
DID=$(curl -s "$API/domains" -H "Authorization: Bearer $ACCESS" | node -pe 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); (d[0]&&d[0].id)||""')
check "shared domain cannot be disconnected" "isn't yours" "$(curl -s -X DELETE "$API/domains/$DID" -H "Authorization: Bearer $ACCESS")"
check "audit is readable" '\[' "$(curl -s "$API/audit" -H "Authorization: Bearer $ACCESS")"
check "bio-pages is readable" '\[' "$(curl -s "$API/bio-pages" -H "Authorization: Bearer $ACCESS")"

BODY=$(curl -s -X POST "$API/api-keys" -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' \
  -d '{"name":"smoke","scopes":["links:read"]}')
check "api key is returned once" '"key":"snap_live_' "$BODY"
APIKEY=$(echo "$BODY" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).key || ""')

check "api key authenticates" '"total"' "$(curl -s "$API/links" -H "Authorization: Bearer $APIKEY")"
check "api key scope is enforced" 'scope' "$(curl -s "$API/analytics" -H "Authorization: Bearer $APIKEY")"

echo
echo "== audit trail =="
# Both subsystems were fully built and never invoked: enqueueEvent had zero
# call sites, and only the three member actions ever wrote an audit row. The
# team page's claim that every action is logged was false.
#
# The stored key is "link.created"; describe() renders it into a sentence
# before it leaves the API, so these assert what a reader actually sees.
AUDIT=$(curl -s "$API/audit" -H "Authorization: Bearer $ACCESS")
check "creating a link writes an audit entry" "Created ${RUN}-one" "$AUDIT"
check "editing a link writes an audit entry" "Edited ${RUN}-one" "$AUDIT"
check "the audit entry names the actor" "$EMAIL" "$AUDIT"

# Deletion is the one that matters most after the fact — the row it describes
# is gone, so the audit entry is the only remaining record of it.
BODY=$(curl -s -X POST "$API/links" -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' \
  -d "{\"destination\":\"https://example.com/doomed\",\"domain\":\"localhost:3002\",\"slug\":\"${RUN}-doomed\",\"tags\":[],\"redirectType\":\"302\",\"rules\":[],\"forwardQuery\":true,\"deepLink\":false,\"hideReferrer\":false,\"publicPreview\":true}")
DOOMED_ID=$(echo "$BODY" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).id || ""')
curl -s -o /dev/null -X DELETE "$API/links/$DOOMED_ID" -H "Authorization: Bearer $ACCESS"
check "deleting a link writes an audit entry" "Deleted ${RUN}-doomed" "$(curl -s "$API/audit" -H "Authorization: Bearer $ACCESS")"

echo
echo "== G6: two-factor =="
BODY=$(curl -s -X POST "$API/auth/2fa/setup" -H "Authorization: Bearer $ACCESS")
check "2FA setup returns an otpauth URI (G6)" 'otpauth://totp' "$BODY"
check "2FA rejects a wrong code (G6)" "isn't right" \
  "$(curl -s -X POST "$API/auth/2fa/enable" -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' -d '{"code":"000000"}')"

echo
echo "== G2: logout actually revokes =="
BODY=$(curl -s -X POST "$API/auth/refresh" -H 'Content-Type: application/json' -d "{\"refreshToken\":\"$REFRESH\"}")
check "refresh rotates the token" '"accessToken"' "$BODY"
REFRESH2=$(echo "$BODY" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).refreshToken || ""')

BODY=$(curl -s -X POST "$API/auth/refresh" -H 'Content-Type: application/json' -d "{\"refreshToken\":\"$REFRESH\"}")
check "a reused refresh token is refused" 'already used' "$BODY"

BODY=$(curl -s -X POST "$API/auth/refresh" -H 'Content-Type: application/json' -d "{\"refreshToken\":\"$REFRESH2\"}")
check "reuse revokes the whole family" 'signed out' "$BODY"

echo
echo "== scheduled activation =="
BODY=$(curl -s -X POST "$API/links" -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' \
  -d "{\"destination\":\"https://example.com/launch\",\"domain\":\"localhost:3002\",\"slug\":\"$RUN-sched\",\"activatesAt\":\"2099-01-01T00:00:00.000Z\",\"scheduledTo\":\"https://example.com/teaser\",\"tags\":[],\"redirectType\":\"302\",\"rules\":[],\"forwardQuery\":true,\"deepLink\":false,\"hideReferrer\":false,\"publicPreview\":true}")
check "a future activatesAt reports status scheduled" '"status":"scheduled"' "$BODY"
check "activatesAt is readable back, not write-only"  '"activatesAt":"2099-01-01' "$BODY"
check "scheduledTo is readable back too"              '"scheduledTo":"https://example.com/teaser"' "$BODY"

BODY=$(curl -s "$API/links?status=scheduled" -H "Authorization: Bearer $ACCESS")
check "?status=scheduled finds it" "$RUN-sched" "$BODY"

# The filter that is easy to get wrong: deriveStatus ranks scheduled above
# active, so a link that is not live yet must not appear under Active.
BODY=$(curl -s "$API/links?status=active" -H "Authorization: Bearer $ACCESS")
if echo "$BODY" | grep -q "$RUN-sched"; then
  bad "?status=active excludes a not-yet-live link" "$(echo "$BODY" | head -c 200)"
else
  ok "?status=active excludes a not-yet-live link"
fi

CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/links" -H "Authorization: Bearer $ACCESS" -H 'Content-Type: application/json' \
  -d "{\"destination\":\"https://example.com/impossible\",\"domain\":\"localhost:3002\",\"slug\":\"$RUN-impossible\",\"activatesAt\":\"2099-01-01T00:00:00.000Z\",\"expiresAt\":\"2030-01-01T00:00:00.000Z\",\"tags\":[],\"redirectType\":\"302\",\"rules\":[],\"forwardQuery\":true,\"deepLink\":false,\"hideReferrer\":false,\"publicPreview\":true}")
status "a window that closes before it opens is refused" "400" "$CODE" ""

echo
echo "== csv export =="

HDRS=$(curl -s -D - -o /tmp/smoke-export.csv "$API/links/export" -H "Authorization: Bearer $ACCESS")
echo "$HDRS" | grep -qi "text/csv"   && ok "export returns text/csv"   || bad "export content type" "$(echo "$HDRS" | head -1)"

echo "$HDRS" | grep -qi "content-disposition: attachment"   && ok "export is sent as a download"   || bad "export content-disposition" "missing attachment header"

head -1 /tmp/smoke-export.csv | grep -q "^short_url,destination"   && ok "export has a header row"   || bad "export header row" "$(head -1 /tmp/smoke-export.csv)"

grep -q "$RUN" /tmp/smoke-export.csv   && ok "export contains the links created by this run"   || bad "export contents" "no row matching $RUN"

ALL=$(curl -s "$API/links/export" -H "Authorization: Bearer $ACCESS" | wc -l)
ARCHIVED=$(curl -s "$API/links/export?status=archived" -H "Authorization: Bearer $ACCESS" | wc -l)
[ "$ALL" -gt "$ARCHIVED" ]   && ok "export respects the status filter ($((ALL-1)) all vs $((ARCHIVED-1)) archived)"   || bad "export filter" "all=$ALL archived=$ARCHIVED"

# /links/export must not be routed as /links/:id -- Nest matches in declaration
# order, so a misplaced route turns this into a 404 for a link named "export".
echo "$HDRS" | head -1 | grep -q "200"   && ok "/links/export is not matched as a link id"   || bad "route order" "$(echo "$HDRS" | head -1)"

rm -f /tmp/smoke-export.csv

echo
echo "----------------------------------------"
echo "  $PASSES passed, $FAILS failed"
echo "----------------------------------------"
[ "$FAILS" -eq 0 ]

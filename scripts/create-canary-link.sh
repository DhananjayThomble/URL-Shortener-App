#!/usr/bin/env bash
# #996 — create (idempotently) the dedicated canary short link the CloudWatch
# Synthetics uptime canary follows every 5 minutes.
#
# The canary asserts a link on the short domain returns an EXACT 302 to an EXACT
# Location. That link has to exist and be STABLE: a fixed slug, a fixed
# destination, forwardQuery off (so the Location is the destination verbatim,
# with nothing appended), publicPreview off (it is not a link anyone browses).
# This script creates it, and is safe to re-run — a second run finds the slug
# already taken and exits 0 without changing anything.
#
# It does NOT touch CloudWatch, the canary, or the alarms — those are the CDK
# stack's job (infra/lib/snapurl-stack.ts). This script only seeds the one link
# the deployed canary needs, which is why the issue lists it separately: a link
# is workspace data created through the API, not a CloudFormation resource.
#
# "Excluded from user analytics" is handled on the READ side, not here: the
# canary sends a User-Agent carrying a bot token, and the redirect records every
# click with isBot(userAgent) while the rollup and analytics reader drop
# is_bot=true rows (apps/worker/src/jobs/rollup.ts, apps/api/src/analytics/
# analytics.reader.ts). So the canary's hits never reach any workspace's counts,
# with no special-casing of this slug anywhere in the product.
#
#   usage: bash scripts/create-canary-link.sh
#
# Environment contract:
#   API                 API base URL, including /api/v1.
#                       Default http://localhost:3001/api/v1.
#   CANARY_SLUG         The canary link's back-half. Default "__uptime".
#   CANARY_DESTINATION  Where the canary link resolves. Default
#                       "https://snapurl.in/__canary-ok" (a stable in-domain
#                       path; override to anything the canary's
#                       CANARY_EXPECTED_LOCATION is set to).
#   CANARY_DOMAIN       The domain to create the link on. MUST equal the API's
#                       DEFAULT_DOMAIN. Default "snapurl.in".
#   SMOKE_EMAIL / SMOKE_PASSWORD  Credentials of the account that owns the
#                       canary link. If unset, the script self-registers a
#                       throwaway account (fine for a dev/staging stack).
#
# The emitted Location is CANARY_DESTINATION verbatim, so set the canary's
# CANARY_EXPECTED_LOCATION to the same value.

set -euo pipefail

API="${API:-http://localhost:3001/api/v1}"
CANARY_SLUG="${CANARY_SLUG:-__uptime}"
CANARY_DESTINATION="${CANARY_DESTINATION:-https://snapurl.in/__canary-ok}"
CANARY_DOMAIN="${CANARY_DOMAIN:-snapurl.in}"

say() { printf '%s\n' "$*" >&2; }
die() { say "ERROR: $*"; exit 1; }

command -v curl >/dev/null || die "curl is required"
command -v jq   >/dev/null || die "jq is required"

# ---- authenticate --------------------------------------------------------
ACCESS=""
if [ -n "${SMOKE_EMAIL:-}" ] && [ -n "${SMOKE_PASSWORD:-}" ]; then
  say "logging in as ${SMOKE_EMAIL}"
  ACCESS=$(curl -fsS -X POST "$API/auth/login" -H 'Content-Type: application/json' \
    -d "$(jq -nc --arg e "$SMOKE_EMAIL" --arg p "$SMOKE_PASSWORD" '{email:$e,password:$p}')" \
    | jq -r '.accessToken // .access_token // empty')
  [ -n "$ACCESS" ] || die "login did not return an access token"
else
  EMAIL="canary+$(date +%s)@example.com"
  say "no SMOKE_EMAIL set — self-registering a throwaway account ($EMAIL)"
  ACCESS=$(curl -fsS -X POST "$API/auth/register" -H 'Content-Type: application/json' \
    -d "$(jq -nc --arg e "$EMAIL" '{email:$e,password:"Canary-passw0rd!"}')" \
    | jq -r '.accessToken // .access_token // empty')
  [ -n "$ACCESS" ] || die "register did not return an access token"
fi

# ---- create the canary link (idempotent) ---------------------------------
BODY=$(jq -nc \
  --arg slug "$CANARY_SLUG" \
  --arg dest "$CANARY_DESTINATION" \
  --arg dom  "$CANARY_DOMAIN" \
  '{slug:$slug, destination:$dest, domain:$dom, forwardQuery:false, publicPreview:false, comment:"#996 uptime canary — do not delete"}')

say "creating canary link ${CANARY_DOMAIN}/${CANARY_SLUG} -> ${CANARY_DESTINATION}"
HTTP=$(curl -s -o /tmp/canary-create.out -w '%{http_code}' \
  -X POST "$API/links" \
  -H "Authorization: Bearer $ACCESS" \
  -H 'Content-Type: application/json' \
  -d "$BODY")

case "$HTTP" in
  2??)
    say "canary link created."
    jq -r '"  id=\(.id // "?") slug=\(.slug // "?")"' /tmp/canary-create.out 2>/dev/null >&2 || true
    ;;
  409)
    say "canary link already exists (slug taken) — nothing to do."
    ;;
  422|400)
    # A 422 whose message is the slug being taken is also idempotent-OK; any
    # other validation error is a real failure.
    if grep -qiE "taken|already|in use|exists" /tmp/canary-create.out; then
      say "canary link already exists — nothing to do."
    else
      die "create rejected ($HTTP): $(cat /tmp/canary-create.out)"
    fi
    ;;
  *)
    die "create failed ($HTTP): $(cat /tmp/canary-create.out)"
    ;;
esac

say "done. Set the canary's CANARY_EXPECTED_LOCATION to: ${CANARY_DESTINATION}"
rm -f /tmp/canary-create.out

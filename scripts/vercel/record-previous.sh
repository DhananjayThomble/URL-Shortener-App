#!/usr/bin/env bash
# Record the CURRENT production deployment URL, BEFORE anything changes, so a
# smoke-failure runbook can print the exact command to promote it back.
#
# This step MUST NEVER fail the deploy (#1037, #1041). A first-ever deploy has
# no previous production URL, and a transient lookup failure is not a reason to
# block a deploy — but when it fails it must surface the real error, not
# silently record "<none found>".
#
# MECHANISM (#1041 fail 1): the Vercel REST API list-deployments endpoint
#   GET /v6/deployments?projectId=<id>&teamId=<team>&target=production&limit=1
# with Authorization: Bearer $VERCEL_TOKEN. This addresses the team+project
# directly and does NOT do the CLI's user lookup, which 404s "User not found."
# with this token (the exact failure run 41673569635 swallowed and that also
# breaks `vercel ls`/`inspect`/`promote`). On success it records a REAL previous
# production URL (condition 2's success path, shown at runtime by the rehearsal
# against the real project).
#
# ERREXIT-PROOF: the API helpers capture rc/body/code with errexit off, and this
# script exits 0 unconditionally — the lookup can never fail the deploy.
#
# Inputs (env): VERCEL_TOKEN, VERCEL_ORG_ID (team id), VERCEL_PROJECT_ID.
set -uo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/vercel/lib.sh
. "$here/lib.sh"

: "${VERCEL_ORG_ID:?}" "${VERCEL_TOKEN:?}" "${VERCEL_PROJECT_ID:?}"

rc=0 body="" code=""
vercel_api_get rc body code -- \
  "/v6/deployments?projectId=${VERCEL_PROJECT_ID}&teamId=${VERCEL_ORG_ID}&target=production&state=READY&limit=1"

prev=""
if [ "$rc" -ne 0 ] || ! api_ok "$code"; then
  # Surface the real reason (HTTP code + body), then continue.
  echo "::warning title=Could not list previous production deployment::REST /v6/deployments rc=${rc} http=${code}: ${body}"
else
  prev="$(first_prod_deployment_url "$body")"
fi

gha_output previous_url "${prev}"
echo "Previous production deployment: ${prev:-<none found>}"
# Always succeed: this lookup can never fail the deploy.
exit 0

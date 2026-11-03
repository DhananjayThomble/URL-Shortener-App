#!/usr/bin/env bash
# Promote an already-uploaded deployment to production (assign the production
# domain). No rebuild, no re-upload — the exact artifact validated in web-build
# is what goes live.
#
# MECHANISM (#1041 fail 1): the Vercel REST API, NOT `vercel promote`. Prod run
# 41590226748's promote job ran `vercel promote <url> --token` with
# VERCEL_ORG_ID + VERCEL_PROJECT_ID set (the same env that makes deploy work)
# and still failed with `User not found. (404)` — because `vercel promote`
# resolves scope through the authenticated USER, which this token cannot
# resolve. The REST promote endpoint takes a Bearer token + teamId query param
# and addresses the team/project directly, with no user lookup:
#
#   1. GET  /v13/deployments/{deploymentUrl}?teamId=<team>   -> deployment id
#   2. POST /v10/projects/{projectId}/promote/{deploymentId}?teamId=<team>
#
# GATE (hard failure correct): if either call is not 2xx, fail WITH A MESSAGE
# carrying the HTTP code and body — never a silent exit, never a warning.
#
# !!! PRODUCTION-MUTATING. The rehearsal NEVER runs this script. It exercises
# the SAME auth + endpoint path non-mutatingly (step 1's GET against the promote
# endpoint's own deployment/project) and FAILS if that path can't be proven —
# see rehearse-web-deploy.yml.
#
# Inputs (env): VERCEL_TOKEN, VERCEL_ORG_ID (team id), VERCEL_PROJECT_ID,
# DEPLOYMENT_URL.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/vercel/lib.sh
. "$here/lib.sh"

: "${VERCEL_TOKEN:?}" "${VERCEL_ORG_ID:?}" "${VERCEL_PROJECT_ID:?}"
if [ -z "${DEPLOYMENT_URL:-}" ]; then
  echo "::error title=No web deployment to promote::web-build produced no deployment URL."
  exit 1
fi

host="${DEPLOYMENT_URL#https://}"; host="${host%%/*}"

# 1) Resolve the deployment id from its URL (Bearer + teamId, no user lookup).
rc=0 body="" code=""
vercel_api_get rc body code -- "/v13/deployments/${host}?teamId=${VERCEL_ORG_ID}"
if [ "$rc" -ne 0 ] || ! api_ok "$code"; then
  echo "::error title=Promote failed (resolve deployment)::GET /v13/deployments/${host} rc=${rc} http=${code}: ${body}"
  exit 1
fi
dep_id="$(json_field "$body" uid)"
[ -n "$dep_id" ] || dep_id="$(json_field "$body" id)"
if [ -z "$dep_id" ]; then
  echo "::error title=Promote failed (no deployment id)::could not read a deployment id from GET /v13/deployments/${host}: ${body}"
  exit 1
fi

# 2) Promote: point the project's production domain at this deployment.
rc=0 body="" code=""
vercel_api_post rc body code -- "/v10/projects/${VERCEL_PROJECT_ID}/promote/${dep_id}?teamId=${VERCEL_ORG_ID}"
if [ "$rc" -ne 0 ] || ! api_ok "$code"; then
  echo "::error title=Promote failed::POST /v10/projects/${VERCEL_PROJECT_ID}/promote/${dep_id} rc=${rc} http=${code}: ${body}"
  exit 1
fi
echo "Promoted ${DEPLOYMENT_URL} (deployment ${dep_id}) to production."

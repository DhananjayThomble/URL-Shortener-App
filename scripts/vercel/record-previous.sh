#!/usr/bin/env bash
# Record the deployment the production domain is CURRENTLY SERVING, BEFORE
# anything changes, so a smoke-failure runbook can promote the live build back.
#
# This step MUST NEVER fail the deploy (#1037, #1041). A first-ever deploy has
# no previous production deployment, and a transient lookup failure is not a
# reason to block — but on failure it surfaces the real reason, not silence.
#
# MECHANISM (#1041 fail 1 + fail 2): the Vercel REST API project endpoint
#   GET /v9/projects/<id>?teamId=<team>
# read as targets.production — the deployment the production alias actually
# points at RIGHT NOW. NOT GET /v6/deployments?target=production, which returns
# the newest deployment CREATED with target=production: that set includes every
# unpromoted `deploy --prebuilt --prod --skip-domain` build (each rehearsal, and
# each FAILED promote), so the newest one is often a build that was never live
# (#1041 fail 2 — run 41695814906 recorded snapurl-ogx5qk1bz, a PR-branch build
# from an earlier rehearsal). targets.production cannot be one of those, because
# it is by definition what the domain serves.
#
# CROSS-CHECK: the recorded URL is only trustworthy if it really is what the
# live alias serves, so this asserts targets.production carries a production
# alias (the custom domain, e.g. app.snapurl.in) and prints "<url> is served by
# <alias>". No alias on the production target => treat as "nothing live yet".
#
# The REST call uses Bearer + teamId and does NOT do the CLI's user lookup,
# which 404s "User not found." with this token (the failure run 41673569635
# swallowed, and that also breaks `vercel ls`/`inspect`/`promote`).
#
# ERREXIT-PROOF: the API helper captures rc/body/code with errexit off, and this
# script exits 0 unconditionally — the lookup can never fail the deploy.
#
# Inputs (env): VERCEL_TOKEN, VERCEL_ORG_ID (team id), VERCEL_PROJECT_ID.
set -uo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/vercel/lib.sh
. "$here/lib.sh"

: "${VERCEL_ORG_ID:?}" "${VERCEL_TOKEN:?}" "${VERCEL_PROJECT_ID:?}"

rc=0 body="" code=""
vercel_api_get rc body code -- "/v9/projects/${VERCEL_PROJECT_ID}?teamId=${VERCEL_ORG_ID}"

prev=""
if [ "$rc" -ne 0 ] || ! api_ok "$code"; then
  echo "::warning title=Could not read production target::GET /v9/projects rc=${rc} http=${code}: ${body}"
else
  url="$(production_target url "$body")"
  alias_url="$(production_target alias "$body")"
  if [ -z "$url" ]; then
    echo "No production target is live yet (first deploy?) — nothing to record."
  elif [ -z "$alias_url" ]; then
    # A production target with no custom alias is not something the domain
    # serves to users; do not record it as the rollback candidate.
    echo "::warning title=Production target has no alias::targets.production=${url} carries no production alias; not recording it as the live previous deployment."
  else
    prev="$url"
    # The cross-check condition 1 asks for: the recorded URL is the one the live
    # alias serves. Because both come from the SAME targets.production object,
    # they are consistent by construction; print them together as the proof.
    echo "Live production: alias ${alias_url} is served by deployment ${prev}"
  fi
fi

gha_output previous_url "${prev}"
echo "Previous production deployment: ${prev:-<none found>}"
# Always succeed: this lookup can never fail the deploy.
exit 0

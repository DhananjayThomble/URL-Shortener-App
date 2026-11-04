#!/usr/bin/env bash
# Record the deployment the production domain is CURRENTLY SERVING, BEFORE
# anything changes, so a smoke-failure runbook can promote the live build back.
#
# This step MUST NEVER fail the deploy (#1037, #1041). A first-ever deploy has
# no live production deployment, and a transient lookup failure is not a reason
# to block — but on failure it surfaces the real reason, not silence.
#
# MECHANISM (#1041 fail 1 + fail 2): resolve the production ALIAS to the
# deployment it points at, via two REST reads (Bearer + teamId, no user lookup):
#   1. GET /v9/projects/<id>/domains?production=true
#        -> the verified custom production domain (e.g. app.snapurl.in).
#        NOTE: `production` and `target` are mutually exclusive on this endpoint
#        (400 "Cannot use both"), so only `production=true` is passed.
#   2. GET /v4/aliases/<domain>
#        -> deployment.url : the build the domain ACTUALLY serves right now
#
# Why not GET /v6/deployments?target=production (fail 2): its newest entry is
# the newest build CREATED with production target, which includes every
# unpromoted `deploy --prebuilt --prod --skip-domain` build (rehearsals, failed
# promotes) — so it can point at a build that was never live (run 41695814906
# recorded snapurl-ogx5qk1bz; run 41698880451 saw targets.production orphaned on
# snapurl-raxjnarqn with NO alias). Resolving the alias cannot do that: it is,
# by definition, what the domain serves. The URL recorded here IS the alias
# target, so the "previous URL == live alias" cross-check is intrinsic — the
# log prints "alias <domain> is served by deployment <url>".
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

prev=""
warn() { echo "::warning title=Could not read live production deployment::$1"; }

# 1) The verified custom production domain.
rc=0 body="" code=""
vercel_api_get rc body code -- \
  "/v9/projects/${VERCEL_PROJECT_ID}/domains?teamId=${VERCEL_ORG_ID}&production=true"
if [ "$rc" -ne 0 ] || ! api_ok "$code"; then
  warn "GET /v9/projects/<id>/domains rc=${rc} http=${code}: ${body}"
else
  domain="$(production_domain_name "$body")"
  if [ -z "$domain" ]; then
    echo "No verified custom production domain on this project yet — nothing live to record."
  else
    # 2) The deployment that domain actually points at.
    rc=0 abody="" code=""
    vercel_api_get rc abody code -- "/v4/aliases/${domain}?teamId=${VERCEL_ORG_ID}"
    if [ "$rc" -ne 0 ] || ! api_ok "$code"; then
      warn "GET /v4/aliases/${domain} rc=${rc} http=${code}: ${abody}"
    else
      url="$(alias_deployment_field url "$abody")"
      if [ -z "$url" ]; then
        echo "Production alias ${domain} resolves to no deployment yet — nothing to record."
      else
        prev="$url"
        # The recorded URL IS the alias target, so this line is the cross-check
        # condition 1 asks for: previous URL == what the live alias serves.
        echo "Live production: alias https://${domain} is served by deployment ${prev}"
      fi
    fi
  fi
fi

gha_output previous_url "${prev}"
echo "Previous production deployment: ${prev:-<none found>}"
# Always succeed: this lookup can never fail the deploy.
exit 0

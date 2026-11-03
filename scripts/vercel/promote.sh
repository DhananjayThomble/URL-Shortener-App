#!/usr/bin/env bash
# vercel promote <deployment>: assign the production domain to an
# already-uploaded deployment. No rebuild, no re-upload — the exact artifact
# validated in web-build is what goes live.
#
# This runs in a SEPARATE job from web-build (web-promote), so it has NOT run
# `vercel pull` and carries no project link. The team-scoped VERCEL_TOKEN then
# fails the CLI's personal-account lookup with "User not found. (404)" unless
# --scope is explicit (#1037) — so --scope "$VERCEL_ORG_ID" is passed.
#
# GATE (errexit correct), and it fails with a MESSAGE on an empty URL rather
# than exiting silently.
#
# !!! PRODUCTION-MUTATING. The rehearsal workflow NEVER calls this script. The
# rehearsal exercises the promote PATH (same scope+token+CLI flags) with a
# non-mutating `vercel inspect` against its own deployment instead — see
# rehearse-web-deploy.yml.
#
# Inputs (env): VERCEL_TOKEN, VERCEL_ORG_ID, VERCEL_CLI_VERSION, DEPLOYMENT_URL.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/vercel/lib.sh
. "$here/lib.sh"

: "${VERCEL_TOKEN:?}" "${VERCEL_ORG_ID:?}"
if [ -z "${DEPLOYMENT_URL:-}" ]; then
  echo "::error title=No web deployment to promote::web-build produced no deployment URL."
  exit 1
fi
# shellcheck disable=SC2046
$(vercel_cli) promote "${DEPLOYMENT_URL}" --scope "$VERCEL_ORG_ID" --token "$VERCEL_TOKEN"
echo "Promoted ${DEPLOYMENT_URL} to production."

#!/usr/bin/env bash
# vercel promote <deployment>: assign the production domain to an
# already-uploaded deployment. No rebuild, no re-upload — the exact artifact
# validated in web-build is what goes live.
#
# This runs in a SEPARATE job from web-build (web-promote), so it has NOT run
# `vercel pull` and carries no project link.
#
# SCOPE RESOLUTION — why pull-then-promote, not `promote --scope <id>` (#1041).
# The rehearsal (run 41687674985, real token) proved that a pre-link call with
# `--scope "$VERCEL_ORG_ID"` (a team_<id>) + token still fails the account
# lookup with "User not found. (404)": the team-id scope does NOT by itself
# resolve the user for a command that must address the team's project. The
# reliable scoping is the project LINK that `vercel pull` writes into .vercel/
# from VERCEL_ORG_ID / VERCEL_PROJECT_ID (no user lookup). So this script PULLS
# first (same as web-build does before its build), then promotes WITHOUT
# --scope, inheriting the link. This is what makes the real promote — which has
# never actually run in production, every prior dispatch died earlier — work.
#
# GATE (errexit correct), and it fails with a MESSAGE on an empty URL rather
# than exiting silently.
#
# !!! PRODUCTION-MUTATING. The rehearsal workflow NEVER calls this script. It
# exercises the promote PATH (pull-then-link-scoped read) with a non-mutating
# `vercel ls` against its own deployment instead — see rehearse-web-deploy.yml.
#
# Inputs (env): VERCEL_TOKEN, VERCEL_ORG_ID, VERCEL_PROJECT_ID,
# VERCEL_CLI_VERSION, DEPLOYMENT_URL.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/vercel/lib.sh
. "$here/lib.sh"

: "${VERCEL_TOKEN:?}" "${VERCEL_ORG_ID:?}" "${VERCEL_PROJECT_ID:?}"
if [ -z "${DEPLOYMENT_URL:-}" ]; then
  echo "::error title=No web deployment to promote::web-build produced no deployment URL."
  exit 1
fi

# Establish the project link WITHOUT a user lookup. pull reads the project from
# VERCEL_ORG_ID / VERCEL_PROJECT_ID in env, so it needs no --scope and does not
# hit the 404-prone account-load path. .vercel/ is scratch on the runner.
# shellcheck disable=SC2046
$(vercel_cli) pull --yes --environment=production --token "$VERCEL_TOKEN"

# Now the link scopes the promote; no --scope needed (and --scope <team_id>
# would re-enter the failing user-load path).
# shellcheck disable=SC2046
$(vercel_cli) promote "${DEPLOYMENT_URL}" --token "$VERCEL_TOKEN"
echo "Promoted ${DEPLOYMENT_URL} to production."

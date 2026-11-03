#!/usr/bin/env bash
# vercel pull (production): write the project settings for the production
# environment into .vercel/ (project linkage comes from VERCEL_ORG_ID /
# VERCEL_PROJECT_ID in env), so the subsequent build uses production settings.
# .vercel/ is scratch on the runner and is gitignored.
#
# This is a GATE: if pull fails, the deploy must stop, so errexit is correct
# here. `pull` is the call that ESTABLISHES the project link, so it self-scopes
# from VERCEL_ORG_ID/PROJECT_ID in env and needs no --scope.
#
# Inputs (env): VERCEL_TOKEN, VERCEL_ORG_ID, VERCEL_PROJECT_ID, VERCEL_CLI_VERSION.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/vercel/lib.sh
. "$here/lib.sh"

: "${VERCEL_TOKEN:?}"
# shellcheck disable=SC2046
$(vercel_cli) pull --yes --environment=production --token "$VERCEL_TOKEN"

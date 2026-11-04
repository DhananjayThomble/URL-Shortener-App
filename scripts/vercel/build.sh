#!/usr/bin/env bash
# vercel build (production): THE build gate. Runs the project's build (web's
# vercel-build via Root Directory = web) at the deploy ref and produces
# .vercel/output. No deployment is created by this step. A web build that does
# not compile fails HERE, before the API deploy — errexit is correct.
#
# Runs after pull in the SAME job, so the project link in .vercel/ scopes it;
# no --scope needed.
#
# Inputs (env): VERCEL_TOKEN, VERCEL_CLI_VERSION.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/vercel/lib.sh
. "$here/lib.sh"

: "${VERCEL_TOKEN:?}"
# shellcheck disable=SC2046
$(vercel_cli) build --prod --token "$VERCEL_TOKEN"

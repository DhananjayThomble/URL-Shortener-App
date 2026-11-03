#!/usr/bin/env bash
# vercel deploy --prebuilt --prod --skip-domain: upload the PREBUILT output as a
# production deployment but DO NOT assign the domain. The build is now live at a
# unique URL; production traffic still goes to the previous build until promote.
#
# This is a GATE (errexit correct) AND it must fail with a MESSAGE if the CLI
# prints no deployment URL — a hard failure that exits silently is one of the
# bug-class faults this change audits out. Runs after pull in the same job, so
# the project link scopes it; no --scope needed.
#
# Inputs (env): VERCEL_TOKEN, VERCEL_CLI_VERSION. Output: deployment_url.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/vercel/lib.sh
. "$here/lib.sh"

: "${VERCEL_TOKEN:?}"
# shellcheck disable=SC2046
url="$($(vercel_cli) deploy --prebuilt --prod --skip-domain --token "$VERCEL_TOKEN")"
if ! [[ "$url" =~ ^https://[A-Za-z0-9.-]+\.vercel\.app$ ]]; then
  echo "::error title=Web deploy produced no URL::vercel deploy did not print a deployment URL. Output: $url"
  exit 1
fi
gha_output deployment_url "${url}"
echo "Deployed (domain not yet assigned): ${url}"

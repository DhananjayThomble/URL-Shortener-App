#!/usr/bin/env bash
# Create (or update) the Parameter Store values the stack reads.
#
#   ./infra/bin/put-parameters.sh /snapurl/prod https://snapurl.vercel.app https://snap.to
#
# The stack has no defaults for these on purpose — a default in the CDK would be
# a second copy of a value apps/api/src/config/env.ts already defaults, and the
# two would drift. A missing parameter fails the deploy naming the parameter,
# which is a better time to find out than the first request.
#
# Safe to re-run: `put-parameter --overwrite` is idempotent, and running it
# again after changing a value is how a config change is made. The change takes
# effect on the next `cdk deploy`, not immediately — the values are resolved by
# CloudFormation at deploy time (see infra/lib/config.ts for why).
set -euo pipefail

PREFIX="${1:?usage: put-parameters.sh <prefix> <web-origin> <redirect-origin>}"
WEB_ORIGIN="${2:?missing web origin, e.g. https://snapurl.vercel.app}"
REDIRECT_ORIGIN="${3:?missing redirect origin, e.g. https://snap.to}"
PREFIX="${PREFIX%/}"

put() {
  echo "  ${PREFIX}/$1 = $2"
  aws ssm put-parameter --name "${PREFIX}/$1" --value "$2" --type String --overwrite >/dev/null
}

echo "Writing SnapURL configuration to ${PREFIX}"
put web-origin           "$WEB_ORIGIN"
put redirect-origin      "$REDIRECT_ORIGIN"
# The short domain new workspaces are given. The host only — no scheme.
put default-domain       "${REDIRECT_ORIGIN#*://}"
put log-level            "info"
put mail-from            "SnapURL <no-reply@snapurl.local>"
# `ses` needs egress, which this topology does not have — see docs/DEPLOYMENT.md.
put mail-transport       "outbox"
put throttle-limit       "120"
put throttle-ttl-seconds "60"

echo
echo "Done. Secrets are not set here: the database password and the two JWT"
echo "signing keys are generated into Secrets Manager by the stack itself, so"
echo "no secret is ever typed on a command line or stored in this repository."

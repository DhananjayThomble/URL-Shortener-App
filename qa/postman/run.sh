#!/usr/bin/env bash
# Run the Newman collection against the local staging stack (pnpm staging:up).
#
# The "Team invitations (#668)" folder reads invite/verification tokens out of
# the api container's mail outbox through qa/postman/mail-sink.mjs (loopback
# only), so this starts the sink for the duration of the run. Extra arguments
# are passed through to newman, e.g. `--folder "Team invitations (#668)"`.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
port="${MAIL_SINK_PORT:-3099}"

MAIL_SINK_PORT="$port" node "$here/mail-sink.mjs" &
sink=$!
trap 'kill "$sink" 2>/dev/null || true' EXIT

for _ in $(seq 1 40); do
  curl -fsS "http://127.0.0.1:$port/health" >/dev/null 2>&1 && break
  sleep 0.25
done

npx -y newman@6 run "$here/snapurl.postman_collection.json" \
  -e "$here/local.postman_environment.json" \
  --env-var "mailSinkUrl=http://127.0.0.1:$port" "$@"

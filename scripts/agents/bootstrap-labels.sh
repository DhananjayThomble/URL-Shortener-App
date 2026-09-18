#!/usr/bin/env bash
# Creates (or updates) the labels the agent board uses. Safe to re-run.
set -euo pipefail
REPO="${REPO:-DhananjayThomble/URL-Shortener-App}"

while IFS='|' read -r name color desc; do
  gh label create "$name" -R "$REPO" --color "$color" --description "$desc" --force >/dev/null
  echo "ok  $name"
done <<'EOF'
agents:paused|b60205|Kill switch: while any open issue has this label, agents stop
agent:ready|0e8a16|Scoped and unblocked; an agent may pick it up
agent:in-progress|fbca04|Claimed by a developer agent
agent:pr-open|1d76db|A PR for this issue is open
agent:changes-requested|d93f0b|Reviewer agent asked for changes
agent:approved|5319e7|Reviewer agent approved; merges when CI gate is green
agent:blocked|000000|Agent cannot proceed; see the latest comment
qa:agent-confirmed|c5def5|QA finding reproduced and filed by the reviewer agent
needs-human|b60205|Agent-approved PR that only the maintainer may merge (changes CI workflows)
EOF

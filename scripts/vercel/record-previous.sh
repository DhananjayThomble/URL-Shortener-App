#!/usr/bin/env bash
# Record the CURRENT production deployment URL, BEFORE anything changes, so a
# smoke-failure runbook can print the exact command to promote it back.
#
# This step MUST NEVER fail the deploy (#1037, #1041). A first-ever deploy has
# no previous production URL, and a transient `vercel ls` failure is not a
# reason to block a deploy — but when it fails it must surface the CLI's real
# error text, not silently record "<none found>".
#
# The bug this fixes (run 41673569635): the previous inline step wrote
# `set -uo pipefail` and then `ls_out="$(vercel ls ...)"; ls_rc=$?`. Because
# Actions runs the block as `bash -e {0}`, errexit killed the script on the
# failed command substitution BEFORE `ls_rc=$?`, so the soft-fail branch was
# dead code and the step exited 1 with no output. vercel_capture runs the CLI
# with errexit off, so rc and output are always captured and the warn-continue
# path actually runs.
#
# Inputs (env): VERCEL_TOKEN, VERCEL_ORG_ID, VERCEL_PROJECT_ID (checked by the
# caller/require step), VERCEL_CLI_VERSION. Output: previous_url (via
# gha_output). This job has NOT run `vercel pull`, so there is no project link
# to scope the CLI from — the team-scoped VERCEL_TOKEN would then fail the CLI's
# personal-account lookup with "User not found. (404)", so --scope is explicit.
set -uo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/vercel/lib.sh
. "$here/lib.sh"

: "${VERCEL_ORG_ID:?}" "${VERCEL_TOKEN:?}"

ls_rc=0
ls_out=""
# shellcheck disable=SC2046  # vercel_cli emits a 3-word prefix we want split.
vercel_capture ls_rc ls_out -- $(vercel_cli) ls --prod \
  --scope "$VERCEL_ORG_ID" --token "$VERCEL_TOKEN"

if [ "$ls_rc" -ne 0 ]; then
  # Surface the REAL CLI error text (captured, not swallowed) and continue.
  echo "::warning title=Could not list previous production deployment::vercel ls --prod exited ${ls_rc}: ${ls_out}"
  prev=""
else
  prev="$(printf '%s\n' "$ls_out" \
          | grep -Eo 'https://[A-Za-z0-9.-]+\.vercel\.app' | head -1 || true)"
fi

gha_output previous_url "${prev}"
echo "Previous production deployment: ${prev:-<none found>}"
# Always succeed: this lookup can never fail the deploy.
exit 0

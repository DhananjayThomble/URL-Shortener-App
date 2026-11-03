#!/usr/bin/env bash
# Shared helpers for the Vercel steps of deploy-aws.yml AND the rehearsal
# workflow (rehearse-web-deploy.yml). This file is the SINGLE source of the
# Vercel command lines the production deploy runs: both workflows source it, so
# the rehearsal cannot drift from the real deploy. The deploy-sync guard
# (scripts/deploy-sync-guard.test.mjs) reds if either workflow stops routing a
# Vercel call through here.
#
# Why a shell library and not a composite action: these steps already live as
# `run:` blocks in two workflows, the logic is a handful of CLI calls, and a
# pure-bash file is what the stubbed-vercel failure-path test
# (scripts/vercel/vercel-steps.test.mjs) can drive directly with a fake `vercel`
# on PATH — no Actions runner needed. A composite action would need act or a
# live runner to exercise its failure paths.
#
# ERREXIT DISCIPLINE — the bug this whole change exists to kill (#1041, run
# 41673569635). GitHub Actions runs every `run:` block as `bash -e {0}`, so
# errexit is ON even when a step writes `set -uo pipefail` (no -e). A step that
# MEANT to soft-fail — capture a command's non-zero exit in `rc=$?` and warn —
# never reaches the `rc=$?` line, because errexit kills the script on the failed
# command substitution first. `vercel_capture` below is the fix: it runs the
# command with errexit temporarily OFF so the caller always gets both the exit
# code and the output, and can then decide to warn-and-continue or fail-hard.

# vercel_cli: echo the pinned `pnpm dlx vercel@<version>` prefix. One place so
# every call uses the same pinned CLI (VERCEL_CLI_VERSION), never vercel@latest.
#
# VERCEL_CMD override: the stubbed-vercel failure-path test
# (scripts/vercel/vercel-steps.test.mjs) sets VERCEL_CMD to a fake executable so
# it can drive the scripts' failure paths without the network or a real CLI. It
# is UNSET in the real deploy and the real rehearsal, so both run the pinned
# `pnpm dlx vercel@<version>` — the override exists only for the test and never
# changes production behaviour.
vercel_cli() {
  if [ -n "${VERCEL_CMD:-}" ]; then
    printf '%s' "$VERCEL_CMD"
    return 0
  fi
  : "${VERCEL_CLI_VERSION:?VERCEL_CLI_VERSION must be set (pin the Vercel CLI)}"
  printf 'pnpm dlx vercel@%s' "$VERCEL_CLI_VERSION"
}

# vercel_capture VAR_RC VAR_OUT -- <cmd...>
#   Run <cmd...> with errexit DISABLED for exactly that call, capturing combined
#   stdout+stderr into VAR_OUT and the exit code into VAR_RC. Always returns 0
#   itself, so a caller under `bash -e` keeps running and can inspect VAR_RC.
#   This is the errexit-proof replacement for `out="$(cmd 2>&1)"; rc=$?`, whose
#   `rc=$?` line is dead code under errexit when cmd fails.
vercel_capture() {
  local __rc_var="$1" __out_var="$2"
  shift 2
  [ "$1" = "--" ] && shift
  local __out __rc
  # Disable errexit around the capture, restore the caller's setting after.
  local __had_e=0
  case "$-" in *e*) __had_e=1 ;; esac
  set +e
  __out="$("$@" 2>&1)"
  __rc=$?
  [ "$__had_e" -eq 1 ] && set -e
  printf -v "$__rc_var" '%s' "$__rc"
  printf -v "$__out_var" '%s' "$__out"
  return 0
}

# gha_output KEY VALUE -- append KEY=VALUE to $GITHUB_OUTPUT when it is set
# (in CI) and otherwise print it, so the scripts are runnable and testable
# outside Actions without a GITHUB_OUTPUT file.
gha_output() {
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    printf '%s=%s\n' "$1" "$2" >> "$GITHUB_OUTPUT"
  else
    printf '[output] %s=%s\n' "$1" "$2"
  fi
}

# require_vercel_creds -- fail fast, with a message, on any missing credential.
# Shared by the real deploy's "Require Vercel credentials" step and the
# rehearsal, so both fail identically and before any CLI call.
require_vercel_creds() {
  local missing=()
  [ -n "${VERCEL_TOKEN:-}" ]      || missing+=("VERCEL_TOKEN (secret)")
  [ -n "${VERCEL_ORG_ID:-}" ]     || missing+=("VERCEL_ORG_ID (variable)")
  [ -n "${VERCEL_PROJECT_ID:-}" ] || missing+=("VERCEL_PROJECT_ID (variable)")
  if [ "${#missing[@]}" -gt 0 ]; then
    echo "::error title=Missing Vercel credentials::${missing[*]} — set them in GitHub (see docs/DEPLOYMENT.md)."
    return 1
  fi
  echo "Vercel credentials present."
}

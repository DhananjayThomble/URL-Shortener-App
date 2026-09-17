#!/usr/bin/env bash
# Autonomous SDLC loop. See docs/AGENTIC-DEV.md.
#
#   HOURS=6 bash scripts/agents/autopilot.sh
#
# Each cycle: kill-switch check → manager → reviewer → merge approved PRs →
# developer(s) → one rotating QA/UX/security/cloud run → sleep.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"

REPO="${REPO:-DhananjayThomble/URL-Shortener-App}"
HOURS="${HOURS:-4}"
SLEEP_MIN="${SLEEP_MIN:-10}"
DEVS_PER_CYCLE="${DEVS_PER_CYCLE:-1}"
AGENT_TIMEOUT="${AGENT_TIMEOUT:-90m}"
# Engine per role: "claude" or "kiro". The reviewer must use a different engine
# from the developer and QA roles so no model grades its own work.
ENGINE_MANAGER="${ENGINE_MANAGER:-claude}"
ENGINE_REVIEWER="${ENGINE_REVIEWER:-claude}"
ENGINE_DEVELOPER="${ENGINE_DEVELOPER:-kiro}"
ENGINE_QA="${ENGINE_QA:-kiro}"
CLAUDE_MODEL_REVIEWER="${CLAUDE_MODEL_REVIEWER:-opus}"
CLAUDE_MODEL_DEFAULT="${CLAUDE_MODEL_DEFAULT:-sonnet}"

[ -n "${AGENT_GH_TOKEN:-}" ] && export GH_TOKEN="$AGENT_GH_TOKEN"

LOG_DIR=".agent-logs/$(date -u +%Y%m%d)"
mkdir -p "$LOG_DIR"
log() { echo "[$(date -u +%H:%M:%S)] $*" | tee -a "$LOG_DIR/autopilot.log"; }

paused() {
  [ -f .agents-paused ] && return 0
  [ "$(gh issue list -R "$REPO" --state open --label agents:paused --json number -q 'length')" != "0" ]
}

run_agent() { # role engine task
  local role=$1 engine=$2 task=$3 out
  out="$LOG_DIR/$(date -u +%H%M%S)-$role.log"
  log "→ $role ($engine)"
  if [ "$engine" = "claude" ]; then
    local model=$CLAUDE_MODEL_DEFAULT
    [ "$role" = "reviewer" ] && model=$CLAUDE_MODEL_REVIEWER
    timeout "$AGENT_TIMEOUT" claude -p "$task" --agent "snapurl-$role" --model "$model" \
      --dangerously-skip-permissions >"$out" 2>&1
  else
    timeout "$AGENT_TIMEOUT" kiro-cli chat --no-interactive --trust-all-tools \
      --agent "snapurl-$role" "$task" >"$out" 2>&1
  fi
  local rc=$?
  log "← $role exit $rc ($out)"
  # A usage-limit or auth failure should not burn the rest of the cycle retrying.
  if grep -qiE "usage limit|rate limit|quota|not logged in|unauthori[sz]ed" "$out"; then
    log "!! $role hit a limit or auth error; skipping the rest of this cycle"
    return 99
  fi
  return 0
}

OPS_REPO="${OPS_REPO:-DhananjayThomble/snapurl-ops}"
export OPS_DIR="${OPS_DIR:-$HOME/snapurl-ops}"

ops_pull() {
  [ -d "$OPS_DIR/.git" ] || gh repo clone "$OPS_REPO" "$OPS_DIR" -- -q
  git -C "$OPS_DIR" pull -q --rebase origin main
}

ops_push() {
  git -C "$OPS_DIR" add -A
  git -C "$OPS_DIR" diff --cached --quiet && return 0
  git -C "$OPS_DIR" commit -q -m "reviewer: adjudication $(date -u +%FT%TZ)"
  git -C "$OPS_DIR" pull -q --rebase origin main && git -C "$OPS_DIR" push -q origin HEAD:main \
    || log "ops repo push failed"
}

# The PR's own change, independent of which main it was merged with.
patch_id() {
  git diff "$(git merge-base origin/main "$1")" "$1" | git patch-id --stable | cut -d' ' -f1
}

# An approval survives `gh pr update-branch` (main merged in, same change) but not new work.
approval_holds() { # pr approved-sha head-sha
  [ -n "$2" ] || return 1
  [ "$2" = "$3" ] && return 0
  git fetch -q origin "pull/$1/head" || return 1
  git merge-base --is-ancestor "$2" "$3" || return 1
  [ "$(patch_id "$2")" = "$(patch_id "$3")" ]
}

merge_approved() {
  local prs
  prs=$(gh pr list -R "$REPO" --state open --label agent:approved --json number -q '.[].number')
  for n in $prs; do
    local info head approved gate state
    info=$(gh pr view "$n" -R "$REPO" --json headRefOid,mergeStateStatus,files,comments,statusCheckRollup,labels)
    head=$(jq -r .headRefOid <<<"$info")
    state=$(jq -r .mergeStateStatus <<<"$info")
    approved=$(jq -r '[.comments[].body | capture("agent-approved-sha: (?<s>[0-9a-f]{40})") | .s] | last // ""' <<<"$info")
    gate=$(jq -r '[.statusCheckRollup[] | select(.name=="CI gate") | .conclusion] | last // ""' <<<"$info")

    if jq -e '[.files[].path | select(startswith(".github/workflows/"))] | length > 0' <<<"$info" >/dev/null; then
      if ! jq -e '[.labels[].name] | index("needs-human")' <<<"$info" >/dev/null; then
        log "PR #$n: changes CI workflows; leaving it for the maintainer"
        gh pr edit "$n" -R "$REPO" --add-label needs-human >/dev/null
      fi
      continue
    fi
    if ! approval_holds "$n" "$approved" "$head"; then
      log "PR #$n: changed since approval; sending back to review"
      gh pr edit "$n" -R "$REPO" --remove-label agent:approved >/dev/null
      continue
    fi
    case "$state" in
      BEHIND)
        log "PR #$n: behind main; updating branch (CI will re-run)"
        gh pr update-branch "$n" -R "$REPO" >/dev/null || log "PR #$n: update-branch failed (conflict?)"
        ;;
      DIRTY)
        log "PR #$n: merge conflict; back to the developer"
        gh pr edit "$n" -R "$REPO" --remove-label agent:approved --add-label agent:changes-requested >/dev/null
        gh pr comment "$n" -R "$REPO" --body "Autopilot: this PR conflicts with \`main\`. Rebase or merge \`main\` and resolve the conflict." >/dev/null
        ;;
      *)
        if [ "$gate" = "SUCCESS" ]; then
          log "PR #$n: approved change, CI gate green at $head; merging"
          gh pr merge "$n" -R "$REPO" --squash --delete-branch --match-head-commit "$head" \
            || log "PR #$n: merge failed (state $state)"
        else
          log "PR #$n: approved, CI gate '${gate:-pending}' (state $state); waiting"
        fi
        ;;
    esac
  done
}

ROTATION=(qa:desktop qa:mobile ux security qa:desktop qa:mobile cloud)
END=$(( $(date +%s) + HOURS * 3600 ))
cycle=0

while [ "$(date +%s)" -lt "$END" ]; do
  if paused; then log "paused (agents:paused label or .agents-paused file)"; break; fi
  cycle=$((cycle + 1)); log "=== cycle $cycle ==="
  git fetch -q origin

  run_agent manager "$ENGINE_MANAGER" "Run your triage pass on $REPO now." || { sleep $((SLEEP_MIN*60)); continue; }
  ops_pull || log "ops repo pull failed; reviewer will see stale findings"
  run_agent reviewer "$ENGINE_REVIEWER" "Do part A (review open PRs) and part B (adjudicate QA findings) now."
  rc=$?
  ops_push
  [ "$rc" -eq 0 ] || { sleep $((SLEEP_MIN*60)); continue; }
  merge_approved

  for _ in $(seq 1 "$DEVS_PER_CYCLE"); do
    paused && break
    run_agent developer "$ENGINE_DEVELOPER" "Take the next piece of work and carry it to an open PR." || break
  done

  slot=${ROTATION[$(( (cycle - 1) % ${#ROTATION[@]} ))]}
  role=${slot%%:*}; focus=${slot#*:}
  paused || run_agent "$role" "$ENGINE_QA" "Run one $role session now. Focus: $focus."

  log "cycle $cycle done; sleeping ${SLEEP_MIN}m"
  sleep $((SLEEP_MIN * 60))
done
log "autopilot stopped"

#!/usr/bin/env bash
# Autonomous SDLC loop. See docs/AGENTIC-DEV.md.
#
#   HOURS=6 bash scripts/agents/autopilot.sh
#
# Each cycle: kill-switch check → engine mode → manager → reviewer → merge approved PRs →
# developer(s) → every SLOT_EVERY cycles, one ROTATION role (default: cloud) → sleep.
# Any role runs on Claude Code or Kiro CLI; see "Engines" below and docs/AGENTIC-DEV.md.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"

REPO="${REPO:-DhananjayThomble/URL-Shortener-App}"
HOURS="${HOURS:-4}"
SLEEP_MIN="${SLEEP_MIN:-10}"
DEVS_PER_CYCLE="${DEVS_PER_CYCLE:-1}"
AGENT_TIMEOUT="${AGENT_TIMEOUT:-90m}"
# On the Factory this points at /run, so a reboot clears a pause and the host comes back working.
PAUSE_FILE="${PAUSE_FILE:-.agents-paused}"
# Engines. Every role can run on either "claude" (Claude Code) or "kiro" (Kiro CLI); both read the
# same prompts, steering and shared memory. ENGINE_<ROLE> is each role's preferred engine in auto
# mode. The engine mode (auto | claude | kiro) is re-read every cycle, first match wins:
#   1. an open issue labelled engine:claude or engine:kiro   (switch from a phone)
#   2. $STATE_DIR/engine-mode                                 (factory-engine on the host)
#   3. $ENGINE_MODE                                           (default auto)
# In auto mode an engine that hits a usage or credit limit cools down for COOLDOWN_MIN and its
# roles run on the other engine meanwhile. A forced engine that is limited runs nothing.
ENGINE_MODE="${ENGINE_MODE:-auto}"
ENGINE_MANAGER="${ENGINE_MANAGER:-claude}"
ENGINE_REVIEWER="${ENGINE_REVIEWER:-claude}"
ENGINE_DEVELOPER="${ENGINE_DEVELOPER:-kiro}"
ENGINE_QA="${ENGINE_QA:-kiro}"
COOLDOWN_MIN="${COOLDOWN_MIN:-60}"
STATE_DIR="${STATE_DIR:-.agent-state}"
# Models per engine. The reviewer is always on an Opus-class model and every other role is not,
# so whichever engines are in use, no model reviews its own work.
CLAUDE_MODEL_REVIEWER="${CLAUDE_MODEL_REVIEWER:-opus}"
CLAUDE_MODEL_DEFAULT="${CLAUDE_MODEL_DEFAULT:-sonnet}"
KIRO_MODEL_REVIEWER="${KIRO_MODEL_REVIEWER:-claude-opus-5}"
KIRO_MODEL_DEFAULT="${KIRO_MODEL_DEFAULT:-claude-sonnet-5}"

[ -n "${AGENT_GH_TOKEN:-}" ] && export GH_TOKEN="$AGENT_GH_TOKEN"

LOG_DIR=".agent-logs/$(date -u +%Y%m%d)"
mkdir -p "$LOG_DIR" "$STATE_DIR"
log() { echo "[$(date -u +%H:%M:%S)] $*" | tee -a "$LOG_DIR/autopilot.log" >&2; }

paused() {
  [ -f "$PAUSE_FILE" ] && return 0
  [ "$(gh issue list -R "$REPO" --state open --label agents:paused --json number -q 'length')" != "0" ]
}

# Prints auto, claude or kiro. Labels beat the state file, which beats the environment.
engine_mode() {
  local labels file
  labels=$(gh issue list -R "$REPO" --state open --search "label:engine:claude,engine:kiro" \
    --json labels -q '[.[].labels[].name | select(startswith("engine:"))] | unique | join(" ")' 2>/dev/null)
  case "$labels" in
    "engine:claude engine:kiro") log "both engine:claude and engine:kiro labels are on open issues; ignoring both" ;;
    "engine:claude") echo claude; return ;;
    "engine:kiro") echo kiro; return ;;
  esac
  file=$(tr -d '[:space:]' < "$STATE_DIR/engine-mode" 2>/dev/null)
  case "$file" in claude|kiro|auto) echo "$file"; return ;; esac
  echo "$ENGINE_MODE"
}

other_engine() { [ "$1" = claude ] && echo kiro || echo claude; }
cooling() { [ "$(date +%s)" -lt "$(cat "$STATE_DIR/cooldown-$1" 2>/dev/null || echo 0)" ]; }
cool_down() {
  echo $(( $(date +%s) + COOLDOWN_MIN * 60 )) > "$STATE_DIR/cooldown-$1"
  log "!! $1 hit a usage/credit limit; it cools down for ${COOLDOWN_MIN}m"
}

# The engine a role should use right now, or nothing if none is available.
pick_engine() { # preferred-engine
  if [ "$MODE" != auto ]; then cooling "$MODE" || echo "$MODE"; return; fi
  if ! cooling "$1"; then echo "$1"; return; fi
  cooling "$(other_engine "$1")" || other_engine "$1"
}

model_for() { # engine role
  if [ "$1" = claude ]; then
    [ "$2" = reviewer ] && echo "$CLAUDE_MODEL_REVIEWER" || echo "$CLAUDE_MODEL_DEFAULT"
  else
    [ "$2" = reviewer ] && echo "$KIRO_MODEL_REVIEWER" || echo "$KIRO_MODEL_DEFAULT"
  fi
}

# Only a failed run's last lines count: agents print issue text, API responses and their own
# summaries, and this product has rate limits and 401s of its own, so matching a whole log misfires.
hit_limit() { # rc logfile
  [ "$1" -ne 0 ] && tail -n 30 "$2" | grep -qiE "usage limit|rate limit|quota|out of credits|insufficient credits|credit limit|not logged in|unauthori[sz]ed"
}

run_agent() { # role preferred-engine task
  local role=$1 pref=$2 task=$3 engine model out rc attempt
  # Checked here, not only per cycle: a long session must not be followed by another one
  # after the kill switch goes on.
  if paused; then log "skipping $role: paused"; return 99; fi
  for attempt in 1 2; do
    engine=$(pick_engine "$pref")
    if [ -z "$engine" ]; then log "skipping $role: no engine available (mode $MODE)"; return 99; fi
    model=$(model_for "$engine" "$role")
    out="$LOG_DIR/$(date -u +%H%M%S)-$role-$engine.log"
    log "→ $role ($engine, $model)"
    if [ "$engine" = claude ]; then
      timeout "$AGENT_TIMEOUT" claude -p "$task" --agent "snapurl-$role" --model "$model" \
        --dangerously-skip-permissions >"$out" 2>&1
    else
      timeout "$AGENT_TIMEOUT" kiro-cli chat --no-interactive --trust-all-tools \
        --agent "snapurl-$role" --model "$model" "$task" >"$out" 2>&1
    fi
    rc=$?
    log "← $role exit $rc ($out)"
    hit_limit "$rc" "$out" || return 0
    # A limited engine's run did no work, so retry it once on whichever engine is left.
    cool_down "$engine"
  done
  return 99
}

OPS_REPO="${OPS_REPO:-DhananjayThomble/snapurl-ops}"
export OPS_DIR="${OPS_DIR:-$HOME/snapurl-ops}"

ops_pull() {
  [ -d "$OPS_DIR/.git" ] || gh repo clone "$OPS_REPO" "$OPS_DIR" -- -q
  git -C "$OPS_DIR" pull -q --rebase origin main
}

ops_push() {
  [ -d "$OPS_DIR/.git" ] || return 0
  git -C "$OPS_DIR" add -A
  git -C "$OPS_DIR" diff --cached --quiet && return 0
  git -C "$OPS_DIR" commit -q -m "agents: memory and QA adjudication $(date -u +%FT%TZ)"
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
        gh pr comment "$n" -R "$REPO" --body "Autopilot: this PR conflicts with \`main\`. Merge \`main\` into the branch (do not rebase or force-push) and resolve the conflict." >/dev/null
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

# Extra role run every SLOT_EVERY cycles, as role[:focus]. QA, UX and security run in the QA lab
# workflow on GitHub Actions, not here; put them back only on a host that does QA.
read -r -a ROTATION <<<"${ROTATION:-cloud}"
SLOT_EVERY="${SLOT_EVERY:-3}"
END=$(( $(date +%s) + HOURS * 3600 ))
cycle=0
slot_n=0

while [ "$(date +%s)" -lt "$END" ]; do
  if paused; then log "paused (agents:paused label or $PAUSE_FILE)"; break; fi
  cycle=$((cycle + 1))
  MODE=$(engine_mode)
  log "=== cycle $cycle (engine mode: $MODE) ==="
  git fetch -q origin
  # Shared memory lives in the ops repo; pull before any agent reads it, push after they write.
  ops_pull || log "ops repo pull failed; agents will see stale memory and findings"

  # Each role runs regardless of how the one before it fared: a limit on one engine, or one
  # agent failing, must not stop the work the other engine can still do.
  run_agent manager "$ENGINE_MANAGER" "Run your triage pass on $REPO now."
  run_agent reviewer "$ENGINE_REVIEWER" "Do part A (review open PRs) and part B (adjudicate QA findings) now."
  ops_push
  merge_approved   # merges only what is already approved and green, so it is safe after a failed review

  for _ in $(seq 1 "$DEVS_PER_CYCLE"); do
    paused && break
    run_agent developer "$ENGINE_DEVELOPER" "Take the next piece of work and carry it to an open PR." || break
  done
  ops_push

  if [ "${#ROTATION[@]}" -gt 0 ] && [ $(( (cycle - 1) % SLOT_EVERY )) -eq 0 ]; then
    slot=${ROTATION[$(( slot_n % ${#ROTATION[@]} ))]}
    slot_n=$((slot_n + 1))
    role=${slot%%:*}; focus=${slot#*:}
    paused || run_agent "$role" "$ENGINE_QA" "Run one $role session now. Focus: $focus."
    ops_push
  fi

  log "cycle $cycle done; sleeping ${SLEEP_MIN}m"
  sleep $((SLEEP_MIN * 60))
done
log "autopilot stopped"

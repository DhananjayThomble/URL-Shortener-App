#!/usr/bin/env bash
# Autonomous SDLC loop. See docs/AGENTIC-DEV.md.
#
#   HOURS=6 bash scripts/agents/autopilot.sh
#
# Each cycle: kill-switch check → engine mode → dirty-checkout check → manager → reviewer →
# merge approved PRs → developer(s) → every SLOT_EVERY cycles, one ROTATION role (default: cloud)
# → sleep.
# Any role runs on Claude Code or Kiro CLI; see "Engines" below and docs/AGENTIC-DEV.md.
set -uo pipefail
# Without the guard a failed rev-parse would leave the loop running in whatever directory it
# started in, writing state and logs somewhere unexpected.
cd "$(git rev-parse --show-toplevel)" || { echo "not inside a git checkout" >&2; exit 1; }

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
# State that governs spend and cooldowns. Keep it off the working tree on a real host
# (STATE_DIR=/var/lib/snapurl): `git clean` in here would otherwise reset the budget.
STATE_DIR="${STATE_DIR:-.agent-state}"
# Models per engine. Two independent guarantees:
#   1. the reviewer never runs the model that wrote the code, and
#   2. on Kiro the reviewer runs a *different vendor's* model, so its blind spots are not
#      correlated with the developer's. Kiro's catalogue is multi-vendor; Claude Code is not,
#      so on Claude the best available separation is Opus-over-Sonnet.
CLAUDE_MODEL_REVIEWER="${CLAUDE_MODEL_REVIEWER:-opus}"
CLAUDE_MODEL_DEFAULT="${CLAUDE_MODEL_DEFAULT:-sonnet}"
KIRO_MODEL_REVIEWER="${KIRO_MODEL_REVIEWER:-gpt-5.6-terra}"
KIRO_MODEL_DEFAULT="${KIRO_MODEL_DEFAULT:-claude-sonnet-5}"
# Reasoning effort (Kiro only; valid: low|medium|high|xhigh|max). The reviewer is the component
# that lets an absent maintainer trust a merge, so it gets the ceiling; everything else runs one
# step below it. Both raise credit burn per run, which is what CREDIT_CEILING_DAY is there to bound.
KIRO_EFFORT_REVIEWER="${KIRO_EFFORT_REVIEWER:-max}"
KIRO_EFFORT_DEFAULT="${KIRO_EFFORT_DEFAULT:-xhigh}"

# How many trailing lines of a run's log may be used to classify why it failed. The whole log is
# never searched: agents print issue bodies, API responses and the product's own UI. A live run
# was aborted because SnapURL's click-quota bar says "One quota, clicks only" and a sad-path test
# captured a 401 body — on a run that had exited 0.
TAIL_LINES="${TAIL_LINES:-200}"
# Consecutive cycles in which every role failed for a non-quota reason (missing binary, bad model
# name, crash) before the factory pauses itself. A broken engine cannot do work, so grinding on is
# pure spend. Fail closed and wait for a human.
BROKEN_CYCLES_MAX="${BROKEN_CYCLES_MAX:-3}"
# Rolling credit ceiling for one factory day, summed from the engines' own reported usage. Counted
# per day rather than per shift so a crash-restart loop cannot reset the budget. 0 disables it.
CREDIT_CEILING_DAY="${CREDIT_CEILING_DAY:-2000}"
# The timezone the factory *talks* in. Timestamps the machine has to match against something else —
# run ids, log directories, GitHub, Actions cron — stay UTC, because those systems are UTC and no
# local clock can change that. Everything a human reads, and every boundary a human reasons about
# ("today's spend", "the daily summary"), uses this. Set DISPLAY_TZ=UTC to render in UTC.
DISPLAY_TZ="${DISPLAY_TZ:-Asia/Kolkata}"
# Local hour (0-23) at or after which the daily digest is posted. Deliberately not midnight: a
# summary that arrives at 05:30 was written for the machine's convenience, not the reader's.
DIGEST_HOUR="${DIGEST_HOUR:-9}"
# Prints a fresh GitHub App installation token on stdout, or fails. The real minter is root-owned
# (`agent` may run only this one command via sudo); overridable so tests never call the real thing.
MINT_TOKEN_CMD="${MINT_TOKEN_CMD:-sudo -n /opt/snapurl/bin/mint-gh-token}"

# AGENT_GH_TOKEN is an explicit override for local runs and CI (a PAT, or a token a human minted
# by hand); it wins for the life of the process and refresh_gh_token leaves it alone. Without it,
# GH_TOKEN starts unset and the first refresh_gh_token call (top of the main loop, before any
# role) mints the first real token — there is no long-lived PAT fallback baked in here.
[ -n "${AGENT_GH_TOKEN:-}" ] && export GH_TOKEN="$AGENT_GH_TOKEN"

# Tokens are valid 60 min; a role may run up to AGENT_TIMEOUT and the manager/reviewer run before
# the developer, so refreshing once per cycle can hand the developer an already-old token. Call
# this before every role launch and before merge_approved, not just once per cycle.
#
# Fallback is mandatory: if AGENT_GH_TOKEN is set, or the mint command is missing/fails/prints
# nothing, keep whatever GH_TOKEN already has and log one warning line — never a flood, and never
# the token itself. `set -x` traces every simple command including the assignment and the export,
# so both are wrapped in a `set +x`/restore pair — without it, a traced run (`bash -x
# autopilot.sh`, or a caller that already has `set -x` on) would write the live token to stderr,
# journald and any captured transcript. The restore only re-enables tracing if the caller actually
# had it on, and never trips `set -e` — `case` itself never returns non-zero, and the guarded
# `{ set +x/-x; } 2>/dev/null` form succeeds even where `-x` is unsupported.
refresh_gh_token() {
  if [ -n "${AGENT_GH_TOKEN:-}" ]; then return 0; fi
  local minted was_tracing=0
  case "$-" in
    *x*) was_tracing=1 ;;
  esac
  { set +x; } 2>/dev/null
  if ! minted=$($MINT_TOKEN_CMD 2>/dev/null) || [ -z "$minted" ]; then
    [ "$was_tracing" = 1 ] && { set -x; } 2>/dev/null
    log "token refresh failed, keeping current token"
    return 1
  fi
  export GH_TOKEN="$minted"
  [ "$was_tracing" = 1 ] && { set -x; } 2>/dev/null
}

LOG_DIR=".agent-logs/$(date -u +%Y%m%d)"
mkdir -p "$LOG_DIR" "$STATE_DIR"
# Timestamped in DISPLAY_TZ and always labelled with the zone. journald stamps its own prefix in
# whatever TZ the reader passes, so an unlabelled local time next to it produced two different
# clocks on one line; the label makes the line unambiguous whichever way the journal is read.
log() {
  echo "[$(TZ="$DISPLAY_TZ" date '+%H:%M:%S %Z')] $*" | tee -a "$LOG_DIR/autopilot.log" >&2
}

# The file-based kill switch is checked first and is unconditional: it needs no token and no
# network call, so it stops the loop even while GH_TOKEN is completely broken.
#
# The label check is different on purpose: a real GH_TOKEN expiry (60 min) makes `gh` fail with a
# 401, which prints nothing on stdout. The old code read that empty output as "length is not 0" and
# treated a token expiry as if a human had asked for a pause — that is the bug this function exists
# to fix (see #541). Per #541's explicit build requirement, refresh_gh_token is called
# unconditionally BEFORE the query — not only after an observed failure — because paused() is the
# thing wait_out_budget polls every iteration while idling on a spent budget, and that is exactly
# the path that hit the 60-minute expiry in production. refresh_gh_token is cheap when the token is
# still good: if AGENT_GH_TOKEN is set (tests, CI) it returns immediately without minting anything,
# and otherwise the mint command itself is what actually bounds the cost, not this call site
# skipping it.
#
# A query can still fail after that first refresh — the mint that just ran could itself have
# failed (refresh_gh_token logs and keeps the old, already-expired token rather than blocking), or
# the query could hit a transient 5xx/rate limit unrelated to the token. #541's acceptance
# criteria is explicit that a failed query must be retried after a refresh, not given up on after
# one attempt — otherwise a mint that fails on its first try during the exact minute the token
# expires reproduces the original bug. So on a failed query, refresh once more and retry the
# query exactly once. Only if the retried query ALSO fails is the failure logged and treated as
# NOT paused — a stuck-open `gh`/network problem must never masquerade as the human kill switch.
# The only thing that can actually pause the factory via label is a *successful* query that finds
# one.
paused() {
  [ -f "$PAUSE_FILE" ] && return 0
  local out attempt
  for attempt in 1 2; do
    refresh_gh_token
    if out=$(gh issue list -R "$REPO" --state open --label agents:paused --json number -q 'length' 2>/dev/null) \
        && [ -n "$out" ]; then
      [ "$out" != "0" ]
      return
    fi
  done
  log "agents:paused label query failed; not treating this as a pause"
  return 1
}


# The pinned checkout (this toplevel) is what the host's systemd unit `git checkout --detach
# origin/main`s on every restart. A tracked file left modified here — an agent editing it directly
# instead of in a worktree — makes that checkout fail and, under `set -e`, the whole factory exits
# before the autopilot even starts. Restart=always with a long RestartSec turns that into a silent
# multi-minute gap rather than a visible failure, so this is the only place that can catch it: the
# loop that is still running. Never deletes, stashes or resets anything — a dirty checkout is
# evidence an agent broke the worktree rule, and destroying that evidence is not this function's
# job. `alert` both logs the line and appends to alerts.log, which the digest already surfaces
# under "Recent alerts", so nothing else has to read this file's output.
check_checkout_clean() {
  local dirty
  dirty=$(git status --porcelain 2>/dev/null)
  [ -z "$dirty" ] && return 0
  alert "pinned checkout is dirty: $(printf '%s' "$dirty" | awk '{print $2}' | paste -sd ' ' -)"
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
  # `2>/dev/null` on a redirect does not suppress the shell's own "No such file" for it, and this
  # runs every cycle, so the absence of the file is checked rather than tolerated.
  if [ -r "$STATE_DIR/engine-mode" ]; then
    file=$(tr -d '[:space:]' < "$STATE_DIR/engine-mode")
    case "$file" in claude|kiro|auto) echo "$file"; return ;; esac
  fi
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

effort_for() { # engine role   (Kiro only; Claude Code has no effort flag)
  [ "$1" = claude ] && return 0
  [ "$2" = reviewer ] && echo "$KIRO_EFFORT_REVIEWER" || echo "$KIRO_EFFORT_DEFAULT"
}

# A model's vendor family, used to prove the reviewer is not the author's sibling.
model_family() { # model
  case "$1" in
    *opus*|*sonnet*|*haiku*|claude*) echo anthropic ;;
    gpt-*|o[0-9]*) echo openai ;;
    glm*) echo zai ;;
    deepseek*) echo deepseek ;;
    minimax*) echo minimax ;;
    qwen*) echo qwen ;;
    *) echo unknown ;;
  esac
}

# Warns rather than fails: a maintainer overriding the models deserves a heads-up, not a halt.
check_reviewer_independence() { # engine
  local r d
  r=$(model_family "$(model_for "$1" reviewer)")
  d=$(model_family "$(model_for "$1" developer)")
  [ "$r" != "$d" ] && return 0
  log "note: on $1 the reviewer and developer models are both $r; review errors may correlate"
}

strip_ansi() { sed 's/\x1b\[[0-9;?]*[A-Za-z]//g; s/\x1b[()][A-Za-z]//g'; }

# Quota exhaustion, as the engines themselves report it. Deliberately narrow: bare "quota" and
# bare "unauthorized" both occur in this product's own output and cost us a cycle already.
LIMIT_RE='usage limit|rate limit(ed)? (reached|exceeded)|quota (exceeded|reached|exhausted)|out of credits|insufficient credits|credit limit|too many requests|429 |resource_exhausted'
AUTH_RE='not logged in|login required|please (log|sign) in to (use|continue using)|invalid (api )?key|authentication failed|credentials (are )?(invalid|expired)'

limit_text() { # logfile
  tail -n "$TAIL_LINES" "$1" 2>/dev/null | strip_ansi | grep -qiE "$LIMIT_RE|$AUTH_RE"
}

# ok | limited | timeout | broken.
#   ok      the run finished. Even if its text mentions a quota, it did the work.
#   limited the engine refused for quota/auth reasons: retry elsewhere, cool this engine down.
#   timeout it used the whole AGENT_TIMEOUT: never retried, because a retry costs as much again.
#   broken  a missing binary, a rejected --model, a crash: no engine cooldown, but escalate.
classify_run() { # rc logfile
  case "$1" in
    0)   echo ok ;;
    124) echo timeout ;;
    *)   limit_text "$2" && echo limited || echo broken ;;
  esac
}

# Kiro ends a run with "▸ Credits: 13.11 • Time: 15m 57s"; Claude Code reports no usage, so its
# spend is invisible here and the ceiling only governs Kiro. Prints nothing when absent.
#
# Anchored on the whole footer, not on "credits: N" alone. Agents print arbitrary text — including
# this repo's own documentation about credits — and a number lifted from an agent's prose would
# corrupt the ceiling in whichever direction the text happened to say.
run_credits() { # logfile
  tail -n 20 "$1" 2>/dev/null | strip_ansi \
    | grep -oiE 'Credits:[[:space:]]*[0-9]+(\.[0-9]+)?[[:space:]]*•[[:space:]]*Time:' | tail -n 1 \
    | grep -oE '[0-9]+(\.[0-9]+)?'
}

# The factory's own day, in the timezone it reports in. A budget is a human concept: "spend today"
# has to mean the reader's today, or the number in the digest never matches the day they are having.
factory_day() { TZ="$DISPLAY_TZ" date +%Y%m%d; }

credit_file() { echo "$STATE_DIR/credits-$(factory_day)"; }

add_credits() { # amount
  local f total
  [ -n "${1:-}" ] || return 0
  f=$(credit_file)
  total=$(awk -v a="$(cat "$f" 2>/dev/null || echo 0)" -v b="$1" 'BEGIN{printf "%.2f", a+b}')
  echo "$total" > "$f"
  log "spend today: $total credits"
}

# Hard stop, not advice: an unattended overspend is the failure a solo maintainer cannot catch.
over_budget() {
  [ "$CREDIT_CEILING_DAY" = 0 ] && return 1
  awk -v t="$(cat "$(credit_file)" 2>/dev/null || echo 0)" -v c="$CREDIT_CEILING_DAY" \
    'BEGIN{exit !(t>=c)}'
}

# Everything an absent maintainer must be told, in one place the digest can read.
alert() { # subject
  log "!! $*"
  printf '%s\t%s\n' "$(date -u +%FT%TZ)" "$*" >> "$STATE_DIR/alerts.log"
}

# Stops the loop the same way the human kill switch does, so recovery is one documented action.
# Reserved for conditions a human must actually look at; a spent budget is not one of them.
pause_factory() { # reason
  alert "pausing the factory: $1"
  : > "$PAUSE_FILE"
}

# A day budget is a budget, not a kill switch. Setting $PAUSE_FILE here would be wrong: the budget
# resets when the factory day rolls over but the kill switch does not, so a factory that spent its
# allowance on Tuesday would still be stopped on Friday, waiting for a human who is away. Idle
# instead, and resume by itself. Re-checked every 5 minutes so raising the ceiling also resumes it.
wait_out_budget() {
  local nap remaining
  alert "day budget of $CREDIT_CEILING_DAY credits reached ($(cat "$(credit_file)" 2>/dev/null) spent); idling until midnight $(TZ="$DISPLAY_TZ" date +%Z)"
  while over_budget; do
    remaining=$(( END - $(date +%s) ))
    [ "$remaining" -gt 0 ] || { log "shift ended while over budget"; return 1; }
    paused && { log "paused while over budget"; return 1; }
    nap=$(( $(TZ="$DISPLAY_TZ" date -d 'tomorrow 00:00' +%s 2>/dev/null || echo 0) - $(date +%s) ))
    { [ "$nap" -gt 300 ] || [ "$nap" -le 0 ]; } && nap=300
    # Never sleep past the shift's own end: a nap that overshoots END means the loop only notices
    # the shift ended on the iteration *after* the one that should have caught it — up to 300s
    # late, and the reason the #542 test raced against its own 2-second budget instead of
    # observing the check that was supposed to end it.
    [ "$nap" -gt "$remaining" ] && nap="$remaining"
    sleep "$nap"
  done
  log "budget window rolled over; resuming"
}

# Counted by run_agent, read by the circuit breaker. Declared here so the functions are safe to
# source and test on their own.
CYCLE_WORKED=0
CYCLE_BROKEN=0

# --- Daily digest -------------------------------------------------------------------------------
# The maintainer is a solo engineer with a day job: the factory must be readable in a couple of
# minutes without opening a laptop. One comment a day on one issue gives a phone notification and
# a permanent record, which editing a body in place would not.
DIGEST_LABEL="${DIGEST_LABEL:-factory:digest}"
# Everything above computes in UTC and always will: the host is UTC, GitHub's API returns UTC, and
# Actions cron is UTC-only, so a local clock anywhere in the machinery would make correlating a
# factory log line with a CI run an exercise in arithmetic. This is the one place a human reads, so
# it is the one place that renders local time. Set DISPLAY_TZ=UTC to turn it off.
DISPLAY_TZ="${DISPLAY_TZ:-Asia/Kolkata}"

# "2026-09-18 18:56 IST (13:26Z)" — local first because that is the one being read, UTC in
# parentheses so it can still be matched against a log line or a GitHub timestamp.
local_stamp() {
  local l z
  l=$(TZ="$DISPLAY_TZ" date "+%F %H:%M %Z" 2>/dev/null)
  z=$(date -u +%H:%MZ)
  if [ -n "$l" ] && [ "$DISPLAY_TZ" != UTC ]; then echo "$l ($z)"; else date -u "+%F %H:%MZ"; fi
}

digest_issue() {
  local n
  n=$(gh issue list -R "$REPO" --state open --label "$DIGEST_LABEL" --limit 1 \
    --json number -q '.[0].number' 2>/dev/null)
  if [ -z "$n" ] || [ "$n" = null ]; then
    gh label create "$DIGEST_LABEL" -R "$REPO" -c ededed \
      -d "Daily autopilot digest for the maintainer" >/dev/null 2>&1
    n=$(gh issue create -R "$REPO" --title "Factory digest" --label "$DIGEST_LABEL" \
      --body "The autopilot comments here once a day: what merged, what is stuck, what needs your decision, and what it cost. Close this issue to stop the digest." \
      2>/dev/null | grep -oE '[0-9]+$')
  fi
  [ -n "$n" ] && echo "$n"
}

digest_now() { # reason
  local n body since spent alerts merged open waiting blocked
  n=$(digest_issue) || return 0
  [ -n "$n" ] || { log "digest: no issue to post to"; return 0; }
  since=$(date -u -d '24 hours ago' +%F 2>/dev/null || echo "")
  spent=$(cat "$(credit_file)" 2>/dev/null || echo 0)
  alerts=$(tail -n 20 "$STATE_DIR/alerts.log" 2>/dev/null | sed 's/^/- /')

  # Each section is built in its own variable with a single-quoted jq filter. Inlining these in the
  # body string meant the filters sat inside a double-quoted "$( )" and had to be backslash-escaped;
  # the backslashes reached jq literally, it refused the program, and because the call was
  # `|| true` the section rendered blank instead of failing. Never nest a jq filter in a quoted body.
  merged=$(gh pr list -R "$REPO" --state merged --search "merged:>=$since" --limit 20 \
    --json number,title -q '.[] | "- #\(.number) \(.title)"' 2>/dev/null)
  # `join` on an empty array is "", and jq's // only substitutes null/false, so an unlabelled PR
  # needs an explicit emptiness test rather than `// "no labels"`.
  open=$(gh pr list -R "$REPO" --state open --limit 20 \
    --json number,title,mergeStateStatus,labels \
    -q '.[] | ([.labels[].name] | join(", ")) as $l
        | "- #\(.number) [\(.mergeStateStatus)] \(.title) — \(if $l == "" then "no labels" else $l end)"' \
    2>/dev/null)
  waiting=$(gh issue list -R "$REPO" --state open --label decision --limit 10 \
    --json number,title -q '.[] | "- #\(.number) \(.title)"' 2>/dev/null)
  blocked=$(gh issue list -R "$REPO" --state open --label agent:blocked --limit 10 \
    --json number,title -q '.[] | "- #\(.number) (blocked) \(.title)"' 2>/dev/null)

  body="## Factory digest — $(local_stamp)
_Trigger: $1._

**Spend today:** $spent / ${CREDIT_CEILING_DAY} credits (Kiro-reported; Claude Code usage is not counted).
Budget day is midnight-to-midnight $(TZ="$DISPLAY_TZ" date +%Z) and resets by itself.
**Kill switch:** $([ -f "$PAUSE_FILE" ] && echo '**PAUSED** — clear it with `factory-pause off`' || echo 'running')

### Merged in the last 24h
${merged:-_none_}

### Open PRs
${open:-_none_}

### Waiting on you
${waiting:-_no decisions pending_}
${blocked:-}

### Recent alerts
${alerts:-_none_}"

  if gh issue comment "$n" -R "$REPO" --body "$body" >/dev/null 2>&1; then
    log "digest posted to #$n"
  else
    log "digest post failed; kept in $STATE_DIR/alerts.log"
  fi
}

# Once per factory day, and not before DIGEST_HOUR local. Firing on the first cycle after the day
# rolls over would deliver the summary at 05:30 IST — written for the machine's convenience. This
# waits until the reader's morning, then posts on the first cycle at or after it.
digest_daily() {
  local stamp hour
  hour=$(TZ="$DISPLAY_TZ" date +%-H 2>/dev/null || echo 0)
  [ "$hour" -ge "$DIGEST_HOUR" ] || return 0
  stamp="$STATE_DIR/digest-$(factory_day)"
  [ -f "$stamp" ] && return 0
  : > "$stamp"
  digest_now "daily"
}

run_agent() { # role preferred-engine task
  local role=$1 pref=$2 task=$3 engine model effort out rc attempt class credits
  for attempt in 1 2; do
    # Re-checked every attempt: a retry must not start a fresh 90-minute session after the
    # kill switch has gone on.
    if paused; then log "skipping $role: paused"; return 99; fi
    # Checked per run rather than only per cycle, so an overshoot past the ceiling is bounded by
    # one agent session instead of a whole cycle's worth of them.
    if over_budget; then
      log "skipping $role: day budget of $CREDIT_CEILING_DAY credits reached"
      return 99
    fi
    engine=$(pick_engine "$pref")
    if [ -z "$engine" ]; then log "skipping $role: no engine available (mode $MODE)"; return 99; fi
    model=$(model_for "$engine" "$role")
    effort=$(effort_for "$engine" "$role")
    out="$LOG_DIR/$(date -u +%H%M%S)-$role-$engine.log"
    [ "$attempt" -gt 1 ] && log "retry $attempt for $role"
    # Right before launch, not once per cycle: a token is valid 60m, a role may run up to
    # AGENT_TIMEOUT, and the manager/reviewer run before the developer.
    refresh_gh_token
    log "→ $role ($engine, $model${effort:+, effort $effort})"
    if [ "$engine" = claude ]; then
      timeout "$AGENT_TIMEOUT" claude -p "$task" --agent "snapurl-$role" --model "$model" \
        --dangerously-skip-permissions >"$out" 2>&1
    else
      timeout "$AGENT_TIMEOUT" kiro-cli chat --no-interactive --trust-all-tools \
        --agent "snapurl-$role" --model "$model" ${effort:+--effort "$effort"} "$task" >"$out" 2>&1
    fi
    rc=$?
    class=$(classify_run "$rc" "$out")
    log "← $role exit $rc ($class) ($out)"
    credits=$(run_credits "$out"); add_credits "$credits"

    case "$class" in
      ok)
        # The old check searched whole logs and aborted on text like this; say so and carry on.
        limit_text "$out" && log "note: $role exited 0 but its tail mentions a limit; treating as success"
        CYCLE_WORKED=$((CYCLE_WORKED + 1))
        return 0
        ;;
      timeout)
        alert "$role hit the ${AGENT_TIMEOUT} timeout on $engine; not retried (see $out)"
        return 1
        ;;
      limited)
        cool_down "$engine"   # retry on whichever engine is left
        ;;
      broken)
        CYCLE_BROKEN=$((CYCLE_BROKEN + 1))
        alert "$role failed on $engine for a non-quota reason (exit $rc); see $out"
        ;;
    esac
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
      UNKNOWN)
        # GitHub has not finished recomputing mergeability yet — guaranteed right after any merge
        # in this same pass moved main. Not "mergeable", just not yet known: try again next cycle
        # rather than attempting a merge GitHub cannot yet confirm.
        log "PR #$n: mergeability not computed yet (state UNKNOWN); retrying next cycle"
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

# The token is refreshed immediately before merge_approved rather than only once per cycle,
# because manager/reviewer already ran and a token is valid only 60 minutes (see refresh_gh_token).
# A named function, rather than the two calls inlined in the main loop, so a test can invoke this
# exact pairing directly and catch either call disappearing on its own.
refresh_and_merge() {
  refresh_gh_token
  merge_approved
}

# Extra role run every SLOT_EVERY cycles, as role[:focus]. QA, UX and security run in the QA lab
# workflow on GitHub Actions, not here; put them back only on a host that does QA.
read -r -a ROTATION <<<"${ROTATION:-cloud}"
SLOT_EVERY="${SLOT_EVERY:-3}"

# One pass of the main loop's body, extracted so autopilot.test.sh can call the *actual*
# scheduling path — including check_checkout_clean's call site and the top-of-cycle
# refresh_gh_token, right before `git fetch` — instead of re-implementing it or testing the
# helpers in isolation. A call site dropped from here is a call site dropped from the real loop
# below, which is the whole point: the test suite failed to catch exactly that class of
# regression when this was inline. Everything the loop needs across cycles
# (cycle/slot_n/broken_streak) is a global set before the first call, same as before this was
# extracted; a test sets its own copies before calling run_cycle directly.
#
# Returns 1 to tell the caller to stop the shift (paused, budget exhausted-and-unrecoverable, or
# the broken-cycle circuit breaker tripped); 0 to keep going.
run_cycle() {
  if paused; then log "paused (agents:paused label or $PAUSE_FILE)"; return 1; fi
  if over_budget; then wait_out_budget || return 1; fi
  cycle=$((cycle + 1))
  MODE=$(engine_mode)
  log "=== cycle $cycle (engine mode: $MODE) ==="
  # Counted per cycle so the circuit breaker can tell "quota exhausted, will self-heal" from
  # "something is broken and no amount of waiting fixes it".
  CYCLE_WORKED=0
  CYCLE_BROKEN=0
  # No standalone refresh_gh_token here: paused() (the line above) now refreshes unconditionally
  # itself (#541), so by the time this point is reached the token is already as fresh as a second
  # call here could make it — a second mint back to back would just be wasted cost.
  git fetch -q origin
  # Catches the state that makes the *next* restart fail before it does: see check_checkout_clean.
  check_checkout_clean
  # Shared memory lives in the ops repo; pull before any agent reads it, push after they write.
  ops_pull || log "ops repo pull failed; agents will see stale memory and findings"

  # Each role runs regardless of how the one before it fared: a limit on one engine, or one
  # agent failing, must not stop the work the other engine can still do.
  run_agent manager "$ENGINE_MANAGER" "Run your triage pass on $REPO now."
  run_agent reviewer "$ENGINE_REVIEWER" "Do part A (review open PRs) and part B (adjudicate QA findings) now."
  ops_push
  refresh_and_merge   # merges only what is already approved and green, so it is safe after a failed review

  for _ in $(seq 1 "$DEVS_PER_CYCLE"); do
    paused && break
    run_agent developer "$ENGINE_DEVELOPER" "Take the next piece of work and carry it to an open PR." || break
  done
  # The developer role may have run for the full AGENT_TIMEOUT; refresh before the ops-repo push
  # that follows it rather than handing that push whatever token the last run_agent call minted.
  refresh_gh_token
  ops_push

  if [ "${#ROTATION[@]}" -gt 0 ] && [ $(( (cycle - 1) % SLOT_EVERY )) -eq 0 ]; then
    slot=${ROTATION[$(( slot_n % ${#ROTATION[@]} ))]}
    slot_n=$((slot_n + 1))
    role=${slot%%:*}; focus=${slot#*:}
    paused || run_agent "$role" "$ENGINE_QA" "Run one $role session now. Focus: $focus."
    # Same reasoning as above: the rotation role can also run the full timeout.
    refresh_gh_token
    ops_push
  fi

  # A quota-limited cycle is not a broken one: its cooldown expires on its own. A cycle where
  # something failed for another reason and nothing at all succeeded is the one worth stopping for.
  if [ "$CYCLE_BROKEN" -gt 0 ] && [ "$CYCLE_WORKED" -eq 0 ]; then
    broken_streak=$((broken_streak + 1))
    log "no role succeeded this cycle ($broken_streak in a row, limit $BROKEN_CYCLES_MAX)"
    if [ "$broken_streak" -ge "$BROKEN_CYCLES_MAX" ]; then
      pause_factory "$broken_streak cycles with no successful run; the engines look broken, not throttled"
      return 1
    fi
  else
    broken_streak=0
  fi

  digest_daily
  return 0
}

# Sourced by scripts/agents/autopilot.test.sh, which exercises the functions above (including
# run_cycle itself) against stub engines. Everything below this line is the loop's own driver —
# the real timer and sleep — and must not run during a test.
[ -n "${AUTOPILOT_LIB_ONLY:-}" ] && return 0

# Everything the shift actually runs, in one function. Bash parses a function's whole body —
# up to its closing brace — before it executes any of it, and once `main` is running, the parsed
# body already sits in memory: bytes changed on disk afterwards (an agent editing this file in
# place, a `git pull` or `git checkout` over it, a fresh `origin/main` landing under a running
# process) cannot reach code already read into a compound command. Top-level code left outside a
# function has no such protection — bash re-reads the file incrementally as it goes, so a write
# to the file *while the loop is running* corrupts whatever the interpreter reads next. That is
# exactly what happened in #545: an in-place edit followed by `git checkout --` left the open file
# descriptor pointing at bytes bash had not parsed yet, and six hours later it read a syntax error
# instead of the next loop iteration and the process exited 2. Putting the loop inside `main` does
# not fix the file being edited — it makes the running process immune to it once `main` has begun.
main() {
  END=$(( $(date +%s) + HOURS * 3600 ))
  cycle=0
  slot_n=0
  broken_streak=0

  log "shift start: ${HOURS}h, engines ${ENGINE_MODE}, day budget ${CREDIT_CEILING_DAY} credits, spent $(cat "$(credit_file)" 2>/dev/null || echo 0)"
  check_reviewer_independence claude
  check_reviewer_independence kiro

  while [ "$(date +%s)" -lt "$END" ]; do
    run_cycle || break
    log "cycle $cycle done; sleeping ${SLEEP_MIN}m"
    sleep $((SLEEP_MIN * 60))
  done
  digest_now "shift ended"
  log "autopilot stopped"
}

main "$@"; exit $?

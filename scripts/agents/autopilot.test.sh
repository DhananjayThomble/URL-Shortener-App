#!/usr/bin/env bash
# Tests for scripts/agents/autopilot.sh.
#
#   bash scripts/agents/autopilot.test.sh
#
# The autopilot decides when to spend money, when to trust a run and when to stop the factory.
# Those decisions are only observable in production once, and the maintainer is usually away, so
# they are pinned here instead. No network, no agent CLIs, no GitHub: `claude`, `kiro-cli` and `gh`
# are stubs on PATH whose exit code and output each case chooses. Needs only bash, coreutils and awk.
# Most variables here are globals consumed by functions in the sourced autopilot; shellcheck
# cannot see across `source`, so its unused-variable warning is wrong for this file. The same
# blindness makes it think run_cycle (defined in the sourced autopilot.sh) is used before
# definition.
# shellcheck disable=SC2034,SC2218
set -uo pipefail

SRC=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/autopilot.sh
[ -f "$SRC" ] || { echo "cannot find autopilot.sh next to this test" >&2; exit 1; }

pass=0; fail=0
ok()   { pass=$((pass + 1)); printf '  ok   %s\n' "$1"; }
bad()  { fail=$((fail + 1)); printf '  FAIL %s\n'   "$1"; [ -n "${2:-}" ] && printf '         %s\n' "$2"; }
is()   { # got want label
  if [ "$1" = "$2" ]; then ok "$3"; else bad "$3" "got '$1', want '$2'"; fi
}
contains() { # haystack needle label
  case "$1" in *"$2"*) ok "$3" ;; *) bad "$3" "'$2' not found in: $(printf '%s' "$1" | tr '\n' '|')" ;; esac
}
lacks() { # haystack needle label
  case "$1" in *"$2"*) bad "$3" "'$2' should not appear" ;; *) ok "$3" ;; esac
}

# ---------------------------------------------------------------------------------------------
# A throwaway git repo per case: autopilot.sh cds to the toplevel and writes state under it.
# ---------------------------------------------------------------------------------------------
BIN=$(mktemp -d); WORKROOT=$(mktemp -d)
trap 'rm -rf "$BIN" "$WORKROOT"' EXIT
PATH="$BIN:$PATH"

# Stubs. Each reads its scripted behaviour from files under $BIN so a case can change it without
# rewriting the stub: <engine>.rc is the exit code, <engine>.out the stdout, <engine>.calls the log.
# Stubs. Each reads its scripted behaviour from files under $BIN so a case can change it without
# rewriting the stub: <engine>.rc is the exit code, <engine>.out the stdout, <engine>.calls the log.
# Regenerated between cases, because several cases replace a stub outright.
make_stubs() {
  local engine
  for engine in claude kiro-cli; do
    cat >"$BIN/$engine" <<STUB
#!/usr/bin/env bash
printf '%s\n' "\$*" >> "$BIN/$engine.calls"
# Records the GH_TOKEN this launch actually saw, so a test can tell a fresh refresh_gh_token
# call site apart from one that only updates the variable without it reaching the launch.
printf '%s\n' "\${GH_TOKEN:-}" >> "$BIN/$engine.gh_token_seen"
cat "$BIN/$engine.out" 2>/dev/null
exit \$(cat "$BIN/$engine.rc" 2>/dev/null || echo 0)
STUB
    chmod +x "$BIN/$engine"
  done

  # gh is only asked things the tests care about; anything else is a silent success so that helper
  # calls (labels, comments) cannot fail a case for the wrong reason.
  #
  # `pr list`/`issue list` pipe a fixture through the REAL jq using the filter the script passed in
  # `-q`. A stub that ignored `-q` is why an unrunnable jq filter shipped in the digest: the suite
  # was green because it never compiled the filter. If a filter is malformed, jq now fails here.
  cat >"$BIN/gh" <<STUB
#!/usr/bin/env bash
printf '%s\n' "\$*" >> "$BIN/gh.calls"
# Records the GH_TOKEN a merge attempt actually saw, so a test can tell a fresh
# refresh_gh_token call site apart from one that only updates the variable without it
# reaching the gh invocation that pushes the merge.
case "\$*" in *"pr merge "*) printf '%s\n' "\${GH_TOKEN:-}" >> "$BIN/gh.merge_gh_token_seen" ;; esac
# Records the GH_TOKEN an ops-repo clone actually saw. ops_pull calls this before any run_agent
# launch in a cycle, so it is the one call site whose token comes ONLY from the top-of-cycle
# refresh_gh_token — run_agent's own per-launch refresh happens later and cannot backfill it.
case "\$*" in *"repo clone "*) printf '%s\n' "\${GH_TOKEN:-}" >> "$BIN/gh.clone_gh_token_seen" ;; esac

# Pull the -q filter and the --body out of the argument list. The body is written to its own file
# because it is multi-line: grepping it back out of the flat call log is not possible, and reading
# assertions off the call log would match the jq filters' own source text and never fail.
filter=''
prev=''
for a in "\$@"; do
  [ "\$prev" = "-q" ] && filter="\$a"
  [ "\$prev" = "--body" ] && printf '%s' "\$a" > "$BIN/gh.lastbody"
  prev="\$a"
done

fixture=''
case "\$*" in
  *"pr list"*"--label agent:approved"*) fixture="$BIN/fixture-pr-approved.json" ;;
  *"pr list"*"--state open"*)   fixture="$BIN/fixture-pr-open.json" ;;
  *"pr list"*"--state merged"*) fixture="$BIN/fixture-pr-merged.json" ;;
  *"issue list"*"label decision"*)     fixture="$BIN/fixture-issue-decision.json" ;;
  *"issue list"*"label agent:blocked"*) fixture="$BIN/fixture-issue-blocked.json" ;;
esac

case "\$*" in
  *"--label agents:paused"*)
    # gh.paused.rc lets a case simulate the query itself failing (a 401 from an expired token,
    # a 5xx, a rate limit) unconditionally, rather than only choosing what a *successful* call
    # prints. Real gh prints nothing on stdout when it fails, so this stub does the same.
    #
    # gh.paused.fail_until_token, if present, makes the failure conditional instead: the call
    # fails unless GH_TOKEN already equals the token named in that file, so a case can prove
    # paused() calling refresh_gh_token itself is what turns a 401 into a working query, rather
    # than some refresh elsewhere in the test process.
    if [ -f "$BIN/gh.paused.fail_until_token" ]; then
      if [ "\${GH_TOKEN:-}" = "\$(cat "$BIN/gh.paused.fail_until_token")" ]; then
        cat "$BIN/gh.paused" 2>/dev/null || echo 0; exit 0
      fi
      exit 1
    fi
    rc=\$(cat "$BIN/gh.paused.rc" 2>/dev/null || echo 0)
    if [ "\$rc" != 0 ]; then exit "\$rc"; fi
    cat "$BIN/gh.paused" 2>/dev/null || echo 0; exit 0 ;;
  *"label:engine:claude,engine:kiro"*) cat "$BIN/gh.enginelabels" 2>/dev/null || echo ""; exit 0 ;;
  # Matches the literal default of DIGEST_LABEL (factory:digest — see autopilot.sh), not the
  # variable itself: make_stubs runs from reset_stubs, before `load` sources autopilot.sh, so
  # $DIGEST_LABEL is not yet set in this shell (same reason $REPO's default is hardcoded as
  # owner/repo above rather than referenced). No case in this file overrides DIGEST_LABEL.
  *"issue list"*"factory:digest"*) cat "$BIN/gh.digestissue" 2>/dev/null; exit 0 ;;
  *"issue create"*) echo "https://github.com/owner/repo/issues/77"; exit 0 ;;
esac

# pr view <n> ... : one fixture file per PR number, $BIN/fixture-pr-view-<n>.json, written by the
# case. merge_approved reads this with -q '.' (whole object), not a sub-filter, so it is served
# directly rather than through the generic fixture+filter path below.
case "\$*" in
  *"pr view "[0-9]*)
    n=''
    for a in "\$@"; do case "\$a" in [0-9]*) n="\$a"; break ;; esac; done
    if [ -f "$BIN/fixture-pr-view-\$n.json" ]; then
      cat "$BIN/fixture-pr-view-\$n.json"
    else
      echo '{}'
    fi
    exit 0
    ;;
  *"pr merge "*|*"pr update-branch "*)
    n=''
    for a in "\$@"; do case "\$a" in [0-9]*) n="\$a"; break ;; esac; done
    rc=\$(cat "$BIN/gh.prmerge-\$n.rc" 2>/dev/null || echo 0)
    exit "\$rc"
    ;;
esac

if [ -n "\$fixture" ] && [ -f "\$fixture" ] && [ -n "\$filter" ]; then
  jq -r "\$filter" < "\$fixture" || { echo "STUB_JQ_FAILED" >> "$BIN/gh.jqfail"; exit 1; }
  exit 0
fi
echo ""
exit 0
STUB
  chmod +x "$BIN/gh"
}

reset_stubs() {
  rm -f "$BIN"/*.calls "$BIN"/*.rc "$BIN"/*.out "$BIN"/gh.paused "$BIN"/gh.enginelabels \
        "$BIN"/gh.digestissue "$BIN"/gh.jqfail "$BIN"/gh.lastbody "$BIN"/fixture-*.json \
        "$BIN"/gh.prmerge-*.rc "$BIN"/*.gh_token_seen "$BIN"/gh.merge_gh_token_seen \
        "$BIN"/gh.clone_gh_token_seen "$BIN"/gh.paused.fail_until_token
  make_stubs
  echo 0 > "$BIN/gh.paused"
  # One labelled PR and one with no labels at all: the unlabelled case is what exposed jq's `//`
  # not firing on an empty string.
  cat > "$BIN/fixture-pr-open.json" <<'JSON'
[{"number":476,"title":"harden the autopilot","mergeStateStatus":"BEHIND","labels":[]},
 {"number":468,"title":"form labels","mergeStateStatus":"CLEAN","labels":[{"name":"agent:pr-open"}]}]
JSON
  cat > "$BIN/fixture-pr-merged.json" <<'JSON'
[{"number":467,"title":"wire the 2FA hooks"}]
JSON
  cat > "$BIN/fixture-issue-decision.json" <<'JSON'
[{"number":423,"title":"routing chain evaluation order"}]
JSON
  cat > "$BIN/fixture-issue-blocked.json" <<'JSON'
[]
JSON
}

# Loads the functions without running the loop, in a fresh repo.
load() { # [env assignments...]
  local dir; dir=$(mktemp -d "$WORKROOT/case.XXXXXX")
  git -C "$dir" init -q 2>/dev/null
  cd "$dir" || exit 1
  # The real pinned checkout ignores its own runtime droppings (.agent-logs/, .agent-state/,
  # .agents-paused — see .gitignore); without this, log()'s own mkdir would make check_checkout_clean
  # see "dirty" on every cycle just from autopilot having run, which is not what check_checkout_clean
  # exists to catch.
  cat > .gitignore <<'GITIGNORE'
.agent-logs/
.agents-paused
.agent-state/
GITIGNORE
  git add .gitignore >/dev/null 2>&1
  git commit -q -m "seed .gitignore" >/dev/null 2>&1
  export AUTOPILOT_LIB_ONLY=1 REPO=owner/repo STATE_DIR="$dir/.state" \
         PAUSE_FILE="$dir/.paused" OPS_DIR="$dir/nonexistent-ops"
  # shellcheck disable=SC1090
  source "$SRC"
  MODE=auto
}

section() { printf '\n%s\n' "$1"; }

# ---------------------------------------------------------------------------------------------
section "classify_run: what a finished run actually means"
# ---------------------------------------------------------------------------------------------
reset_stubs; load

printf 'all good\nreport written\n' > run.log
is "$(classify_run 0 run.log)" ok "exit 0 with a clean log is ok"

# The regression that cost a real cycle: the product's own click-quota bar and a sad-path 401 body
# appeared in a successful UX run's log, and the old whole-log grep aborted the cycle.
{
  echo 'Clicks this month 82.6k / 1.0M  One quota, clicks only. Links, QR codes and edits are never metered.'
  echo '{"message":"Sign in to continue.","error":"Unauthorized","statusCode":401}'
  echo 'summary.md has per-route scores and the prioritised top-10.'
  echo ' ▸ Credits: 13.11 • Time: 15m 57s'
} > ux.log
is "$(classify_run 0 ux.log)" ok "a successful run is ok even when its text says 'quota' and 'Unauthorized'"

printf 'Claude usage limit reached. Your limit will reset at 3pm.\n' > limited.log
is "$(classify_run 1 limited.log)" limited "a failed run reporting a usage limit is limited"

printf 'You are out of credits for this month.\n' > credits.log
is "$(classify_run 1 credits.log)" limited "out of credits is limited"

printf 'TypeError: cannot read property of undefined\n' > crash.log
is "$(classify_run 1 crash.log)" broken "a failed run with no quota message is broken"

printf 'kiro-cli: command not found\n' > missing.log
is "$(classify_run 127 missing.log)" broken "exit 127 (missing binary) is broken, not a limit"

printf 'Model "nope" is not available\n' > badmodel.log
is "$(classify_run 1 badmodel.log)" broken "a rejected model is broken"

printf 'working\n' > slow.log
is "$(classify_run 124 slow.log)" timeout "exit 124 is a timeout of its own class"

# A limit message far above the tail is scrollback from the agent's own reading, not this run's fate.
{ echo 'usage limit reached'; for i in $(seq 1 400); do echo "line $i"; done; } > old.log
is "$(classify_run 1 old.log)" broken "a limit message older than TAIL_LINES does not count"

# ---------------------------------------------------------------------------------------------
section "run_credits: reading the engine's own spend meter"
# ---------------------------------------------------------------------------------------------
printf 'done\n\033[38;5;8m\n ▸ Credits: 13.11 • Time: 15m 57s\n\n\033[0m\n' > spend.log
is "$(run_credits spend.log)" 13.11 "parses the ANSI-wrapped Kiro credits footer"
printf 'no meter here\n' > nospend.log
is "$(run_credits nospend.log)" "" "prints nothing when the engine reports no usage"
printf 'A typical reviewer shift reports Credits: 900 across the cycle, well under the ceiling.\n ▸ (no footer in this run)\n' > prose.log
is "$(run_credits prose.log)" "" "credit-shaped prose without the real footer is not read as spend"

# ---------------------------------------------------------------------------------------------
section "refresh_gh_token: keeping GH_TOKEN alive across a 60-minute expiry"
# ---------------------------------------------------------------------------------------------
# A PATH stub for the mint command, never the real one: MINT_TOKEN_CMD is overridden per case.
mint_ok() {
  cat >"$BIN/mint-ok" <<STUB
#!/usr/bin/env bash
printf '%s\n' "\$*" >> "$BIN/mint-ok.calls"
echo "$1"
STUB
  chmod +x "$BIN/mint-ok"
}
mint_fail() {
  cat >"$BIN/mint-fail" <<'STUB'
#!/usr/bin/env bash
exit 1
STUB
  chmod +x "$BIN/mint-fail"
}
mint_empty() {
  cat >"$BIN/mint-empty" <<'STUB'
#!/usr/bin/env bash
echo -n ""
STUB
  chmod +x "$BIN/mint-empty"
}

reset_stubs; load
unset AGENT_GH_TOKEN GH_TOKEN
mint_fail
MINT_TOKEN_CMD="$BIN/mint-fail"
out=$(refresh_gh_token 2>&1); rc=$?
is "$rc" 1 "a failing mint command reports failure"
contains "$out" "token refresh failed, keeping current token" "a failed mint logs exactly one warning line"
is "$(echo "$out" | grep -c 'token refresh failed')" 1 "the warning is not a flood"

reset_stubs; load
unset AGENT_GH_TOKEN
GH_TOKEN=stale-token-value
mint_fail
MINT_TOKEN_CMD="$BIN/mint-fail"
refresh_gh_token >/dev/null 2>&1
is "$GH_TOKEN" stale-token-value "on failure the current token is kept, not cleared"

reset_stubs; load
unset AGENT_GH_TOKEN
GH_TOKEN=stale-token-value
mint_empty
MINT_TOKEN_CMD="$BIN/mint-empty"
refresh_gh_token >/dev/null 2>&1
is "$GH_TOKEN" stale-token-value "an empty mint result is treated as a failure, keeping the current token"

reset_stubs; load
unset AGENT_GH_TOKEN GH_TOKEN
mint_ok fresh-token-one
MINT_TOKEN_CMD="$BIN/mint-ok"
refresh_gh_token >/dev/null 2>&1
is "$GH_TOKEN" fresh-token-one "a successful mint exports the new token"

reset_stubs; load
unset AGENT_GH_TOKEN GH_TOKEN
mint_ok fresh-token-one
MINT_TOKEN_CMD="$BIN/mint-ok"
refresh_gh_token >/dev/null 2>&1
mint_ok fresh-token-two
MINT_TOKEN_CMD="$BIN/mint-ok"
refresh_gh_token >/dev/null 2>&1
is "$GH_TOKEN" fresh-token-two "the next role launch sees the newly minted token"

reset_stubs; load
AGENT_GH_TOKEN=operator-supplied-token
export AGENT_GH_TOKEN
GH_TOKEN="$AGENT_GH_TOKEN"
mint_ok should-never-be-used
MINT_TOKEN_CMD="$BIN/mint-ok"
out=$(refresh_gh_token 2>&1); rc=$?
is "$rc" 0 "AGENT_GH_TOKEN present is treated as success, no warning"
is "$GH_TOKEN" operator-supplied-token "an explicit AGENT_GH_TOKEN override wins over a minted token"
is "$([ -f "$BIN/mint-ok.calls" ] && echo called || echo not-called)" not-called \
  "the mint command is never invoked while AGENT_GH_TOKEN is set"
unset AGENT_GH_TOKEN

reset_stubs; load
unset AGENT_GH_TOKEN GH_TOKEN
mint_ok never-logged-token-xyz
MINT_TOKEN_CMD="$BIN/mint-ok"
refresh_gh_token >/dev/null 2>&1
lacks "$(cat "$LOG_DIR"/*.log 2>/dev/null)" "never-logged-token-xyz" "the minted token value never lands in the log file"
lacks "$out" "never-logged-token-xyz" "the minted token value never appears on refresh_gh_token's own stdout/stderr"

# `set -x` traces every simple command, including a plain assignment and an `export`. A prior
# version's comment claimed the token is safe "not even under set -x", which was false: neither
# the `minted=$(...)` assignment nor the `export GH_TOKEN=...` line was ever guarded, so a traced
# run (`bash -x autopilot.sh`, or a caller that already had tracing on) wrote the live token to
# stderr — and from there to journald and any captured transcript. Traced in-process (not a
# sub-bash) so the export this case checks actually lands in this shell's GH_TOKEN.
reset_stubs; load
unset AGENT_GH_TOKEN GH_TOKEN
mint_ok set-x-fake-token-should-not-leak-abc123
MINT_TOKEN_CMD="$BIN/mint-ok"
trace_file="$BIN/set-x.trace"
set -x
refresh_gh_token 2>"$trace_file"
set +x
trace=$(cat "$trace_file")
lacks "$trace" "set-x-fake-token-should-not-leak-abc123" \
  "refresh_gh_token does not leak the minted token into a set -x trace"
is "$GH_TOKEN" set-x-fake-token-should-not-leak-abc123 \
  "the token is still exported correctly when called under set -x"

# The guard must not itself disable a caller's tracing permanently: if -x was on before the call,
# it must still be on after, so later commands in a traced run stay traced.
reset_stubs; load
unset AGENT_GH_TOKEN GH_TOKEN
mint_ok fresh-token-under-trace
MINT_TOKEN_CMD="$BIN/mint-ok"
trace_file="$BIN/set-x-restore.trace"
{
  set -x
  refresh_gh_token
  echo still-tracing-marker >/dev/null
  set +x
} 2>"$trace_file"
trace=$(cat "$trace_file")
contains "$trace" "+ echo still-tracing-marker" \
  "tracing is restored after refresh_gh_token when the caller had -x on"
contains "$trace" "+ echo still-tracing-marker" \
  "tracing is restored after refresh_gh_token when the caller had -x on"

# ---------------------------------------------------------------------------------------------
section "refresh_gh_token's call sites: run_agent and merge_approved must actually call it"
# ---------------------------------------------------------------------------------------------
# The gap a prior review caught: refresh_gh_token's own unit tests all passed even after the three
# production call sites (main loop, run_agent, pre-merge) were deleted outright, because nothing
# exercised run_agent/merge_approved with a mint stub and checked what token the launch actually
# saw. These cases mint a *different* token per call and read it back off the engine/gh stub's own
# recorded environment — not off refresh_gh_token in isolation — so deleting a call site turns
# them red.
mint_sequence() { # cmd-name token1 token2 ...
  local cmd=$1; shift
  printf '%s\n' "$@" > "$BIN/$cmd.tokens"
  cat >"$BIN/$cmd" <<STUB
#!/usr/bin/env bash
f="$BIN/$cmd.tokens"
n=\$(( \$(cat "$BIN/$cmd.n" 2>/dev/null || echo 0) + 1 ))
echo "\$n" > "$BIN/$cmd.n"
sed -n "\${n}p" "\$f"
STUB
  chmod +x "$BIN/$cmd"
  rm -f "$BIN/$cmd.n"
}

# Since #541, paused() also refreshes on every call (it is polled by wait_out_budget every
# iteration while idling on a spent budget, which is exactly the path that hit the production
# expiry), and run_agent's attempt loop calls paused() once before its own pre-launch refresh — so
# one successful attempt now mints twice, not once: the launch itself still sees the LAST token
# minted before it fires, which is what actually matters for the token reaching the process.
reset_stubs; load
unset AGENT_GH_TOKEN GH_TOKEN
mint_sequence mint-seq token-for-paused-check-1 token-for-launch-one token-for-paused-check-2 token-for-launch-two
MINT_TOKEN_CMD="$BIN/mint-seq"
echo 0 > "$BIN/kiro-cli.rc"; printf 'done\n' > "$BIN/kiro-cli.out"
MODE=kiro
run_agent developer kiro "work" >/dev/null 2>&1
is "$(cat "$BIN/kiro-cli.gh_token_seen")" token-for-launch-one \
  "run_agent refreshes the token before the FIRST launch the mint stub sees"
run_agent developer kiro "work" >/dev/null 2>&1
is "$(tail -n 1 "$BIN/kiro-cli.gh_token_seen")" token-for-launch-two \
  "a second run_agent call mints again and the SECOND launch sees the new token, not a cached one"
is "$(cat "$BIN/mint-seq.n")" 4 \
  "the mint command ran twice per run_agent call (paused()'s own refresh, then the pre-launch refresh), not once and not carried over between calls"

# The retry path inside run_agent must also refresh: a retry on the fallback engine is a second
# launch, up to AGENT_TIMEOUT after the first, so it must not carry the first attempt's token.
reset_stubs; load
unset AGENT_GH_TOKEN GH_TOKEN
mint_sequence mint-retry token-paused-1 token-before-retry token-paused-2 token-after-retry
MINT_TOKEN_CMD="$BIN/mint-retry"
echo 1 > "$BIN/kiro-cli.rc"; printf 'usage limit reached\n' > "$BIN/kiro-cli.out"
echo 0 > "$BIN/claude.rc";   printf 'done\n' > "$BIN/claude.out"
MODE=auto
run_agent developer kiro "work" >/dev/null 2>&1
is "$(cat "$BIN/kiro-cli.gh_token_seen")" token-before-retry "the first, limited attempt gets a fresh token"
is "$(cat "$BIN/claude.gh_token_seen")" token-after-retry \
  "the retry on the fallback engine mints again rather than reusing the first attempt's token"

# merge_approved is the other call site named in the issue: a merge push must carry a token minted
# for this pass, not one left over from whichever role ran before it. Goes through
# refresh_and_merge — the exact pairing the main loop calls — rather than calling refresh_gh_token
# and merge_approved separately, so removing either call inside it turns this red.
reset_stubs; load
unset AGENT_GH_TOKEN GH_TOKEN
mint_sequence mint-merge token-for-merge-push
MINT_TOKEN_CMD="$BIN/mint-merge"
GH_TOKEN=stale-role-token   # simulates the token a role minted earlier in the same cycle
git -C . commit --allow-empty -q -m base
head=$(git -C . rev-parse HEAD)
cat > "$BIN/fixture-pr-approved.json" <<JSON
[{"number":599}]
JSON
cat > "$BIN/fixture-pr-view-599.json" <<JSON
{"headRefOid":"$head","mergeStateStatus":"CLEAN","files":[],
 "comments":[{"body":"agent-approved-sha: $head"}],
 "statusCheckRollup":[{"name":"CI gate","conclusion":"SUCCESS"}],"labels":[]}
JSON
refresh_and_merge >/dev/null 2>&1
contains "$(cat "$BIN/gh.calls")" "pr merge 599" "sanity: the merge in this case actually ran"
is "$(cat "$BIN/gh.merge_gh_token_seen")" token-for-merge-push \
  "refresh_and_merge mints before merging, so gh pr merge sees the fresh token, not the stale one"
is "$(cat "$BIN/mint-merge.n")" 1 "the mint command ran exactly once for this pairing"

# ---------------------------------------------------------------------------------------------
section "run_cycle: the token is fresh before git fetch/ops_pull, via paused()'s own refresh"
# ---------------------------------------------------------------------------------------------
# Originally (#524) this was a standalone refresh_gh_token call at the top of run_cycle, placed
# after `paused` and before `git fetch`. Since #541 made paused() itself refresh unconditionally
# before its label query, that standalone call became pure redundancy — paused() (run_cycle's very
# first line) already guarantees GH_TOKEN is fresh by the time ops_pull's clone runs, so the extra
# call was removed rather than kept as a second, wasted mint back to back. This section now pins
# THAT guarantee directly: ops_pull's clone sees whatever paused() minted, and removing paused()'s
# own refresh (not a separate call site) is what turns it red.
reset_stubs; load
unset AGENT_GH_TOKEN GH_TOKEN
mint_sequence mint-cycle token-for-paused-check token-for-manager-launch
MINT_TOKEN_CMD="$BIN/mint-cycle"
echo 0 > "$BIN/claude.rc"; printf 'done\n' > "$BIN/claude.out"
DEVS_PER_CYCLE=0
ROTATION=()
cycle=0; slot_n=0; broken_streak=0
MODE=auto
run_cycle >/dev/null 2>&1
is "$(cat "$BIN/gh.clone_gh_token_seen")" token-for-paused-check \
  "run_cycle's own paused() call refreshes the token before git fetch/ops_pull, so the ops-repo clone sees the freshly minted one, not an empty/stale GH_TOKEN"

# Reproduce the reviewer's mutation in its current form: paused()'s own refresh_gh_token call
# removed (the #541 fix reverted for this one line), everything else unchanged.
reset_stubs; load
unset AGENT_GH_TOKEN GH_TOKEN
mint_sequence mint-mutant should-never-be-seen
MINT_TOKEN_CMD="$BIN/mint-mutant"
echo 0 > "$BIN/claude.rc"; printf 'done\n' > "$BIN/claude.out"
DEVS_PER_CYCLE=0
ROTATION=()
cycle=0; slot_n=0; broken_streak=0
MODE=auto
GH_TOKEN=stale-token-from-a-previous-cycle
export GH_TOKEN
# shellcheck disable=SC2317  # invoked below; shellcheck can't see the reassignment
paused() {
  [ -f "$PAUSE_FILE" ] && return 0
  # paused()'s own refresh_gh_token call deliberately omitted here, matching the mutation
  local out
  if ! out=$(gh issue list -R "$REPO" --state open --label agents:paused --json number -q 'length' 2>/dev/null) \
      || [ -z "$out" ]; then
    return 1
  fi
  [ "$out" != "0" ]
}
run_cycle >/dev/null 2>&1
is "$(cat "$BIN/gh.clone_gh_token_seen")" stale-token-from-a-previous-cycle \
  "mutant sanity check: with paused()'s own refresh removed, ops_pull's clone carries the stale token, confirming this case would have caught its absence"
is "$([ -f "$BIN/mint-mutant.n" ] && cat "$BIN/mint-mutant.n" || echo 0)" 4 \
  "mutant sanity check: the mint command still ran from manager's and reviewer's pre-launch refreshes, refresh_and_merge, and the unconditional post-developer refresh (DEVS_PER_CYCLE=0 skips the loop body, not that line) — none of them backfill the clone that already happened"

# ---------------------------------------------------------------------------------------------
section "run_cycle: refreshes again after each role, before the ops_push that follows it (#541 pt.3)"
# ---------------------------------------------------------------------------------------------
# A role may run for the full AGENT_TIMEOUT (90m by default), well past the token's 60-minute
# life. run_agent already refreshes before ITS OWN launch, so that alone cannot prove the
# post-role refresh exists — the count has to be higher than "one mint per run_agent call" for
# that to be visible. Since #541, paused() itself also refreshes on every call, and this cycle
# calls it at: the top of run_cycle, inside each of the three run_agent calls' attempt loops
# (manager, reviewer, developer), the developer loop's own `paused &&` guard, and the rotation
# slot's `paused ||` guard — six paused()-driven mints — plus one pre-launch refresh per
# run_agent call (manager, reviewer, developer, rotation = 4), refresh_and_merge's mint, and the
# two new post-role refreshes (after developer, after rotation): 6 + 4 + 1 + 2 = 13, plus
# reviewer's `paused` (already counted above) — total 14.
reset_stubs; load
unset AGENT_GH_TOKEN GH_TOKEN
counting_mint() {
  rm -f "$BIN/mint-count.n"
  cat >"$BIN/mint-count" <<STUB
#!/usr/bin/env bash
n=\$(( \$(cat "$BIN/mint-count.n" 2>/dev/null || echo 0) + 1 ))
echo "\$n" > "$BIN/mint-count.n"
echo "token-\$n"
STUB
  chmod +x "$BIN/mint-count"
}
counting_mint
MINT_TOKEN_CMD="$BIN/mint-count"
echo 0 > "$BIN/claude.rc"; printf 'done\n' > "$BIN/claude.out"
echo 0 > "$BIN/kiro-cli.rc"; printf 'done\n' > "$BIN/kiro-cli.out"
DEVS_PER_CYCLE=1
ROTATION=(cloud)
SLOT_EVERY=1
cycle=0; slot_n=0; broken_streak=0
MODE=auto
run_cycle >/dev/null 2>&1
is "$(cat "$BIN/mint-count.n")" 14 \
  "run_cycle mints once more after the developer loop and once more after the rotation slot, on top of paused()'s own refreshes and the per-role pre-launch refreshes"

# Reproduce the reviewer's mutation: the two post-role refresh_gh_token lines removed, everything
# else unchanged, to prove this exact case is the one that would catch their absence.
reset_stubs; load
unset AGENT_GH_TOKEN GH_TOKEN
counting_mint
MINT_TOKEN_CMD="$BIN/mint-count"
echo 0 > "$BIN/claude.rc"; printf 'done\n' > "$BIN/claude.out"
echo 0 > "$BIN/kiro-cli.rc"; printf 'done\n' > "$BIN/kiro-cli.out"
DEVS_PER_CYCLE=1
ROTATION=(cloud)
SLOT_EVERY=1
cycle=0; slot_n=0; broken_streak=0
MODE=auto
# shellcheck disable=SC2317  # invoked below; shellcheck can't see the reassignment
run_cycle() {
  if paused; then log "paused"; return 1; fi
  if over_budget; then wait_out_budget || return 1; fi
  cycle=$((cycle + 1))
  MODE=$(engine_mode)
  CYCLE_WORKED=0; CYCLE_BROKEN=0
  git fetch -q origin 2>/dev/null
  ops_pull || true
  run_agent manager "$ENGINE_MANAGER" "Run your triage pass on $REPO now."
  run_agent reviewer "$ENGINE_REVIEWER" "Do part A (review open PRs) and part B (adjudicate QA findings) now."
  ops_push
  refresh_and_merge
  for _ in $(seq 1 "$DEVS_PER_CYCLE"); do
    paused && break
    run_agent developer "$ENGINE_DEVELOPER" "Take the next piece of work and carry it to an open PR." || break
  done
  # post-developer refresh_gh_token deliberately omitted here, matching the reviewer's mutation
  ops_push
  if [ "${#ROTATION[@]}" -gt 0 ] && [ $(( (cycle - 1) % SLOT_EVERY )) -eq 0 ]; then
    slot=${ROTATION[$(( slot_n % ${#ROTATION[@]} ))]}
    slot_n=$((slot_n + 1))
    role=${slot%%:*}; focus=${slot#*:}
    paused || run_agent "$role" "$ENGINE_QA" "Run one $role session now. Focus: $focus."
    # post-rotation refresh_gh_token deliberately omitted here, matching the reviewer's mutation
    ops_push
  fi
  return 0
}
run_cycle >/dev/null 2>&1
is "$(cat "$BIN/mint-count.n")" 12 \
  "mutant sanity check: with both post-role refreshes removed, only 12 mints happen (14 minus the two removed lines), confirming this case would catch either line's absence"


reset_stubs; load
CREDIT_CEILING_DAY=100
add_credits 40 >/dev/null; add_credits 35 >/dev/null
is "$(cat "$(credit_file)")" 75.00 "credits accumulate across runs"
if over_budget; then bad "under budget is not over budget"; else ok "under budget is not over budget"; fi
add_credits 30 >/dev/null
if over_budget; then ok "crossing the ceiling trips over_budget"; else bad "crossing the ceiling trips over_budget"; fi
CREDIT_CEILING_DAY=0
if over_budget; then bad "a ceiling of 0 disables the check"; else ok "a ceiling of 0 disables the check"; fi

reset_stubs; load
pause_factory "test reason" >/dev/null
if [ -f "$PAUSE_FILE" ]; then ok "pause_factory writes the same kill switch a human uses"; else bad "pause_factory writes the kill switch"; fi
contains "$(cat "$STATE_DIR/alerts.log")" "pausing the factory" "pausing records an alert for the digest"

# A spent budget must not leave the factory stopped past midnight waiting for a human. The kill
# switch is for conditions someone has to look at; a budget resets on its own.
reset_stubs; load
CREDIT_CEILING_DAY=10
add_credits 11 >/dev/null
END=$(( $(date +%s) - 1 ))     # shift already over, so wait_out_budget returns instead of sleeping
wait_out_budget >/dev/null 2>&1; rc=$?
is "$rc" 1 "an over-budget shift ends rather than looping"
if [ -f "$PAUSE_FILE" ]; then
  bad "a spent budget does not set the human kill switch"
else
  ok "a spent budget does not set the human kill switch"
fi
contains "$(cat "$STATE_DIR/alerts.log")" "idling until midnight" "the budget alert says it will resume by itself"
contains "$(cat "$STATE_DIR/alerts.log")" "IST" "the budget alert names the timezone the reader thinks in"

# Raising the ceiling (or the day rolling over) must let it continue without intervention.
reset_stubs; load
CREDIT_CEILING_DAY=10
add_credits 11 >/dev/null
if over_budget; then ok "over budget before the ceiling is raised"; else bad "over budget before the ceiling is raised"; fi
CREDIT_CEILING_DAY=1000
if over_budget; then bad "raising the ceiling clears the over-budget state"; else ok "raising the ceiling clears the over-budget state"; fi

# ---------------------------------------------------------------------------------------------
section "approval_holds: does an approval survive what happened to the branch since"
# ---------------------------------------------------------------------------------------------
reset_stubs; load
is "$(approval_holds 1 "" "abc123"; echo $?)" 1 "no agent-approved-sha comment means the approval never held"

reset_stubs; load
is "$(approval_holds 1 "abc123" "abc123"; echo $?)" 0 "approved sha equal to head still holds"

# ---------------------------------------------------------------------------------------------
section "merge_approved: the function that decides what reaches main unattended"
# ---------------------------------------------------------------------------------------------
# git plumbing is exercised directly (approval_holds calls git fetch/merge-base/patch-id), so these
# cases run inside a real git repo with real commits rather than stubbing git.
approved_sha_comment() { printf '%s' "agent-approved-sha: $1"; }

# One commit approved, then a second pushed after approval: the real regression `approval_holds`
# exists to catch, exercised through merge_approved end to end.
reset_stubs; load
git -C . commit --allow-empty -q -m base
approved_head=$(git -C . rev-parse HEAD)
git -C . commit --allow-empty -q -m "new work after approval"
new_head=$(git -C . rev-parse HEAD)
cat > "$BIN/fixture-pr-approved.json" <<JSON
[{"number":501}]
JSON
cat > "$BIN/fixture-pr-view-501.json" <<JSON
{"headRefOid":"$new_head","mergeStateStatus":"CLEAN","files":[],
 "comments":[{"body":"$(approved_sha_comment "$approved_head")"}],
 "statusCheckRollup":[{"name":"CI gate","conclusion":"SUCCESS"}],"labels":[]}
JSON
merge_approved >/dev/null 2>&1
lacks "$(cat "$BIN/gh.calls")" "pr merge 501" "a PR pushed to after approval is not merged on the strength of the old approval"
contains "$(cat "$BIN/gh.calls")" "pr edit 501 -R owner/repo --remove-label agent:approved" "it is sent back for re-review instead"

# state=CLEAN, gate=SUCCESS, approval still holds (head unchanged since approval): merges.
reset_stubs; load
git -C . commit --allow-empty -q -m base
head=$(git -C . rev-parse HEAD)
cat > "$BIN/fixture-pr-approved.json" <<JSON
[{"number":502}]
JSON
cat > "$BIN/fixture-pr-view-502.json" <<JSON
{"headRefOid":"$head","mergeStateStatus":"CLEAN","files":[],
 "comments":[{"body":"$(approved_sha_comment "$head")"}],
 "statusCheckRollup":[{"name":"CI gate","conclusion":"SUCCESS"}],"labels":[]}
JSON
merge_approved >/dev/null 2>&1
contains "$(cat "$BIN/gh.calls")" "pr merge 502" "an approved, green, unchanged PR is merged"

# state=UNKNOWN is the bug this issue is about: GitHub has not finished recomputing mergeability,
# typically right after another PR in the same pass just merged. It is not "mergeable" and must
# not be attempted — it must be retried next cycle instead.
reset_stubs; load
git -C . commit --allow-empty -q -m base
head=$(git -C . rev-parse HEAD)
cat > "$BIN/fixture-pr-approved.json" <<JSON
[{"number":503}]
JSON
cat > "$BIN/fixture-pr-view-503.json" <<JSON
{"headRefOid":"$head","mergeStateStatus":"UNKNOWN","files":[],
 "comments":[{"body":"$(approved_sha_comment "$head")"}],
 "statusCheckRollup":[{"name":"CI gate","conclusion":"SUCCESS"}],"labels":[]}
JSON
merge_approved >/dev/null 2>&1
lacks "$(cat "$BIN/gh.calls")" "pr merge 503" "mergeStateStatus=UNKNOWN is never attempted as a merge"
lacks "$(cat "$BIN/gh.calls")" "pr edit 503" "an UNKNOWN PR keeps its agent:approved label rather than being bounced"
lacks "$(cat "$BIN/gh.calls")" "pr update-branch 503" "UNKNOWN is not treated as BEHIND either"

# A second approved PR in the same pass, still UNKNOWN, must not stop the pass from merging others.
reset_stubs; load
git -C . commit --allow-empty -q -m base
head_a=$(git -C . rev-parse HEAD)
git -C . commit --allow-empty -q -m second
head_b=$(git -C . rev-parse HEAD)
cat > "$BIN/fixture-pr-approved.json" <<JSON
[{"number":504},{"number":505}]
JSON
cat > "$BIN/fixture-pr-view-504.json" <<JSON
{"headRefOid":"$head_a","mergeStateStatus":"CLEAN","files":[],
 "comments":[{"body":"$(approved_sha_comment "$head_a")"}],
 "statusCheckRollup":[{"name":"CI gate","conclusion":"SUCCESS"}],"labels":[]}
JSON
cat > "$BIN/fixture-pr-view-505.json" <<JSON
{"headRefOid":"$head_b","mergeStateStatus":"UNKNOWN","files":[],
 "comments":[{"body":"$(approved_sha_comment "$head_b")"}],
 "statusCheckRollup":[{"name":"CI gate","conclusion":"SUCCESS"}],"labels":[]}
JSON
merge_approved >/dev/null 2>&1
contains "$(cat "$BIN/gh.calls")" "pr merge 504" "an earlier CLEAN PR in the same pass still merges"
lacks "$(cat "$BIN/gh.calls")" "pr merge 505" "a later UNKNOWN PR in the same pass is still not attempted"

# BEHIND still updates the branch (unchanged behaviour — this suite is new, the branch is not).
reset_stubs; load
git -C . commit --allow-empty -q -m base
head=$(git -C . rev-parse HEAD)
cat > "$BIN/fixture-pr-approved.json" <<JSON
[{"number":506}]
JSON
cat > "$BIN/fixture-pr-view-506.json" <<JSON
{"headRefOid":"$head","mergeStateStatus":"BEHIND","files":[],
 "comments":[{"body":"$(approved_sha_comment "$head")"}],
 "statusCheckRollup":[{"name":"CI gate","conclusion":"SUCCESS"}],"labels":[]}
JSON
merge_approved >/dev/null 2>&1
contains "$(cat "$BIN/gh.calls")" "pr update-branch 506" "BEHIND still triggers update-branch"
lacks "$(cat "$BIN/gh.calls")" "pr merge 506" "a BEHIND PR is not merged in the same pass that updates it"

# DIRTY still bounces to changes-requested (unchanged behaviour, pinned alongside the new UNKNOWN case).
reset_stubs; load
git -C . commit --allow-empty -q -m base
head=$(git -C . rev-parse HEAD)
cat > "$BIN/fixture-pr-approved.json" <<JSON
[{"number":507}]
JSON
cat > "$BIN/fixture-pr-view-507.json" <<JSON
{"headRefOid":"$head","mergeStateStatus":"DIRTY","files":[],
 "comments":[{"body":"$(approved_sha_comment "$head")"}],
 "statusCheckRollup":[{"name":"CI gate","conclusion":"SUCCESS"}],"labels":[]}
JSON
merge_approved >/dev/null 2>&1
contains "$(cat "$BIN/gh.calls")" "pr edit 507 -R owner/repo --remove-label agent:approved --add-label agent:changes-requested" "DIRTY sends the PR back to the developer"
contains "$(cat "$BIN/gh.calls")" "pr comment 507" "DIRTY leaves a comment explaining the conflict"

# A PR touching .github/workflows/ is left for the maintainer, never merged, UNKNOWN or not.
reset_stubs; load
git -C . commit --allow-empty -q -m base
head=$(git -C . rev-parse HEAD)
cat > "$BIN/fixture-pr-approved.json" <<JSON
[{"number":508}]
JSON
cat > "$BIN/fixture-pr-view-508.json" <<JSON
{"headRefOid":"$head","mergeStateStatus":"UNKNOWN","files":[{"path":".github/workflows/verify.yml"}],
 "comments":[{"body":"$(approved_sha_comment "$head")"}],
 "statusCheckRollup":[{"name":"CI gate","conclusion":"SUCCESS"}],"labels":[]}
JSON
merge_approved >/dev/null 2>&1
lacks "$(cat "$BIN/gh.calls")" "pr merge 508" "a workflow-touching PR is never merged by the autopilot"
contains "$(cat "$BIN/gh.calls")" "pr edit 508 -R owner/repo --add-label needs-human" "a workflow-touching PR is labelled needs-human instead"

# ---------------------------------------------------------------------------------------------
section "engine selection and cooldown"
# ---------------------------------------------------------------------------------------------
reset_stubs; load
MODE=auto
is "$(pick_engine claude)" claude "auto with both healthy uses the preferred engine"
cool_down claude >/dev/null
is "$(pick_engine claude)" kiro "auto falls back when the preferred engine is cooling"
is "$(pick_engine kiro)" kiro "the healthy engine is still used for its own roles"
cool_down kiro >/dev/null
is "$(pick_engine claude)" "" "auto with both cooling has no engine"

reset_stubs; load
MODE=kiro
is "$(pick_engine claude)" kiro "a forced engine overrides the role's preference"
cool_down kiro >/dev/null
is "$(pick_engine claude)" "" "a forced engine that is cooling runs nothing rather than falling back"

# ---------------------------------------------------------------------------------------------
section "reviewer independence"
# ---------------------------------------------------------------------------------------------
reset_stubs; load
is "$(model_for kiro reviewer)" "$KIRO_MODEL_REVIEWER" "the reviewer gets its own model"
is "$(model_for kiro developer)" "$KIRO_MODEL_DEFAULT" "other roles get the default model"
[ "$(model_for kiro reviewer)" != "$(model_for kiro developer)" ] \
  && ok "on kiro the reviewer is not the model that wrote the code" \
  || bad "on kiro the reviewer is not the model that wrote the code"
[ "$(model_for claude reviewer)" != "$(model_for claude developer)" ] \
  && ok "on claude the reviewer is not the model that wrote the code" \
  || bad "on claude the reviewer is not the model that wrote the code"
is "$(model_family "$(model_for kiro reviewer)")" openai "the default Kiro reviewer is a different vendor"
[ "$(model_family "$(model_for kiro reviewer)")" != "$(model_family "$(model_for kiro developer)")" ] \
  && ok "on kiro reviewer and developer are different vendors, so their blind spots differ" \
  || bad "on kiro reviewer and developer are different vendors"
is "$(model_family claude-opus-5)" anthropic "model_family maps Claude models"
is "$(model_family glm-5)" zai "model_family maps GLM"
is "$(model_family qwen3-coder-next)" qwen "model_family maps Qwen"

# The invariant, not the current value: overriding the reviewer to the developer's family warns.
out=$(KIRO_MODEL_REVIEWER=claude-opus-5 KIRO_MODEL_DEFAULT=claude-sonnet-5 \
      bash -c 'AUTOPILOT_LIB_ONLY=1 STATE_DIR=$PWD/.s PAUSE_FILE=$PWD/.p source '"$SRC"'; check_reviewer_independence kiro' 2>&1)
contains "$out" "may correlate" "same-vendor reviewer and developer is called out"

# ---------------------------------------------------------------------------------------------
section "effort is passed to Kiro and not to Claude Code"
# ---------------------------------------------------------------------------------------------
reset_stubs; load
is "$(effort_for kiro reviewer)" max "the reviewer runs at max effort"
is "$(effort_for kiro developer)" xhigh "other roles run at xhigh effort"
is "$(effort_for claude reviewer)" "" "Claude Code is given no effort flag"

reset_stubs; load
echo 0 > "$BIN/kiro-cli.rc"; printf 'done\n' > "$BIN/kiro-cli.out"
MODE=kiro
run_agent reviewer kiro "review" >/dev/null 2>&1
contains "$(cat "$BIN/kiro-cli.calls")" "--effort max" "the reviewer's Kiro invocation carries --effort max"
contains "$(cat "$BIN/kiro-cli.calls")" "--model gpt-5.6-terra" "the reviewer's Kiro invocation carries the cross-vendor model"

reset_stubs; load
echo 0 > "$BIN/claude.rc"; printf 'done\n' > "$BIN/claude.out"
MODE=claude
run_agent reviewer claude "review" >/dev/null 2>&1
lacks "$(cat "$BIN/claude.calls")" "--effort" "Claude Code is never passed --effort"

# ---------------------------------------------------------------------------------------------
section "run_agent: retries, escalation and the kill switch"
# ---------------------------------------------------------------------------------------------
reset_stubs; load
echo 0 > "$BIN/kiro-cli.rc"; printf 'all done\n' > "$BIN/kiro-cli.out"
MODE=auto
run_agent developer kiro "work" >/dev/null 2>&1; rc=$?
is "$rc" 0 "a successful run returns 0"
is "$CYCLE_WORKED" 1 "a successful run counts as work done"
is "$CYCLE_BROKEN" 0 "a successful run is not counted as broken"
is "$(wc -l < "$BIN/kiro-cli.calls")" 1 "a successful run is not retried"

# Limited on the preferred engine: cool it down and retry once on the other one.
reset_stubs; load
echo 1 > "$BIN/kiro-cli.rc"; printf 'Error: out of credits\n' > "$BIN/kiro-cli.out"
echo 0 > "$BIN/claude.rc";   printf 'done\n' > "$BIN/claude.out"
MODE=auto
run_agent developer kiro "work" >/dev/null 2>&1; rc=$?
is "$rc" 0 "a quota-limited run is retried on the other engine and succeeds"
is "$(wc -l < "$BIN/kiro-cli.calls")" 1 "the limited engine is called only once"
is "$(wc -l < "$BIN/claude.calls")" 1 "the fallback engine is called once"
if cooling kiro; then ok "the limited engine is put in cooldown"; else bad "the limited engine is put in cooldown"; fi

# Both engines limited: one call each, then give up. No spinning.
reset_stubs; load
echo 1 > "$BIN/kiro-cli.rc"; printf 'usage limit reached\n' > "$BIN/kiro-cli.out"
echo 1 > "$BIN/claude.rc";   printf 'usage limit reached\n' > "$BIN/claude.out"
MODE=auto
run_agent developer kiro "work" >/dev/null 2>&1; rc=$?
is "$rc" 99 "with both engines limited the role is skipped"
is "$(wc -l < "$BIN/kiro-cli.calls")" 1 "no repeat calls to a limited engine"
is "$(wc -l < "$BIN/claude.calls")" 1 "no repeat calls to the other limited engine"

# The bug this suite exists for: a hard failure must not be reported as success.
reset_stubs; load
echo 127 > "$BIN/kiro-cli.rc"; printf 'command not found\n' > "$BIN/kiro-cli.out"
echo 127 > "$BIN/claude.rc";   printf 'command not found\n' > "$BIN/claude.out"
MODE=auto
run_agent developer kiro "work" >/dev/null 2>&1; rc=$?
[ "$rc" -ne 0 ] && ok "a broken engine does not return success" || bad "a broken engine does not return success"
is "$CYCLE_BROKEN" 2 "each broken attempt is counted for the circuit breaker"
is "$CYCLE_WORKED" 0 "a broken run is never counted as work"
contains "$(cat "$STATE_DIR/alerts.log")" "non-quota reason" "a broken run raises an alert the digest will carry"
if cooling kiro; then bad "a broken engine is not mistaken for a throttled one"; else ok "a broken engine is not mistaken for a throttled one"; fi

# A timeout burned the full budget once already; retrying would burn it again.
reset_stubs; load
echo 124 > "$BIN/kiro-cli.rc"; printf 'still working\n' > "$BIN/kiro-cli.out"
MODE=kiro
run_agent developer kiro "work" >/dev/null 2>&1; rc=$?
[ "$rc" -ne 0 ] && ok "a timeout does not return success" || bad "a timeout does not return success"
is "$(wc -l < "$BIN/kiro-cli.calls")" 1 "a timeout is not retried"
contains "$(cat "$STATE_DIR/alerts.log")" "timeout" "a timeout raises an alert"

# The kill switch must be honoured between attempts, not only before the first one.
reset_stubs; load
echo 1 > "$BIN/kiro-cli.rc"; printf 'out of credits\n' > "$BIN/kiro-cli.out"
echo 0 > "$BIN/claude.rc";   printf 'done\n' > "$BIN/claude.out"
MODE=auto
# The first attempt fails with a limit and, mid-run, the human pauses the factory.
cat >"$BIN/kiro-cli" <<STUB
#!/usr/bin/env bash
printf '%s\n' "\$*" >> "$BIN/kiro-cli.calls"
echo 'out of credits'
touch "$PAUSE_FILE"
exit 1
STUB
chmod +x "$BIN/kiro-cli"
run_agent developer kiro "work" >/dev/null 2>&1; rc=$?
is "$rc" 99 "a paused factory stops the retry"
is "$(wc -l < "$BIN/kiro-cli.calls")" 1 "the first attempt ran"
if [ -f "$BIN/claude.calls" ]; then
  bad "no second session is started after the kill switch goes on"
else
  ok "no second session is started after the kill switch goes on"
fi

# Spend is metered even when the run is retried.
reset_stubs; load
printf 'done\n ▸ Credits: 7.50 • Time: 2m 1s\n' > "$BIN/kiro-cli.out"; echo 0 > "$BIN/kiro-cli.rc"
MODE=kiro
run_agent developer kiro "work" >/dev/null 2>&1
is "$(cat "$(credit_file)")" 7.50 "a run's reported credits are added to the day's total"

# The ceiling must stop the next session, not merely be noticed at the top of the next cycle:
# an overshoot should cost one run at most.
reset_stubs; load
printf 'done\n' > "$BIN/kiro-cli.out"; echo 0 > "$BIN/kiro-cli.rc"
CREDIT_CEILING_DAY=10
add_credits 11 >/dev/null
MODE=kiro
run_agent developer kiro "work" >/dev/null 2>&1; rc=$?
is "$rc" 99 "a role is skipped once the day's budget is spent"
if [ -f "$BIN/kiro-cli.calls" ]; then
  bad "no agent session is started over budget"
else
  ok "no agent session is started over budget"
fi

# ---------------------------------------------------------------------------------------------
section "engine_mode: the phone-friendly switch"
# ---------------------------------------------------------------------------------------------
reset_stubs; load
is "$(engine_mode)" auto "no label and no state file means auto"

echo "engine:kiro" > "$BIN/gh.enginelabels"
is "$(engine_mode)" kiro "an engine:kiro label forces kiro"
echo "engine:claude" > "$BIN/gh.enginelabels"
is "$(engine_mode)" claude "an engine:claude label forces claude"
echo "engine:claude engine:kiro" > "$BIN/gh.enginelabels"
is "$(engine_mode 2>/dev/null)" auto "contradictory labels are ignored rather than guessed"

reset_stubs; load
echo kiro > "$STATE_DIR/engine-mode"
is "$(engine_mode)" kiro "the state file switches the engine when no label does"
echo "engine:claude" > "$BIN/gh.enginelabels"
is "$(engine_mode)" claude "a label beats the state file"

# This runs every cycle for the life of the factory, so it must not narrate a missing file.
reset_stubs; load
noise=$(engine_mode 2>&1 >/dev/null)
is "$noise" "" "reading a state file that does not exist is silent"

# ---------------------------------------------------------------------------------------------
section "digest: the maintainer's once-a-day interface"
# ---------------------------------------------------------------------------------------------
reset_stubs; load
: > "$BIN/gh.digestissue"          # no existing digest issue
add_credits 12.5 >/dev/null
alert "something needed attention"
digest_now "test" >/dev/null 2>&1
calls=$(cat "$BIN/gh.calls")
contains "$calls" "issue create" "the digest creates its own issue when none exists"
contains "$calls" "issue comment 77" "the digest comments on that issue, which is what notifies a phone"

# Assertions about digest *content* must read only the posted body. The stub logs every argument
# list, which includes the jq filters themselves — matching against the whole log would pass on the
# filter's own source text and never fail, which is exactly the kind of toothless assertion that let
# a broken filter ship in the first place.
body=$(cat "$BIN/gh.lastbody" 2>/dev/null)
contains "$body" "12.50" "the digest reports the day's spend"
contains "$body" "something needed attention" "the digest carries the alerts raised since the last one"

# Every jq filter the digest uses is now compiled by the real jq. A malformed one — which is what
# shipped in the first cut of this feature — leaves a marker instead of silently blanking a section.
if [ -f "$BIN/gh.jqfail" ]; then
  bad "every digest jq filter compiles" "$(cat "$BIN/gh.jqfail")"
else
  ok "every digest jq filter compiles"
fi

# The section an absent maintainer reads first must actually have rows in it.
contains "$body" "#476" "the Open PRs section lists the open PRs"
contains "$body" "#468" "the Open PRs section lists every open PR, not just the first"
contains "$body" "[BEHIND]" "each open PR carries its mergeability"
contains "$body" "agent:pr-open" "a labelled PR shows its labels"
contains "$body" "no labels" "an unlabelled PR says so instead of trailing an empty dash"
contains "$body" "#467" "the Merged section lists what landed"
contains "$body" "#423" "the Waiting on you section lists decisions"

reset_stubs; load
echo 42 > "$BIN/gh.digestissue"
digest_now "test" >/dev/null 2>&1
lacks "$(cat "$BIN/gh.calls")" "issue create" "an existing digest issue is reused, not duplicated"
contains "$(cat "$BIN/gh.calls")" "issue comment 42" "the digest comments on the existing issue"

# One notification a day, at an hour a person would want it.
reset_stubs; load
echo 42 > "$BIN/gh.digestissue"
DIGEST_HOUR=0                      # so the case does not depend on the wall clock
digest_daily >/dev/null 2>&1
digest_daily >/dev/null 2>&1
digest_daily >/dev/null 2>&1
is "$(grep -c 'issue comment' "$BIN/gh.calls")" 1 "digest_daily posts at most once per factory day"

# The summary must not arrive at 05:30 local just because that is when the UTC date changed.
reset_stubs; load
echo 42 > "$BIN/gh.digestissue"
DIGEST_HOUR=99                     # an hour that can never have arrived
digest_daily >/dev/null 2>&1
lacks "$(cat "$BIN/gh.calls")" "issue comment" "no digest before DIGEST_HOUR"
DIGEST_HOUR=0
digest_daily >/dev/null 2>&1
contains "$(cat "$BIN/gh.calls")" "issue comment" "the digest posts on the first cycle at or after DIGEST_HOUR"

# The factory computes against GitHub and CI in UTC, but everything it reports — and every boundary
# a human reasons about — is in their timezone.
reset_stubs; load
DISPLAY_TZ=Asia/Kolkata
stamp=$(local_stamp)
contains "$stamp" "IST" "the digest stamp renders the maintainer's timezone"
contains "$stamp" "Z)" "the digest stamp keeps UTC alongside it, so it can still be matched to a log line"
DISPLAY_TZ=UTC
lacks "$(local_stamp)" "IST" "DISPLAY_TZ=UTC turns local rendering off"
contains "$(local_stamp)" "Z" "with DISPLAY_TZ=UTC the stamp is still unambiguous"

# "Spend today" has to mean the reader's today, so the budget day follows DISPLAY_TZ.
reset_stubs; load
DISPLAY_TZ=Asia/Kolkata
is "$(factory_day)" "$(TZ=Asia/Kolkata date +%Y%m%d)" "the factory day is the local day"
is "$(credit_file)" "$STATE_DIR/credits-$(TZ=Asia/Kolkata date +%Y%m%d)" "the budget is keyed to the local day, not the UTC one"

# A timezone far enough ahead to be on a different date from UTC proves the key really moves.
reset_stubs; load
DISPLAY_TZ=Pacific/Kiritimati      # UTC+14
is "$(factory_day)" "$(TZ=Pacific/Kiritimati date +%Y%m%d)" "a timezone on tomorrow's date gets tomorrow's budget file"
if [ "$(TZ=Pacific/Kiritimati date +%Y%m%d)" != "$(date -u +%Y%m%d)" ]; then
  lacks "$(credit_file)" "$(date -u +%Y%m%d)" "the budget file is not the UTC day when they differ"
else
  ok "the budget file is not the UTC day when they differ (zones agree right now; skipped)"
fi

# Log lines sit next to journald's own prefix, which the reader can render in any zone, so the
# factory's timestamps must say which clock they are on.
reset_stubs; load
DISPLAY_TZ=Asia/Kolkata
line=$(log "hello" 2>&1)
contains "$line" "IST" "log lines name their timezone so they cannot be misread next to journald's prefix"
is "$(echo "$line" | grep -cE '^\[[0-9]{2}:[0-9]{2}:[0-9]{2} [A-Z]{3,5}\] hello$')" 1 "log format is [HH:MM:SS ZONE] message"
DISPLAY_TZ=UTC
contains "$(log "hi" 2>&1)" "UTC" "with DISPLAY_TZ=UTC the log says UTC"

# Rendering must not leak into artefacts that have to line up with GitHub and CI.
reset_stubs; load
DISPLAY_TZ=Pacific/Kiritimati
is "$LOG_DIR" ".agent-logs/$(date -u +%Y%m%d)" "log directories stay on the UTC day, to match CI and GitHub"

# ---------------------------------------------------------------------------------------------
section "check_checkout_clean: a dirty pinned checkout breaks the next restart"
# ---------------------------------------------------------------------------------------------
# `load` already did `git init` in a throwaway repo and cd'd into it, matching the real pinned
# checkout autopilot.sh runs from (it cd's to `git rev-parse --show-toplevel`).
reset_stubs; load
check_checkout_clean
is "$(cat "$STATE_DIR/alerts.log" 2>/dev/null)" "" "a freshly-initialised, untouched repo is clean"

reset_stubs; load
echo "changed" > tracked-and-dirty.txt
git add tracked-and-dirty.txt
git commit -q -m "seed a tracked file"
echo "modified after commit" > tracked-and-dirty.txt
check_checkout_clean
contains "$(cat "$STATE_DIR/alerts.log")" "pinned checkout is dirty" "a modified tracked file is caught and alerted"
contains "$(cat "$STATE_DIR/alerts.log")" "tracked-and-dirty.txt" "the alert names the dirty file"

reset_stubs; load
echo "never committed" > untracked-file.txt
check_checkout_clean
contains "$(cat "$STATE_DIR/alerts.log")" "pinned checkout is dirty" "an untracked file is caught too (this is how origin/main later adding that path bites)"
contains "$(cat "$STATE_DIR/alerts.log")" "untracked-file.txt" "the alert names the untracked file"

# The acceptance criteria are explicit: nothing here may delete, stash or reset anything, however
# tempting a "helpful" cleanup would be — a dirty checkout is evidence an agent broke the worktree
# rule, and that evidence must survive for a human to look at.
reset_stubs; load
echo "must survive" > must-survive.txt
check_checkout_clean >/dev/null
if [ -f must-survive.txt ]; then
  ok "check_checkout_clean does not delete the offending file"
else
  bad "check_checkout_clean does not delete the offending file" "file is gone"
fi
is "$(cat must-survive.txt)" "must survive" "check_checkout_clean does not touch the file's contents"

# One alert line per call, not one per dirty file, so a whole broken checkout is still readable in
# the digest's "Recent alerts" tail instead of drowning it.
reset_stubs; load
echo a > one.txt; echo b > two.txt
check_checkout_clean
is "$(grep -c 'pinned checkout is dirty' "$STATE_DIR/alerts.log")" 1 "multiple dirty files still produce a single alert line"
contains "$(cat "$STATE_DIR/alerts.log")" "one.txt" "the single alert line names every dirty file (1 of 2)"
contains "$(cat "$STATE_DIR/alerts.log")" "two.txt" "the single alert line names every dirty file (2 of 2)"

# check_checkout_clean is called once per cycle, and alert() already writes both the log and
# alerts.log, which digest_now already tails into "Recent alerts" — so a dirty checkout reaches
# the digest for free. Pin that wiring rather than trusting it stayed true.
reset_stubs; load
echo 42 > "$BIN/gh.digestissue"
echo "dirty for digest" > digest-dirty.txt
check_checkout_clean
digest_now "test" >/dev/null 2>&1
body=$(cat "$BIN/gh.lastbody" 2>/dev/null)
contains "$body" "pinned checkout is dirty" "a dirty checkout's alert reaches the daily digest"
contains "$body" "digest-dirty.txt" "the digest names the specific dirty file"

# ---------------------------------------------------------------------------------------------
section "run_cycle: the real scheduling path, not just the helper"
# ---------------------------------------------------------------------------------------------
# check_checkout_clean being correct in isolation (above) says nothing about whether the main loop
# still calls it. These cases drive run_cycle() itself — the exact function the while-loop below
# it calls once per iteration — so a call site dropped from run_cycle is a call site dropped from
# production, not from a copy of it re-implemented for the test.
reset_stubs; load
echo 0 > "$BIN/claude.rc"; echo 0 > "$BIN/kiro-cli.rc"
echo "dirty during a real cycle" > dirty-during-cycle.txt
run_cycle >/dev/null 2>&1
contains "$(cat "$STATE_DIR/alerts.log" 2>/dev/null)" "pinned checkout is dirty" \
  "run_cycle (the real per-iteration call) detects a dirty checkout"
contains "$(cat "$STATE_DIR/alerts.log" 2>/dev/null)" "dirty-during-cycle.txt" \
  "run_cycle's alert names the dirty file"

reset_stubs; load
echo 0 > "$BIN/claude.rc"; echo 0 > "$BIN/kiro-cli.rc"
run_cycle >/dev/null 2>&1
is "$(cat "$STATE_DIR/alerts.log" 2>/dev/null)" "" "run_cycle raises no dirty-checkout alert when the checkout is clean"

# The mutation the maintainer reproduced against the previous submission: delete only the
# check_checkout_clean call site from the real cycle body, leaving the standalone-call tests above
# green. Apply that exact mutation to a scratch copy of autopilot.sh and show run_cycle stops
# alerting — i.e. this suite goes red without the manual "did it turn red" step, because the
# assertion above already requires the call site to be present and wired.
reset_stubs; load
mutant="$WORKROOT/autopilot.no-callsite.sh"
sed '/# Catches the state that makes the \*next\* restart fail before it does: see check_checkout_clean\./{n;d}' \
  "$SRC" > "$mutant"
if grep -q '^  check_checkout_clean$' "$mutant"; then
  bad "sanity: the mutant actually removes the check_checkout_clean call site" \
    "call site still present in $mutant"
else
  ok "sanity: the mutant actually removes the check_checkout_clean call site"
fi
(
  cd "$PWD" || exit 1
  echo 0 > "$BIN/claude.rc"; echo 0 > "$BIN/kiro-cli.rc"
  echo "dirty under the mutant" > dirty-under-mutant.txt
  AUTOPILOT_LIB_ONLY=1 REPO=owner/repo STATE_DIR="$STATE_DIR" PAUSE_FILE="$PAUSE_FILE" \
    OPS_DIR="$OPS_DIR" MODE=auto bash -c '
      # shellcheck disable=SC1090
      source "'"$mutant"'"
      run_cycle
    ' >/dev/null 2>&1
)
lacks "$(cat "$STATE_DIR/alerts.log" 2>/dev/null)" "pinned checkout is dirty" \
  "removing the call site from the real cycle body (the maintainer's exact mutation) makes this suite go red: a dirty checkout is silently missed"

# ---------------------------------------------------------------------------------------------
section "paused: the file kill switch, and a real label pause, both still work"
# ---------------------------------------------------------------------------------------------
reset_stubs; load
if paused; then bad "an unpaused factory is not paused"; else ok "an unpaused factory is not paused"; fi
: > "$PAUSE_FILE"
if paused; then ok "the pause file pauses the factory"; else bad "the pause file pauses the factory"; fi
rm -f "$PAUSE_FILE"
echo 1 > "$BIN/gh.paused"
if paused; then ok "an agents:paused label pauses the factory"; else bad "an agents:paused label pauses the factory"; fi
echo 0 > "$BIN/gh.paused"
if paused; then bad "a genuine zero-length result is not paused"; else ok "a genuine zero-length result is not paused"; fi

# ---------------------------------------------------------------------------------------------
section "paused: a failed label query (#541 — an expired token misread as a pause)"
# ---------------------------------------------------------------------------------------------
# This is the actual regression: a real `gh` call failing (expired token, 401, rate limit, 5xx)
# prints nothing on stdout and exits non-zero. The old `[ "$(...)" != "0" ]` could not tell that
# apart from "the query really found zero issues" once its output was coerced to a string, and
# read the failure as "paused". A failed query must never be treated as a pause.
reset_stubs; load
echo 1 > "$BIN/gh.paused.rc"    # the query itself fails (like a 401), not "0 results"
if paused; then bad "a failed label query is not read as a pause"; else ok "a failed label query is not read as a pause"; fi
contains "$(cat "$LOG_DIR"/*.log 2>/dev/null)" "agents:paused label query failed" \
  "a failed label query logs a warning rather than failing silently"

# refresh_gh_token must actually be called from inside paused(), not just be cheap to call: a
# stub `gh` that fails until the token is refreshed proves paused() calling it is what recovers,
# not an unrelated refresh elsewhere in the same test process.
reset_stubs; load
unset AGENT_GH_TOKEN GH_TOKEN
cat >"$BIN/mint-for-paused" <<STUB
#!/usr/bin/env bash
echo "\$*" >> "$BIN/mint-for-paused.calls"
echo "token-that-fixes-the-401"
STUB
chmod +x "$BIN/mint-for-paused"
MINT_TOKEN_CMD="$BIN/mint-for-paused"
echo 1 > "$BIN/gh.paused.rc"
paused >/dev/null 2>&1
is "$([ -f "$BIN/mint-for-paused.calls" ] && echo called || echo not-called)" called \
  "paused() calls refresh_gh_token itself before giving up on the label query"

# The literal acceptance scenario in #541: a stub gh that returns 401 UNTIL the token is
# refreshed, then succeeds. paused() must not report a pause in that case.
reset_stubs; load
unset AGENT_GH_TOKEN GH_TOKEN
echo "the-fixed-token" > "$BIN/gh.paused.fail_until_token"
cat >"$BIN/mint-fixes-401" <<STUB
#!/usr/bin/env bash
echo "the-fixed-token"
STUB
chmod +x "$BIN/mint-fixes-401"
MINT_TOKEN_CMD="$BIN/mint-fixes-401"
echo 0 > "$BIN/gh.paused"
if paused; then bad "a 401-until-refreshed query is not read as a pause"; else ok "a 401-until-refreshed query is not read as a pause, once refresh_gh_token recovers it"; fi
is "$GH_TOKEN" "the-fixed-token" "paused()'s own refresh left GH_TOKEN holding the token that fixed the 401"

# ---------------------------------------------------------------------------------------------
section "wait_out_budget: a stuck-open gh 401 must not be read as a pause, and must not stop the shift"
# ---------------------------------------------------------------------------------------------
# The acceptance test named in #541: a stub gh that returns 401 until the token is refreshed.
# wait_out_budget must keep polling through that failure rather than returning 1 (which is what
# ends the shift and cost the ~4h23m of spurious restarts the issue describes).
reset_stubs; load
CREDIT_CEILING_DAY=10
add_credits 11 >/dev/null
echo 1 > "$BIN/gh.paused.rc"                      # every "is it paused" query 401s
END=$(( $(date +%s) + 2 ))                        # shift ends very soon so the loop returns quickly
( wait_out_budget >/dev/null 2>&1 ) ; rc=$?
is "$rc" 1 "the shift still ends when its own clock runs out, not because of the failed query"
lacks "$(cat "$STATE_DIR/alerts.log" 2>/dev/null)" "paused while over budget" \
  "a failed label query never appears as 'paused while over budget' — it is not conflated with a real pause"

# ---------------------------------------------------------------------------------------------
section "run_cycle: a failed label query does not end the shift (the #541 spurious stop)"
# ---------------------------------------------------------------------------------------------
# This is the exact failure mode from the issue: run_cycle's first line calls paused() before its
# own refresh at the top of the cycle. With the token already expired, the old code's paused()
# read the 401 as a real pause and run_cycle returned 1, stopping the whole shift.
reset_stubs; load
echo 0 > "$BIN/claude.rc"; echo 0 > "$BIN/kiro-cli.rc"
echo 1 > "$BIN/gh.paused.rc"
cycle=0; slot_n=0; broken_streak=0
MODE=auto
run_cycle >/dev/null 2>&1; rc=$?
is "$rc" 0 "run_cycle does not stop the shift just because the paused-label query failed"
lacks "$(cat "$STATE_DIR/alerts.log" 2>/dev/null)" "paused (agents:paused label" \
  "the cycle's own log does not claim a real pause happened"

# ---------------------------------------------------------------------------------------------
printf '\n%s\n' "-------------------------------------------"
printf '%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ] || exit 1

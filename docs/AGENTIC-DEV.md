# Agentic development

SnapURL is developed by a team of AI agents that triage issues, write code, test the
real stack on desktop and mobile, audit UX and security, review each other's PRs and
merge them. This page is the runbook.

## Where things run

| Piece | Runs on | Holds |
| --- | --- | --- |
| **Factory** — manager, developers, reviewer, cloud | One small always-on Linux host (EC2 in ap-south-1), built from `.devcontainer/`, autopilot as a service | GitHub token for this repo and the ops repo |
| **QA lab** — QA desktop/mobile, UX, security | `.github/workflows/qa-lab.yml` on GitHub-hosted runners (daily + on demand) | Kiro key and ops-repo token, in the `qa-lab` environment (only `main` may use it) |
| **Records** | Private repo `DhananjayThomble/snapurl-ops` | `qa-runs/<date>/<run>/` findings, summaries, transcripts; adjudication; Factory infrastructure and power workflows |
| **Evidence** | Private S3 bucket (ap-south-1), 30-day expiry | Screenshots, traces, videos |

This repository is public, and so are its Actions logs. The QA lab never prints session
output and never uploads workflow artifacts; everything goes to the ops repo or S3.

## The team

| Role | Prompt | Default engine | Does |
| --- | --- | --- | --- |
| Manager | `.kiro/prompts/manager.md` | Claude Code (Sonnet) | Triage, split epics, label `agent:ready`, keep the `Agent board` issue |
| Developer | `.kiro/prompts/developer.md` | Kiro CLI | One issue → worktree → PR with passing checks |
| QA (desktop / mobile) | `.kiro/prompts/qa.md` | Kiro CLI, in the QA lab | Real-stack Playwright runs; evidence only |
| UX / a11y | `.kiro/prompts/ux.md` | Kiro CLI, in the QA lab | axe, Lighthouse, screenshots, heuristic review |
| Security | `.kiro/prompts/security.md` | Kiro CLI, in the QA lab | semgrep, gitleaks, osv-scanner, trivy, ZAP, authz matrix |
| Cloud | `.kiro/prompts/cloud.md` | Kiro CLI | CDK synth, Helm, Docker, CI failures |
| Senior reviewer | `.kiro/prompts/reviewer.md` | Claude Code (Opus) | Verifies and approves/rejects PRs; reproduces QA findings and files issues |

Every role also reads `.kiro/prompts/_common.md` and `.kiro/steering/*.md`. The same prompts back
both `.kiro/agents/snapurl-*.json` and `.claude/agents/snapurl-*.md`, so either tool can play any role.

## Engines: Claude Code and Kiro, interchangeably

No role depends on one tool. "Default engine" above is only each role's preference in **auto** mode.

| Mode | Behaviour |
| --- | --- |
| `auto` (default) | Each role uses its preferred engine. An engine that hits a usage or credit limit cools down for `COOLDOWN_MIN` (60); its roles move to the other engine meanwhile, and the failed run is retried there once. |
| `claude` | Every role on Claude Code. If Claude is limited, nothing runs until it recovers. |
| `kiro` | Every role on Kiro CLI. If Kiro is out of credits, nothing runs until it recovers. |

Switching, re-read every cycle, first match wins:

1. **From a phone:** add the label `engine:claude` or `engine:kiro` to any open issue; remove it
   to go back. Both labels at once are ignored.
2. **On the Factory:** `factory-engine claude|kiro|auto|status` (writes `.agent-state/engine-mode`).
3. **Default:** the `ENGINE_MODE` environment variable (`auto`).

**Models and effort.** Two separate guarantees. First, the reviewer never runs the model that wrote
the code. Second, on Kiro it runs a *different vendor's* model, so its blind spots are not correlated
with the author's — Kiro's catalogue is multi-vendor, Claude Code's is not, so on Claude the best
available separation is Opus over Sonnet.

| | Reviewer | Every other role |
| --- | --- | --- |
| Kiro | `gpt-5.6-terra` (2.2×), `--effort max` | `claude-sonnet-5` (1.3×), `--effort xhigh` |
| Claude Code | `opus` | `sonnet` |

Override with `KIRO_MODEL_REVIEWER`, `KIRO_MODEL_DEFAULT`, `KIRO_EFFORT_REVIEWER`,
`KIRO_EFFORT_DEFAULT`, `CLAUDE_MODEL_REVIEWER`, `CLAUDE_MODEL_DEFAULT`. The autopilot logs a warning
at shift start if an override leaves the reviewer in the developer's vendor family. Effort raises the
credit cost of every run, which is what the day budget below is for.

**Shared context.** Both tools load the same rules (`CLAUDE.md` imports `.kiro/steering/`, which
Kiro reads natively) and the same role prompts. Durable memory lives in the private ops repo's
`memory/` folder: every agent reads it at the start of a run and records what it learns there
(`_common.md`), and the autopilot commits it after each role. On a person's machine, the ops repo's
`tools/link-shared-context.sh` points Claude Code's auto-memory and Kiro's steering at the same files.

## What the autopilot does when a run goes wrong

The maintainer is usually away, so the loop has to tell the difference between "try again later",
"try the other engine" and "stop, this needs a human". Every finished run is classified from its
exit code and the last `TAIL_LINES` (200) of its log — never the whole log, because agents print
issue bodies, API responses and the product's own UI. A real cycle was once aborted because a
*successful* UX audit logged SnapURL's own click-quota bar ("One quota, clicks only") and a 401
body from a sad-path test.

| Class | When | What happens |
| --- | --- | --- |
| `ok` | exit 0 | Counted as work. A quota phrase in the tail is noted and ignored — the run finished. |
| `limited` | non-zero exit **and** the tail matches a quota/auth pattern | The engine cools down for `COOLDOWN_MIN`; the run is retried once on the other engine. |
| `timeout` | exit 124 | Alerted, **never retried** — a retry costs another full `AGENT_TIMEOUT`. |
| `broken` | any other non-zero exit | Alerted, retried once on the other engine. No cooldown: a missing binary or a rejected `--model` is not a quota problem and waiting does not fix it. |

Two circuit breakers then protect an unattended box:

- **Broken streak.** After `BROKEN_CYCLES_MAX` (3) consecutive cycles in which something failed for
  a non-quota reason and *nothing* succeeded, the factory pauses itself. A throttled factory heals
  when its cooldown expires; a broken one does not, and grinding on is pure spend.
- **Day budget.** `CREDIT_CEILING_DAY` (2000) caps credits per UTC day, summed from the engines' own
  reported usage (Kiro prints `Credits: N` per run; Claude Code reports nothing, so only Kiro spend
  is counted). No new agent session starts once the ceiling is reached, so an overshoot costs one run
  at most, and the factory pauses. Counted per day rather than per shift so a crash-restart loop
  cannot reset the budget. Set it to `0` to disable — at which point nothing bounds a bad night.

Both pause via the same kill switch a human uses, so recovery is always the one documented action.

## Daily digest

The factory comments once per UTC day on a single issue labelled `factory:digest`, creating it on
first run. One comment a day is a phone notification and a permanent record; editing a body in place
would be neither. It carries the day's spend against the ceiling, the kill-switch state, what merged
in the last 24 hours, every open PR with its mergeability and labels, issues labelled `decision` or
`agent:blocked` that are waiting on a human, and any alerts raised since the last digest. Close the
issue to stop the digest.

## Tests

`scripts/agents/autopilot.test.sh` covers the decisions above against stub `claude`, `kiro-cli` and
`gh` commands — no network, no agent CLIs, no GitHub. It needs only bash, coreutils and awk, and runs
in CI as the **Autopilot tests** job whenever `scripts/agents/**` changes.

```bash
bash scripts/agents/autopilot.test.sh
```

## Board

GitHub labels are the state machine (created by `scripts/agents/bootstrap-labels.sh`):

```
(new issue) --manager--> agent:ready --developer--> agent:in-progress --> agent:pr-open
    --reviewer--> agent:approved --autopilot--> merged
               \-> agent:changes-requested --developer--> (back to review)
decision / agent:blocked  → agents skip it until a human acts
PR touching .github/workflows/ → needs-human (the maintainer merges it)
QA lab → snapurl-ops findings --reviewer reproduces--> issue [qa:agent-confirmed]
```

The autopilot merges an approved PR only when:

- the reviewer's `agent-approved-sha:` still describes the PR's change (a later merge of `main`
  keeps the approval; any new work voids it),
- the branch is up to date with `main` (it runs `gh pr update-branch` otherwise),
- the required `CI gate` check is green on the current head, and
- the PR does not change `.github/workflows/`.

GitHub's merge queue is not available on repositories owned by a personal account, which is why
the autopilot updates branches itself.

## Running it

On the Factory:

```bash
claude                 # sign in once (Claude subscription)
kiro-cli login         # or KIRO_API_KEY in the environment
bash scripts/agents/bootstrap-labels.sh   # once per repo
HOURS=4 bash scripts/agents/autopilot.sh  # or the systemd service; use tmux when running by hand
```

Knobs (environment variables): `HOURS`, `SLEEP_MIN`, `DEVS_PER_CYCLE`, `AGENT_TIMEOUT`,
`ENGINE_MODE`, `ENGINE_MANAGER|REVIEWER|DEVELOPER|QA` (preferred engine per role in auto mode),
`COOLDOWN_MIN`, `CLAUDE_MODEL_REVIEWER|DEFAULT`, `KIRO_MODEL_REVIEWER|DEFAULT`,
`KIRO_EFFORT_REVIEWER|DEFAULT`, `TAIL_LINES`, `BROKEN_CYCLES_MAX`, `CREDIT_CEILING_DAY`,
`DIGEST_LABEL`, `STATE_DIR`, `OPS_DIR`, `ROTATION` (space-separated `role[:focus]` list run one at a
time, default `cloud`) and `SLOT_EVERY` (run the next rotation role every N cycles, default 3).
QA, UX and security belong in the QA lab, so the Factory's rotation leaves them out.
Transcripts go to `.agent-logs/<date>/`.

On a long-lived host, point `STATE_DIR` outside the checkout (`/var/lib/snapurl`): it holds the
cooldowns and the day's credit total, and a `git clean` in the repo would otherwise reset the budget.

How a failed run is classified, and the two circuit breakers that can pause the factory on their
own, are described under [What the autopilot does when a run goes wrong](#what-the-autopilot-does-when-a-run-goes-wrong).

QA lab: Actions → **QA lab** → Run workflow. `charters` takes e.g. `qa:mobile,security`; the
repository variable `QA_LAB_CHARTERS` sets the scheduled default. Each session spends Kiro credits.
S3 upload turns on when the repository variables `QA_S3_ROLE_ARN` and `QA_S3_BUCKET` are set.

A single role can be run by hand:

```bash
claude -p "Run your triage pass now." --agent snapurl-manager
kiro-cli chat --no-interactive --trust-all-tools --agent snapurl-cloud "Run one cloud session now."
```

### Stopping it

- Add the `agents:paused` label to any open issue (works from the GitHub mobile app), or
- `sudo /opt/snapurl/bin/factory-pause --wait 900` on the Factory (or `touch $PAUSE_FILE`), or
- stop the Factory itself from the ops repo's power workflow.

## Safety model

Agents merge to `main` without a human. What stands in the way of a bad change:

1. `CI gate` is a required status check on `main` (ruleset `main-ci-cd`), with branches required
   to be up to date.
2. The reviewer reproduces the checks itself and pins the change it approved.
3. Workflow changes always wait for the maintainer, because workflows can reach secrets.
4. QA secrets live in an environment only `main` can use, and the QA lab never runs on pull requests.
5. Agents never hold AWS write credentials, never deploy, and test only local staging stacks.
6. `gitleaks` runs on every agent branch before push; raw QA output never enters this repo.
7. The kill switch above.

## Limits worth knowing

- **Claude subscription usage** resets on a rolling window and is **shared with your own interactive
  Claude sessions** (the agents use your subscription's token). When it runs out, auto mode moves
  Claude's roles to Kiro until it recovers.
- **Kiro credits** are spent by every developer and QA session; watch usage in the first week before
  raising `DEVS_PER_CYCLE` or adding QA charters.
- **GitHub-hosted runners** have 4 vCPU / 16 GB and a 6-hour job limit; QA sessions are capped at 60
  minutes each. Lighthouse numbers on shared runners are noisy — treat them as a trend.

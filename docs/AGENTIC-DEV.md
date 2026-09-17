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
The reviewer runs on a different engine from the authors so no model grades its own work.

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
`ENGINE_MANAGER|REVIEWER|DEVELOPER|QA` (`claude` or `kiro`), `CLAUDE_MODEL_REVIEWER`,
`CLAUDE_MODEL_DEFAULT`, `OPS_DIR`. Transcripts go to `.agent-logs/<date>/`.

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
- `touch .agents-paused` on the Factory, or
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

- **Claude subscription usage** resets on a rolling window; the autopilot skips the rest of a cycle
  when it sees a usage-limit error. Keep Claude for the manager and reviewer, and put volume on Kiro.
- **Kiro credits** are spent by every developer and QA session; watch usage in the first week before
  raising `DEVS_PER_CYCLE` or adding QA charters.
- **GitHub-hosted runners** have 4 vCPU / 16 GB and a 6-hour job limit; QA sessions are capped at 60
  minutes each. Lighthouse numbers on shared runners are noisy — treat them as a trend.

# SnapURL — agent instructions

The rules below are shared with Kiro and Copilot. They bind every session and every subagent.

@.github/copilot-instructions.md
@.kiro/steering/architecture.md
@.kiro/steering/security-and-context.md
@.kiro/steering/testing.md
@.kiro/steering/qa-oracles.md

## Autonomous operation

This repo is worked on by an autonomous agent team; see `docs/AGENTIC-DEV.md` for roles,
the label state machine and the autopilot loop. When running unattended:

- Before starting any work, check the kill switch: if an open issue carries the
  `agents:paused` label, stop and do nothing else.
- One issue → one branch → one git worktree → one PR. Branch names: `agent/<issue>-<slug>`.
  Never commit to `main`, never force-push, never rewrite someone else's branch.
- A PR body must include `Fixes #<n>` and the output of the four checks
  (`pnpm install --frozen-lockfile && pnpm type-check && pnpm build && pnpm test`).
- Anything in `.qa-runs/` is local evidence. Only redacted text reaches issues or PRs (steering §7).
- If blocked on a product or architecture choice, label the issue `decision`, explain the
  options in a comment, and move on to a different issue.

## Environment

- Node 22, pnpm via corepack. Dev Postgres 18 on `:5433` (`pnpm db:up`), staging stack via
  `pnpm staging:up` (api `:3001`, redirect `:3002`, Postgres `:5435`).
- Playwright browsers (chromium, firefox, webkit) are preinstalled. For mobile, use the
  `devices["iPhone 15"]` (webkit) and `devices["Pixel 7"]` (chromium) descriptors.
- Security CLIs on PATH: semgrep, gitleaks, trivy, osv-scanner, actionlint, hadolint; load tests: k6.
- MCP servers (`.mcp.json`): `playwright` for driving a browser, `chrome-devtools` for
  performance traces, console and network inspection.

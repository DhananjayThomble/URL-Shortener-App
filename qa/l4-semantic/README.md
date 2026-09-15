# L4 — semantic end-to-end (values, not renders)

QA layer L4: for a handful of analytics/conversion/QR checks, construct the
input so the correct answer is known **by construction** (not derived by
reading `apps/api` or `apps/worker`), drive it through the real staging stack,
and assert the observed value against that ground truth.

See `.kiro/steering/qa-oracles.md` (binding) and the brief this harness was
built from for the full rules. Short version: every check states its oracle,
findings are evidence not verdicts, and zero findings is a failed run.

## Why a standalone `npm` package, not a pnpm workspace member

This directory has its own `package.json` and is **not** listed in
`pnpm-workspace.yaml`. Two reasons:

- It needs `jsqr` + `pngjs` (a real QR decoder) and `postgres` (a raw SQL
  client), neither of which any app package depends on. Adding them to a
  workspace package's `package.json` would be a dependency change to
  production code for a QA-only need.
- It must not touch `pnpm-lock.yaml` or any workspace package's manifest —
  the brief is explicit that this layer "adds a new harness" and must not
  modify existing files.

`npm install` inside `qa/l4-semantic/` only touches this directory's own
`node_modules` and `package-lock.json`.

## Running it

Staging must already be up: API `:3001`, redirect `:3002`, Postgres `:5435`
(`postgres://snapurl:snapurl@localhost:5435/snapurl`). This harness does not
start or stop the stack.

```bash
cd qa/l4-semantic
npm install        # first run only
npm run run
```

Output: `.qa-runs/l4-semantic/findings.jsonl` (steering §3 format) and
`.qa-runs/l4-semantic/summary.md`, both gitignored. Raw artifacts (QR PNGs
decoded for C5, etc.) under `.qa-runs/l4-semantic/artifacts/`.

## What each check does

See `run.mts`'s header comment for the checks (C1-C7) and their oracles.

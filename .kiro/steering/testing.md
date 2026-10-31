# SnapURL — Testing & quality gates (steering)

## Before you claim a change works
- Run `pnpm type-check`, `pnpm build`, and the relevant package's `pnpm test`.
  If your change touches the DB or redirect path, that means Vitest **with
  Testcontainers** (real Postgres), not unit mocks.
- Never present a change as done on the strength of "it should work". State what
  you actually ran.

## What CI enforces (`.github/workflows/verify.yml`)
- `verify`: type-check → build → migrate → unit tests → smoke
  (`scripts/smoke.sh`, `scripts/smoke-redirect.sh` against live processes).
- `integration`: full `docker compose` stack + click-rollup assertions + a
  pino error-level log gate (an error-level log fails the job).
- `dynamo-smoke`: `LINK_PROJECTION=dynamo` against dynamodb-local.
- `restore-test`: real backup/restore round-trip.
Your PR must pass all of these. Do not weaken a gate to make a PR green —
fix the code.

## Lint (known-broken, being fixed)
- `web` currently declares `eslint .` with no config and no eslint dependency,
  so `pnpm lint` fails. Once lint is wired (eslint + prettier + commitlint,
  see the contributor-readiness work), treat a lint failure as a hard gate.
- Match existing formatting in the file you edit. Do not reformat unrelated
  lines in the same commit — it buries the real diff.

## Tests are part of the change
- New feature → tests for it in the same PR. A PR that adds behavior with no
  test is incomplete.

### R1 — every confirmed finding gets a regression test

This is the single authoritative statement of the regression-test rule. Every
role prompt and the PR template point here; do not restate the rule elsewhere.

A PR that closes an issue labelled `bug` **or** `qa:agent-confirmed` must:

1. add or change a test that **fails on the pre-fix code and passes on the
   fix**;
2. put that test in the **lowest lane that can observe the defect**, using the
   lane ladder below;
3. name the issue in the test — `#<n>` in the test title or a header comment;
4. paste the **red run** in the PR body: the new test run against `origin/main`
   (the unfixed code), showing it fail.

**A session never applies the `regression-test:n/a` label — only the maintainer
does.** That label is the only escape hatch from the rule, and it is checked
against repository-admin permission, so an agent applying it does not count.

#### Lane ladder (lowest first)

Pick the lowest lane in which the defect is observable.

| The defect is observable in… | Lane | Example |
|---|---|---|
| pure logic | Vitest unit in the owning package | `packages/domain` |
| a query, constraint or service | Vitest + `DATABASE_URL` integration | `apps/api/src/**/*.integration.test.ts` |
| the web API client or error mapping | `e2e/mocked-api/` | `credential-401.spec.ts` |
| rendering with fixture data | `e2e/tests/` | |
| a cross-service flow (redirect, worker, mail outbox) | `e2e/journeys/j<issue>-*.spec.ts` | `j771-sidebar-clicks-live` |

Ordering: unit < DB integration < mocked-api < fixtures e2e < real-stack journey.

#### Red-run evidence format (PR body)

Show the command and its failing output against `origin/main`, e.g.:

```
$ git stash && pnpm --filter @snapurl/domain test path/to/new.test.ts
  × rejects #<n> degenerate input  (test fails on unfixed code)
```

#### Issue filing carries the plan

Whoever files a `bug` / `qa:agent-confirmed` issue writes two lines in the issue
body:

- `Oracle:` — how you know the behaviour is wrong (expected vs. actual, the
  assertion that should hold).
- `Regression lane:` — the lane from the ladder above where the test should
  live.

## Logs
- Structured pino/nestjs-pino JSON only. No `console.log` in committed code.
  An error-level log in the integration path fails CI — log at the right level.

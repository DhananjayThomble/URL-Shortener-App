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
- New feature → tests for it in the same PR. Bug fix → a regression test that
  fails before the fix and passes after. A PR that adds behavior with no test is
  incomplete.

## Logs
- Structured pino/nestjs-pino JSON only. No `console.log` in committed code.
  An error-level log in the integration path fails CI — log at the right level.

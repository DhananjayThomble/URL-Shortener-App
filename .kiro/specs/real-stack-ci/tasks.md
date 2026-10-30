# Real-stack and browser suites in CI — tasks

Epic: #879. Staging lane = needs `pnpm staging:up`. **Only one session at a time may use
staging**: the compose project name is fixed, so two worktrees would fight over one stack.

| Task | Issue | Sprint | Lane | Depends on |
|---|---|---|---|---|
| A1 Journeys CI-ready: scripts, `psql` → `docker exec`, triage every spec | #883 | 1 | staging | — |
| A2 a11y suite throttle-safe | #884 | 1 | staging | — |
| A3 dom-xss self-seeding, never skips | #885 | 1 | staging | — |
| A4 CI: `real-stack` job (report-only) + WebKit in `e2e` | #886 | 1 | — (`needs-human`) | A1, A2, A3 |
| Promotion to required | #893 | 3 | — (`needs-human`) | 5 consecutive green `main` runs |

## A1
- [ ] `test:journeys` in `e2e/package.json`. Honour `QA_PREBUILT_WEB=1` (design §2).
- [ ] `THROTTLE_LIMIT: ${THROTTLE_LIMIT:-120}` on the `api` service in `docker-compose.staging.yml`
      (design §1 "Throttles"). Default unchanged. Do **not** use `.env.staging`.
- [ ] `j20-domain-picker-default`, `j26-default-domain-validation`, `j768-link-detail-scope`: host `psql` →
      `docker exec "${DB_CONTAINER:-snapurl-staging-postgres}" psql …` (the j15/j16/j23 pattern).
- [ ] Fix the stale config header ("12 journeys"). Replace the dangling `brief-journey.md` citation with the rules
      written into the `helpers.ts` header.
- [ ] Run every spec against a fresh `pnpm staging:up` built from the branch, in batches that fit the tool
      timeout. Record result, wall time and api/redirect error-log count per spec.
- [ ] Triage each failure per design §3. Real bug → issue + `test.fail(true, "#n: …")`. Harness → fix. Flake → fix or delete.
- [ ] PR body: the per-spec table and the proposed shard count `N`.

## A2
- [ ] One registered session per worker (worker-scoped fixture or `beforeAll` per describe) instead of per test.
- [ ] A bounded 429 back-off in `registerRealUser()` (`e2e/support/real-session.ts`), modelled on j790's loop.
- [ ] Honour `QA_PREBUILT_WEB=1`. Add `test:a11y`. Add the config and `a11y/**` to `e2e/tsconfig.json`.
- [ ] Green twice. File real violations as issues + `test.fail`.

## A3
- [ ] Seed the bio page with the payload over the API in `beforeAll`, so there is no `BIO_SLUG` precondition and the test never skips.
- [ ] Use the prebuilt `next start` rather than `next dev`, take the base URL from the config, add `forbidOnly`, remove the `console.log`.
- [ ] Prove red: on a throwaway branch render the bio field unsafely, show it fails, revert.
- [ ] `test:dom-xss`.

## A4
- [ ] `real-stack` job per design §2. Legs `j1..jN` + `aux` (a11y, dom-xss). **Not** in `ci-gate` yet.
- [ ] WebKit in the existing `e2e` job, plus `test:webkit` and the `e2e/tsconfig.json` entries. This becomes required immediately, through `e2e`.
- [ ] One green `real-stack` run on the PR. `actionlint` green.

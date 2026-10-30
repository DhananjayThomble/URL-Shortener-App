# Real-stack and browser suites in CI — design

## 1. What each suite needs (verified)

| Suite | Config | Backend | Web server | Tests | Browser | Blockers for CI |
|---|---|---|---|---|---|---|
| journeys | `e2e/playwright.journeys.config.ts` | staging (api 3001, redirect 3002, pg 5435) + `docker exec` | `next start` only, so it **requires a prior `next build`** (lines 63-79) | 62 files / 148 tests, `workers: 1` | chromium | host `psql` in 3 specs; runtime unmeasured |
| a11y | `e2e/playwright.a11y.config.ts` | staging api | `next build && next start` (43-53) | 2 files, ~104 generated tests, `workers: 3` | chromium | **registers one account per test**, against a 5/min register throttle |
| dom-xss | `e2e/adversarial/playwright.dom-xss.config.ts` | staging api | **`next dev`** (46-52) | 1 test | chromium | `test.skip(!BIO_SLUG)`, a seeding script that is not in the repo, `console.log`, no `forbidOnly` |
| webkit | `e2e/playwright.webkit.config.ts` | none (`page.route` mocks) | `next build && next start`, port **3100** | 1 file / 2 tests | **webkit** | needs `playwright install webkit`; not in `e2e/tsconfig.json` |

### Facts that shape the design

- **Outbox and DB access go through `docker exec`.** j15, j17 and j24 read invite/verify links
  with `docker exec snapurl-staging-api-1 … /tmp/snapurl-outbox`. j15, j16 and j23 write through
  `docker exec snapurl-staging-postgres psql`. The container names come from the compose project
  name `snapurl-staging`, overridable with `QA_API_CONTAINER` / `DB_CONTAINER`. A GitHub runner
  has the docker CLI.
- **Three journeys need a host `psql` binary** (`execFileSync("psql", …)`): `j20-domain-picker-default`,
  `j26-default-domain-validation`, `j768-link-detail-scope`. No workflow installs
  `postgresql-client`. Switching them to the `docker exec … psql` pattern the others already use
  removes the prerequisite instead of adding an apt step.
- **Throttles.** The global limit is 120/60 s (`THROTTLE_LIMIT` is absent from the compose file).
  Route-level `@Throttle` limits of **5/min per IP** cover `/auth/register`, `/auth/login`,
  `/auth/2fa/verify`, password reset, email resend and link unlock. The env var **does not**
  lift those. The journeys budget sign-ins around the route-level limits by hand. j790 already has
  a 429 back-off loop (`j790-dead-ends.spec.ts:17-28`).
  - To raise only the global bucket, add `THROTTLE_LIMIT: ${THROTTLE_LIMIT:-120}` to the `api`
    service's `environment:` in `docker-compose.staging.yml`. The default is unchanged, and both CI
    and local runs use `THROTTLE_LIMIT=100000 pnpm staging:up`. This is deliberately **not** done
    through `.env.staging`, because the local agent permission policy
    (`~/.kiro/settings/permissions.yaml`) denies file tools on `**/.env.*`. An agent could not
    create the file. The route-level limits stay, which is correct: they are security behaviour.
- **The a11y throttle collision.** `color-contrast-audit.spec.ts:103-106` and `label-audit.spec.ts`
  call `seedSession(page)` in `beforeEach`. Under `installRealSession()` that is
  `registerRealUser()`, a fresh `POST /auth/register` **per test**, with no 429 handling
  (`e2e/support/real-session.ts:107-155`). The register throttle landed on 2026-10-17 in
  `fa1b9d5` (#658). The a11y suite was last touched on 2026-10-08. So the suite almost certainly
  fails after its 5th test against current `main`.
- **Timing.** j05 waits up to 30 s for the worker's rollup loop. The compose worker runs the real
  timer loop (`docker-compose.staging.yml:206-215`), so this works in CI as it does locally.
- **Ports.** Journeys, a11y and dom-xss default to 3000. WebKit defaults to 3100, which is the port
  the visual lane (#866) also picked. They run in different jobs, so there is no conflict in CI.
  Locally, do not run both at once.
- **Stale docs.** The journeys config header says "12 full user-journey E2E specs" (line 5). There
  are 62. `brief-journey.md`, cited by `helpers.ts:3` and the config header as the rule source,
  does not exist anywhere in the repo.
- **Type-check gap.** `e2e/tsconfig.json:13-24` omits `playwright.a11y.config.ts`,
  `playwright.webkit.config.ts`, `a11y/**` and `webkit/**`.

## 2. Job shape

```yaml
  real-stack:
    name: Real-stack (${{ matrix.leg }})
    needs: changes
    if: needs.changes.outputs.code == 'true'
    runs-on: ubuntu-latest
    timeout-minutes: 30            # measured runtime decides; see R9
    strategy:
      fail-fast: false
      matrix:
        leg: [j1, j2, j3, aux]     # jK = journeys shard K/N, N from the A1 timing table
    steps:
      - checkout · pnpm/action-setup · setup-node 22 · pnpm install --frozen-lockfile
      - THROTTLE_LIMIT=100000 pnpm staging:up   # --build --wait; auto-migrates; see "Throttles"
      - pnpm build:packages
      - next build (NEXT_PUBLIC_USE_FIXTURES=false, NEXT_PUBLIC_API_URL=http://localhost:3001/api/v1,
                    SNAPURL_ALLOW_UNCONFIGURED_BUILD=true)    # same as qa-lab.yml:131-137
      - Playwright chromium (cache keyed on resolved version, as the e2e job does)
      - if leg == jK:  QA_PREBUILT_WEB=1 pnpm --filter snapurl-e2e test:journeys -- --shard=K/N
      - if leg == aux: QA_PREBUILT_WEB=1 test:a11y, then test:dom-xss
                       (+ from C7: STACK_API_URL=… pnpm --filter @snapurl/api test:stack)
      - Fail on api/redirect "level":50 lines   # copy of verify.yml:286-301
      - if: failure()  →  docker compose -f docker-compose.staging.yml logs --no-color
      - if: failure()  →  upload .qa-runs/**/artifacts, retention-days: 7
      - if: always()   →  pnpm staging:down
```

Every leg is its own runner with its own stack and its own IP, so the route-level 5/min throttle
buckets never collide across legs.

### The prebuilt-server switch

The journeys config already assumes a prior build and runs `next start` only. a11y and dom-xss
should do the same in CI instead of building a second time (a11y) or running `next dev` (dom-xss,
slow first-hit compile and not production behaviour). Add one shared env switch,
`QA_PREBUILT_WEB=1`, honoured by all three configs: when set, `webServer.command` is `next start`
only. Default behaviour without the switch stays unchanged for local use.

### WebKit

Add three steps to the existing `e2e` job after the mocked-api lane: install webkit (with deps),
run `test:webkit`, and add its report path to the existing upload step. Port 3100 is free there.
Because `e2e` is already in `ci-gate`'s `needs`, WebKit becomes required in the same PR. That is
acceptable for 2 deterministic mocked tests that A4 proves green twice before landing.

## 3. Triage protocol (A1)

Run every journey locally against a fresh `pnpm staging:up` built from the branch. For each spec,
record its result, wall time, and count of api/redirect error-level log lines into a table in the PR
body. Then classify each failure:

| Cause | Action |
|---|---|
| Harness wrong about the environment (scheme, ports, container names, stale selector the product intentionally changed) | Fix the spec. Cite the product change that moved it. |
| Real product bug | Search for an open issue. If there is none, file one with repro + oracle. Annotate `test.fail(true, "#<n>: …")`. |
| Flaky (passes and fails on identical code) | Fix the race, or delete the test and say so. Never annotate a flake. |
| Needs something CI cannot provide | Make it provide it (the `psql` → `docker exec` switch), or move the check to a lane that can. |

The timing table decides `N` for sharding: `N = ceil(total_minutes / 15)`, which leaves room for
the ~8 min stack and build overhead inside the 25-min budget.

## 4. Risks

| Risk | Mitigation |
|---|---|
| Per-shard image build cost (3 images × N shards) | Measure first. If it dominates, a later change can build once and pass images between jobs. Not in scope until measured. |
| One flaky journey blocks every PR once required | R8 phased promotion: 5 green `main` runs first. |
| Concurrent `staging:up` from two local agent sessions | The compose project name is fixed (`snapurl-staging`), so two worktrees fight over one stack. **Only one session at a time may use staging.** |
| dom-xss PoC visible in a public CI log | Payload is already in the public spec. A red run on `main` goes to the private advisory channel (R11). |

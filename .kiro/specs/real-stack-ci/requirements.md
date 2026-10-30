# Real-stack and browser suites in CI — requirements

Status: proposed. Covers four existing Playwright suites that **no workflow runs today**:
`e2e/journeys/` (real stack), `e2e/a11y/` (real stack), `e2e/adversarial/dom-xss.spec.ts`
(real stack, security) and `e2e/webkit/` (mocked API, WebKit). Verified against `main` @ `3df871e`.

## 1. Why

CI's `e2e` job (`.github/workflows/verify.yml:809-877`) runs only the fixtures lane and the
mocked-api lane. Neither can see a backend, contract or redirect bug (`.kiro/steering/qa-oracles.md`
§5). The real-stack journeys are the strongest suite in the repo: 62 spec files, 148 tests, and
from `j13` on every one was written as the regression test for a specific issue (from `j752` on,
the file name *is* the issue number). Today they only run when someone remembers to run them by
hand, so a fixed bug can quietly come back.

## 2. Functional requirements

- **R1** The journeys run against a freshly built staging stack on every PR where
  `needs.changes.outputs.code == 'true'`, and on every push to `main` and the nightly schedule.
- **R2** The a11y suite and the dom-xss suite run in the same real-stack job, reusing the same
  stack and the same production web build.
- **R3** The WebKit suite runs on every PR in the existing `e2e` job (no stack needed).
- **R4** `retries: 0` stays. A real-stack failure is a finding, not noise to be retried away
  (`playwright.journeys.config.ts:37`).
- **R5** A journey that fails because of a **known, open product bug** is annotated
  `test.fail(true, "#<issue>: <one line>")`. It then stays green while the bug exists and goes
  **red when the bug is fixed**, which forces whoever fixed it to remove the annotation. A journey that
  fails because of the **harness** is fixed, not annotated. A journey that is **flaky** is fixed
  or deleted. Flaky tests are never annotated.
- **R6** Every suite stays runnable locally with one documented command against `pnpm staging:up`.
- **R7** The real-stack job also enforces the pino error-level gate that the `integration` job
  already uses (`verify.yml:286-301`), scoped to `api` and `redirect`. A journey that makes the
  API log at error level found a 500, so the gate should catch it.
- **R8** **Phased gating.** The real-stack job lands *not* in `ci-gate`'s `needs`. It is promoted
  to required only after **5 consecutive green runs on `main`** (push or nightly). WebKit joins
  the existing required `e2e` job immediately, because it has 2 deterministic mocked tests.

## 3. Non-functional requirements

- **R9 Wall time.** ≤ 25 min per job, including the image build and `next build`. If the
  measured serial runtime is over budget, shard the journeys with `--shard=i/N`. Each shard is its
  own runner with its own stack and its own IP, so the per-IP throttle buckets do not collide.
- **R10 Secrets.** The job uses only the throwaway defaults baked into
  `docker-compose.staging.yml:137-138`. No repository secret is referenced. Traces and videos
  recorded on failure contain JWTs signed with those public defaults for a stack that is destroyed
  when the job ends, so they grant nothing. Upload them on failure only, `retention-days: 7`.
- **R11 Disclosure.** A red dom-xss run on `main` means a stored-XSS regression shipped. Handle it
  as a security incident through the private channel in `SECURITY.md`, not as a public issue
  (`qa-oracles.md` §8). A red run on a PR caught the regression before it shipped, which is the
  point of the suite.
- **R12 No new dependency.** Everything needed (`@playwright/test`, `@axe-core/playwright`, `jsqr`)
  is already in `e2e/package.json`.

## 4. Out of scope

- Writing new journeys. This workstream wires up the ones that exist.
- The fixtures-mode `playwright.real.config.ts` re-run.
- Firefox.

## 5. Acceptance criteria

1. Locally, `pnpm --filter snapurl-e2e test:journeys`, `test:a11y`, `test:dom-xss` and
   `test:webkit` each run end to end against `pnpm staging:up`, with no hand-started server.
2. Every journey either passes or carries a `test.fail` annotation that links an open issue.
3. The real-stack job runs on PRs, uploads a report on failure, and tears the stack down on every
   path.
4. After 5 consecutive green `main` runs, the job is in `ci-gate`'s `needs`.

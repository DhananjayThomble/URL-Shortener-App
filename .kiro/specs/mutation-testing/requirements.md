# Prove the tests can fail — requirements

Status: proposed. Two parts: **Stryker** mutation testing on `packages/domain` and
`packages/contract`, and one **whole-suite bug-injection gate** per `.kiro/steering/qa-oracles.md` §4.

## 1. Why

Coverage says a line ran, not that a test would notice it breaking. There are no numeric coverage
thresholds anywhere. `scripts/coverage-delta.mjs` only fails test-only PRs that cover nothing
new. The repo already does mutation testing by hand (the #430 bug-injection note in
`slug.generate.property.test.ts`, "#445 mutation-proof" in `e2e/tests/login-form.spec.ts:122-124`,
the mutant sanity checks in `scripts/agents/autopilot.test.sh`). Stryker makes it systematic for the two
packages where it is cheap. Both are pure, use no DB or network, and total ~3.5k source LOC.

## 2. Stryker requirements

- **S1** `@stryker-mutator/core` + `@stryker-mutator/vitest-runner`, same major (10.x; 10.1.1 is
  current with peer `vitest >=2.0.0`, and the repo has vitest 3.2.7), as devDependencies of each
  package only. Add an ADR entry because `architecture.md` requires one for any new external
  dependency. The repo has no dev-only ADR precedent, so this one sets it. Mind pnpm's
  release-age policy (`pnpm-workspace.yaml` carries `minimumReleaseAgeExclude`).
- **S2** Mutate `src/**/*.ts`, excluding tests and **`packages/domain/src/routing.reference.ts`**, which is
  the naive oracle for the differential test. Mutating the oracle measures nothing.
- **S3** Measure first, then set `thresholds.break` from the measured score, **rounded down to the
  nearest 5**. The threshold only ever ratchets up. Never lower it to make a PR green.
- **S4 Survivors.** Each surviving mutant is either killed by a new test or marked equivalent with an
  inline `// Stryker disable next-line <mutator>: <reason>`. File- or block-wide disables are banned.
- **S5** Error-message string literals in `packages/contract` will survive in bulk. Decide from the
  measured report whether to assert them (some are product copy, see #792) or exclude
  `StringLiteral` for that package. Write the decision in the config comment.
- **S6 CI.** Run on PRs that touch `packages/domain/**` or `packages/contract/**` (path filter), and
  nightly on `main`. Upload the HTML report. Budget ≤ 15 min per package.

## 3. Whole-suite bug-injection gate requirements

- **G1** Runs **once**, after every new suite is wired into CI (Sprint 4), on a throwaway branch. Nothing
  from it is merged.
- **G2** For each injection: inject, run the **full** CI-equivalent locally (unit, integration,
  fixtures e2e, mocked-api, real-stack, api-stack, visual, Stryker), record which suite went red, revert.
- **G3** Report a table with injection, expected catcher, actual catcher(s), and verdict. Every
  injection nothing caught becomes either a new test issue or a documented gap. A gate with
  silent passes is a failed gate.

## 4. The catalogue (qa-oracles §4, plus one per new suite)

| # | Injection | Where | Expected catcher |
|---|---|---|---|
| 1 | off-by-one in the click rollup | `apps/worker/src/jobs/` | worker tests, `integration` rollup assertion, j05 |
| 2 | flip a comparison in routing evaluation | `packages/domain/src/routing.ts` | differential test, Stryker |
| 3 | drop the workspace filter on one `GET /:id` query | e.g. `links.service.ts` `getFrom` | access matrix (ownerB → 404) |
| 4 | break the UTM merge | `apps/redirect` | redirect tests, smoke-redirect |
| 5 | widen a zod schema | e.g. drop `.max(2048)` on `HttpUrl` | contract property tests, Stryker. **Not** the fuzzer (by construction, see `api-stack-tests` §5) |
| 6 | remove one `@Roles("admin")` | `domains.controller.ts` | access matrix (editorA → 403) |
| 7 | remove one `ParseUUIDPipe` | `links.controller.ts` | fuzzer (5xx) |
| 8 | drop `@Public()` from a public route | `public.controller.ts` | access matrix (anon) |
| 9 | render a bio field as raw HTML | `web/` bio renderer | dom-xss |
| 10 | remove an `aria-label` the label audit checks | `web/` | a11y |
| 11 | shift the QR quiet zone | `web/src/lib/qr-compose.ts` | j03 / j773, visual |
| 12 | a spacing-token change | `web/src/app/globals.css` | visual (see #872 for the visual-only set) |

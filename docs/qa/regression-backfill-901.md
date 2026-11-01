# Regression-test backfill — #901 (spec `regression-rule` R5, design §4)

Spot-check that 10 existing regression tests actually **fail on the pre-fix code**
(red-on-parent) and pass on current `main`. A test green on its fix's parent would be
a fake regression test. **Result: all 10 have teeth; 0 fakes, so no fake-test issue
was filed.**

## Method (design §4)

For each fix commit `C`: create a detached worktree at `C^` (the fix's parent), copy in
**only the test files the fix added** (the `.spec`/`.test` plus any test-support file it
introduced — e.g. `e2e/support/row-actions.ts`), build, and run just those tests there.
A failure proves the test guards the fix. The fix's own test files are never modified on
`main` — they are copied from `C` onto the parent tree in a throwaway worktree that is
removed afterwards. Journeys run against `pnpm staging:up`; the three web-only journeys
reuse the current-`main` API with web rebuilt from the parent, and the one journey whose
fix touches the API (#792) was run against a staging stack rebuilt from the parent.

Reproduce any row with `scripts/qa/red-on-parent.sh` (see that script's header).

## Results

| # | Issue | Fix commit | Parent | Lane | Cohort | Test file(s) | Red on parent | Notes |
|---|-------|-----------|--------|------|--------|--------------|:-:|-------|
| 1 | #665 | `9102593` | `c183569` | unit (contract) | qa:agent-confirmed | `packages/contract/src/auth.test.ts` | **y** (3 failed / 2 passed) | pre-fix `RegisterInput.name` not trimmed before length check |
| 2 | #667 | `fd9dae6` | `30c6262` | unit (domain) | qa:agent-confirmed | `packages/domain/src/destination.test.ts` | **y** (1 failed / 46 passed) | pre-fix accepts `.`/`..` slugs collapsed by URL normalisation |
| 3 | #662 | `75c575d` | `825526f` | unit (api) | qa:agent-confirmed | `apps/api/src/analytics/analytics.service.test.ts` | **y** (2 failed / 30 passed) | pre-fix `percentChange` returns +100%/∞ instead of null on a zero baseline |
| 4 | #786 | `f3c1a56` | `51d1605` | mocked-api | — | `e2e/mocked-api/table-row-actions.spec.ts` (+ `e2e/support/row-actions.ts`) | **y** (14 failed / 1 passed) | pre-fix row actions hide in horizontal scroll |
| 5 | #832 | `432720f` | `792238f` | mocked-api | — | `e2e/mocked-api/table-row-actions-more.spec.ts` | **y** (18 failed / 6 passed) | Forms/Bio/Reports tables, same defect |
| 6 | #859 | `3df871e` | `71e8d88` | mocked-api | — | `e2e/mocked-api/team-row-actions.spec.ts` | **y** (26 failed / 14 passed) | Team row actions unreachable on narrow screens |
| 7 | #851 | `57cc416` | `5e2049b` | journey | j7NN | `e2e/journeys/j849-bio-encoded-domain.spec.ts` | **y** (4 failed) | pre-fix double-decodes `/b` + `/f` segments → encoded domain 404s |
| 8 | #787 (#835) | `57f849a` | `b6988c1` | journey | j7NN | `e2e/journeys/j787-links-grid-layout.spec.ts` | **y** (2 failed) | pre-fix grid lacks the one-line-slug layout the test locates |
| 9 | #789 (#846) | `76acc6f` | `0967d2d` | journey | j7NN | `e2e/journeys/j789-empty-states.spec.ts` | **y** (2 failed) | pre-fix has no "Create your first bio page" empty state |
| 10 | #792 | `e3614b8` | `5bc959a` | journey | j7NN | `e2e/journeys/j792-validation-copy.spec.ts` | **y** (10 failed) | pre-fix **API** returns raw zod/field-prefixed messages, not human copy |

Lane split: 3 unit/integration, 3 mocked-api, 4 journeys. Cohorts covered: three from
`qa:agent-confirmed` (#469-#669: #665, #667, #662) and four from the j7NN cohort
(#752-#859: #851, #787/#835, #789/#846, #792). ≥1 from each cohort as required.

## Green on current `main`

Each test passes on current `main` (`1178e3e`): contract 29, domain 80, analytics 40;
the three row-action mocked-api specs 80 together; the four journeys 18 together.

## No fakes

Every one of the 10 is red on its parent, so none is a fake regression test and no
test-only issue was filed (design §4's "file one issue per green-on-parent case" did not
trigger).

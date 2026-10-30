# Every confirmed finding gets a regression test — requirements

Status: proposed.

## 1. What exists today

- The rule is written: `.kiro/steering/testing.md:27-30` ("Bug fix → a regression test that fails
  before the fix and passes after"), `developer.md:51-52`, and `reviewer.md:21` ("would the test
  fail if the fix were reverted? try it").
- **Nothing enforces it.** The PR template has no test field. Agent PRs skip the template anyway,
  because `gh pr create --body` bypasses it. No CI job checks it. `autopilot.sh merge_approved`
  checks only the approval SHA, `CI gate` and workflow paths.
- **It mostly happens anyway.** Of 57 closed `qa:agent-confirmed` issues with a linked merged PR, 43
  (75%) shipped a test file. All 14 without one were dependency bumps, CI pinning, image hardening
  or smoke-script-only fixes. `[bug]`-titled issues were 27/28. (Census of all 69 closed issues,
  2026-10-30.)
- **The label misses a cohort.** The QA-derived issues from #706 onward (#752-#859) carry `bug` /
  `UI/UX` but not `qa:agent-confirmed`. Their regression tests mostly exist as `e2e/journeys/j7NN-*`.

So the gap is enforcement and proof, not habit.

## 2. Requirements

- **R1 The rule, sharpened.** A PR that closes an issue labelled `bug` **or** `qa:agent-confirmed`
  must:
  1. add or change a test that fails on the pre-fix code and passes on the fix;
  2. put that test in the **lowest lane that can observe the defect**: unit < DB integration <
     mocked-api < fixtures e2e < real-stack journey;
  3. name the issue in the test (title or header comment, `#<n>`);
  4. show the red run in the PR body (the new test run against `origin/main`).
- **R2 Issue filing carries the plan.** When the reviewer files a confirmed finding, the body names
  the oracle **and** a suggested regression lane. When the manager adds acceptance criteria, one item
  is always the regression test.
- **R3 CI guard.** A job fails a PR that closes a `bug`/`qa:agent-confirmed` issue without touching a
  test file. The test-file pattern is wider than `coverage-delta`'s (it must include `.spec.ts`,
  `.test.tsx`, `e2e/**` and `scripts/*.test.sh`).
- **R4 Escape hatch.** The label `regression-test:n/a` on the issue skips the guard **only if a
  repository admin applied it**, checked through the issue events API. This covers dependency bumps
  and CI pinning. An agent applying the label does not count.
- **R5 Backfill.** Spot-check that the existing regression tests actually fail when the fix is reverted,
  for a sample of 10 fixes across lanes. Close any real gaps with test-only issues.

## 3. Out of scope

- Proving red-before-green mechanically in CI. Checking out the base, applying only the test files
  and expecting red is possible, but fragile across lanes and slow for journeys. R1.4 makes it
  the author's evidence and the reviewer's check instead.

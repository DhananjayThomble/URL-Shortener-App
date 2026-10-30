# Every confirmed finding gets a regression test — design

## 1. Where the rule text lives (one canonical place, short pointers elsewhere)

| File | Change |
|---|---|
| `.kiro/steering/testing.md` | Canonical R1 text, the lane ladder, and the red-run evidence format. Loaded by Kiro natively and by Claude via `CLAUDE.md`'s import. |
| `.kiro/prompts/developer.md` step 4/8 | One line: follow `testing.md` R1, and the PR body includes the red run. |
| `.kiro/prompts/reviewer.md` §A.3 and §B.2 | §A.3: verify the red run, or reproduce it. §B.2: the filed issue body includes `Oracle:` and `Regression lane:` lines. |
| `.kiro/prompts/manager.md` step 2 | Acceptance criteria always include the regression-test item. |
| `.github/PULL_REQUEST_TEMPLATE.md` | Add a "Regression test" section. Also fix the inverted checklist ("I haven't read…"), which is a separate bug, so keep it a separate commit. |

`.claude/agents/*.md` and `.kiro/agents/*.json` reference the prompts by path and need no edits.

### Lane ladder (for `testing.md`)

| The defect is observable in… | Lane | Example |
|---|---|---|
| pure logic | Vitest unit in the owning package | `packages/domain` |
| a query, constraint or service | Vitest + `DATABASE_URL` integration | `apps/api/src/**/*.integration.test.ts` |
| the web API client or error mapping | `e2e/mocked-api/` | `credential-401.spec.ts` |
| rendering with fixture data | `e2e/tests/` | |
| a cross-service flow (redirect, worker, mail outbox) | `e2e/journeys/j<issue>-*.spec.ts` | `j771-sidebar-clicks-live` |

## 2. The guard

`scripts/regression-test-guard.mjs`, modelled on `scripts/coverage-delta.mjs`. It uses
`execFileSync` with no shell (that script's injection rationale), prints a `PASS`/`FAIL` line,
and exits non-zero on failure.

1. Read the PR number and repo from env (`GITHUB_REPOSITORY`, `PR_NUMBER`).
2. GraphQL `closingIssuesReferences(first: 20) { nodes { number labels(first: 30) { nodes { name } } } }`.
3. If no closing issue carries `bug` or `qa:agent-confirmed`, PASS.
4. For each such issue carrying `regression-test:n/a`, read `GET /repos/{r}/issues/{n}/events`. Find
   the latest `labeled` event for that label and check its actor with
   `GET /repos/{r}/collaborators/{login}/permission`. If the permission is `admin`, that issue is exempt.
5. Get changed files with `git diff --name-only origin/main...HEAD`. PASS if any of them matches
   `/\.(test|spec)\.(ts|tsx|mjs|js)$|\.test\.sh$|^e2e\/.+\.ts$/`.
6. Otherwise FAIL, naming the issues and how to satisfy the rule.

Unit tests: `scripts/regression-test-guard.test.mjs` with the GitHub calls injected (pure functions
for steps 3-6), run by `node --test`. Add `"test:scripts"` at the root, and include it in
`pnpm test` only if that does not slow the default loop noticeably.

## 3. CI job

```yaml
  regression-guard:
    if: github.event_name == 'pull_request'
    needs: changes
    runs-on: ubuntu-latest
    timeout-minutes: 5
    permissions: { contents: read, pull-requests: read, issues: read }
    steps: checkout (fetch-depth 0) · fetch origin/main · node 22
           · node scripts/regression-test-guard.mjs   (env GH_TOKEN: ${{ github.token }}, PR_NUMBER)
```

Add it to `ci-gate`'s `needs`. A skipped run on push and schedule is fine, because the gate treats
`skipped` as passing.

## 4. Backfill sample (R5)

Pick 10 fixes: 3 unit/integration, 3 mocked-api, 4 journeys. Include one each from the
`qa:agent-confirmed` cohort (#469-#669) and the j7NN cohort. For each one, check out the fix
commit's parent, copy in only the test files from the fix, run them, and expect red. Post a
table with issue, lane, red-on-parent (y/n) and notes. A test that is green on the parent is a
fake regression test. File one test-only issue per such case.

# Prove the tests can fail — design

## 1. Stryker configuration (per package)

```jsonc
// packages/domain/stryker.config.json
{
  "$schema": "../../node_modules/@stryker-mutator/core/schema/stryker-schema.json",
  "testRunner": "vitest",
  "vitest": { "configFile": "vitest.config.ts" },
  "mutate": ["src/**/*.ts", "!src/**/*.test.ts", "!src/routing.reference.ts"],
  "coverageAnalysis": "perTest",
  "reporters": ["clear-text", "progress", "html", "json"],
  "htmlReporter": { "fileName": "reports/mutation/index.html" },
  "thresholds": { "high": 90, "low": 75, "break": null },   // break set from the measured score
  "incremental": false,
  "tempDirName": ".stryker-tmp"
}
```

- Both packages import `./x.js` specifiers from `src` directly and have no `resolve` alias. Domain's
  `@snapurl/contract` imports are type-only (erased), **except possibly `visitor.ts`**, which the
  investigation could not confirm. If that import is at runtime it resolves to `contract/dist`, so
  run `pnpm build:packages` before Stryker in CI.
- Add `reports/` and `.stryker-tmp/` to each package's ignore rules, and to `tsconfig` excludes if
  `tsc` picks them up.
- Script: `"test:mutation": "stryker run"` in each package. A root `"test:mutation"` runs both.

## 2. Triage workflow

1. Run, then read `reports/mutation/mutation.json`.
2. Group survivors by file and mutator. For each group, write the test that kills them, or mark
   genuinely equivalent mutants inline with a reason.
3. Set `break` to `floor(score / 5) * 5`.
4. In the PR body, paste the before/after score and the list of equivalents with reasons.

## 3. CI job (one job, two packages)

```yaml
  mutation:
    needs: changes
    if: needs.changes.outputs.mutation == 'true'   # new filter: packages/domain/**, packages/contract/**
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps: checkout · pnpm · node 22 · install · build:packages
           · pnpm --filter @snapurl/domain test:mutation
           · pnpm --filter @snapurl/contract test:mutation
           · upload reports (if: !cancelled(), retention 7)
```

Add a `mutation` output to the `changes` job's paths-filter. Force it to `true` on non-PR events,
the same way `code` and `workflows` already are (`verify.yml:63-69`), so the nightly schedule
always runs it. Add the job to `ci-gate`'s `needs`.

## 4. Bug-injection gate procedure

```
git worktree add --detach ../wt-injection origin/main    # detached: no branch to create, push or delete
for each catalogue row:
  apply the one-line injection
  run: pnpm type-check && pnpm test                                   (unit + DB integration)
       pnpm --filter snapurl-e2e test:e2e && test:e2e:mocked-api
       pnpm staging:up (rebuilt from the worktree) → test:journeys, test:a11y, test:dom-xss,
                                                      @snapurl/api test:stack
       visual lane (container) when the injection is in web/
       test:mutation when the injection is in domain/contract
  record red suites; git checkout -- . ; next
git worktree remove --force ../wt-injection
```

A detached worktree means there is no throwaway branch to clean up. The local permission policy
denies `git branch -D` and `rm -rf`, so a design that needs either cannot finish.

Rebuilding staging for each backend injection is slow, so batch the backend rows and rebuild only
the affected image (`docker compose -f docker-compose.staging.yml up -d --build api`). Post the
table on the issue, not as a committed file.

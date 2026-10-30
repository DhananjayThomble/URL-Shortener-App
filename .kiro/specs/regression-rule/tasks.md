# Every confirmed finding gets a regression test — tasks

Epic: #882.

| Task | Issue | Sprint | Lane | Depends on |
|---|---|---|---|---|
| E1 Write the rule (steering + prompts + PR template) | #898 | 1 | free | — |
| E2 Guard script + unit tests | #899 | 2 | free | E1 |
| E3 CI: `regression-guard` job | #900 | 3 | CI | E2 |
| E4 Backfill: prove 10 existing regression tests fail on the parent | #901 | 4 | staging (journey rows) | — |

## E1
- [ ] Apply design §1 to every file listed. Keep `testing.md` as the only full statement of the rule.
- [ ] Create the `regression-test:n/a` label (description: "Fix needs no regression test. Applied by the maintainer, never by a session.").
- [ ] Fix the PR template's inverted checklist in a separate commit.

## E2
- [ ] `scripts/regression-test-guard.mjs` + `.test.mjs` per design §2. Cover: no closing issue,
      non-bug issue, bug + test file, bug + no test file, bug + `regression-test:n/a` (exempt, and the
      exemption is printed).

## E3
- [ ] Add the job per design §3 and add it to `ci-gate`. Run `actionlint`.
- [ ] Prove it on a scratch PR in both directions: one with no test file closing a `bug` issue goes red,
      one with a test file goes green. Then close both scratch PRs.

## E4
- [ ] Follow design §4. Post the table. File test-only issues for any fake regression test.

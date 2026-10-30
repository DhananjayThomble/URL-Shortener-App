# Test confidence program — index

Program issue: #874. Sprints: #875 · #876 · #877 · #878.

The goal: catch regressions automatically, generate edge cases from the contract instead of listing
them by hand, and prove the suites can fail, with no QA team. Each workstream is a Kiro spec
(`requirements.md` → `design.md` → `tasks.md`):

| Spec | Epic | What it delivers |
|---|---|---|
| [`real-stack-ci/`](real-stack-ci/) | #879 | Journeys, a11y and dom-xss against a real stack in CI; WebKit in the e2e job |
| [`visual-regression/`](visual-regression/) | #866 | `toHaveScreenshot` baselines, 3 viewports, pinned container |
| [`api-stack-tests/`](api-stack-tests/) | #880 | Contract fuzzing from the zod schemas; route × principal access matrix |
| [`mutation-testing/`](mutation-testing/) | #881 | Stryker on domain + contract; one whole-suite bug-injection gate |
| [`regression-rule/`](regression-rule/) | #882 | A confirmed bug always ships with a red-then-green test, enforced in CI |

## Sprints

| Sprint | Goal | Staging lane (serial) | Free lane (parallel) | CI lane (`needs-human`, serial) |
|---|---|---|---|---|
| 1 | Run what already exists; fix the known 500; start the authz oracle | #883 → #884 → #885 → #891 | #887, #867, #868, #898 | #886 |
| 2 | Build the new harnesses | #888 | #869 → #870, #889, #894 → #895, #899 | — |
| 3 | Generated edge cases + wire every new gate | #890 → #892 | — | #871 → #896 → #900 → #893 |
| 4 | Prove it all fails; finish | #897, #901 | #872, #873 | — |

### Lanes
- **Staging lane.** The task runs `pnpm staging:up`. The compose project name is fixed
  (`snapurl-staging`), so two sessions would fight over one stack and its ports. **One staging
  task at a time.**
- **Free lane.** Unit tests, Docker-contained visual runs, docs. Safe to run in parallel tabs.
- **CI lane.** Edits `.github/workflows/verify.yml`. Only the maintainer merges these, and they
  conflict with each other, so **merge each before starting the next.**

### Maintainer actions (the human-only steps)
1. Merge every PR after looking at it. The free and staging lanes may self-verify, but nothing merges itself.
2. #891: answer the five authz questions and approve the drafted matrix rows. #892 cannot start until then.
3. #870 and #873: look at every baseline image once. That approval is the oracle.
4. Every CI-lane PR: apply it if the agent's token cannot push workflow files.
5. #893: promote `real-stack` to required only after 5 consecutive green `main` runs.
6. Apply `regression-test:n/a` (admin-only) to fix issues that need no test.

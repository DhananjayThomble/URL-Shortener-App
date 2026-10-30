# Prove the tests can fail — tasks

Epic: #881.

| Task | Issue | Sprint | Lane | Depends on |
|---|---|---|---|---|
| D1 Stryker on `packages/domain` + ADR | #894 | 2 | free | — |
| D2 Stryker on `packages/contract` | #895 | 2 | free | D1 (shares the ADR and root script) |
| D3 CI: `mutation` job | #896 | 3 | — (`needs-human`) | D1, D2 |
| D4 Whole-suite bug-injection gate | #897 | 4 | staging | every CI-wiring task merged |

## D1
- [ ] Install core + vitest-runner (10.x, same version for both) in `packages/domain` devDependencies.
- [ ] Add `stryker.config.json` per design §1, the ignores and the `test:mutation` script.
- [ ] Write the ADR entry (stack-choices table row or Part 4b entry, with `**Revisit if**`).
- [ ] Measure, triage survivors per design §2, set `break`. Put the numbers in the PR body.

## D2
- [ ] Same as D1 for `packages/contract`. Decide S5 (string literals) from the measured report.

## D3
- [ ] Add the `mutation` path filter + job + `ci-gate` entry per design §3. Run `actionlint`.

## D4
- [ ] Run the catalogue in `requirements.md` §4 per design §4. Post the table. File an issue for every
      gap, or record it as a documented gap in the relevant spec's coverage-gaps section.

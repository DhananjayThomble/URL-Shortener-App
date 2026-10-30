# Generated API tests — tasks

Epic: #880. Staging lane = needs `pnpm staging:up` (one session at a time).

| Task | Issue | Sprint | Lane | Depends on |
|---|---|---|---|---|
| C5 Draft the access-matrix oracle for maintainer approval | #891 | 1 | staging | — |
| C2 Stack-test harness, route inventory, registry parity | #888 | 2 | staging | — |
| C3 zod → fast-check walker with self-check | #889 | 2 | free | — |
| C4 Contract fuzz suite | #890 | 3 | staging | C2, C3 |
| C1 Bug: non-UUID ids 500 on members/reports | #887 | 1 | free | — |
| C6 Access-matrix suite | #892 | 3 | staging | C2, C5 approved |
| C7 CI: `aux` shard + promote `real-stack` to required | #893 | 3 | CI | C4, C6, #886, 5 green `main` runs |

## C5 — draft the oracle
- [ ] Produce `apps/api/src/stack/access-matrix.expected.ts` (design §7). Fill one row per route from
      **observed** behaviour, every row `status: "observed"`. Use the 71-route inventory in design
      Appendix A; C2 will later prove it complete.
- [ ] Observe on staging, not from decorators alone: send each route once per principal and record the
      status. Seeding can be throwaway script code in the PR. C2 productionises it.
- [ ] Render the table as markdown in the PR body, grouped by controller, with the five design §7
      questions at the top.
- [ ] Draft the ADR "Cross-workspace access answers 404" in `docs/DECISIONS.md` (Part 4b style,
      `**Revisit if**`).
- [ ] Label the PR `decision`. **The maintainer approves rows.** An agent flips a row to `approved` only
      when it can cite a maintainer comment approving it, and puts that comment's URL in the commit message.

## C2 — harness
- [ ] `vitest.stack.config.ts`, the exclude in `vitest.config.ts`, a `test:stack` script, `src/stack/env.ts`.
- [ ] `route-inventory.ts` + a parity test (plain `*.test.ts`). Commit it red first, then add the 3 missing
      registry routes, regenerate `openapi.generated.json`, and handle `fixture-parity.test.ts`.
- [ ] `principals.ts` per design §4, with a 429 back-off and `afterAll` cleanup.
- [ ] Smoke test: each principal calls `GET /auth/me` or `GET /workspaces/current` and gets the
      expected role or a 401/403.

## C3 — generator
- [ ] `zod-arbitrary.ts` per design §5, with the override map and throw-on-unknown.
- [ ] `zod-arbitrary.test.ts`: for **every** request schema the registry binds, check that 200 valid
      samples always pass `safeParse` and 200 invalid samples always fail it.
- [ ] Prove the self-check bites: temporarily make the invalid mode add unknown keys to a non-strict
      object, and the test must go red. Revert.

## C4 — fuzz suite
- [ ] `fuzz.stack.test.ts` per design §6, implementing oracles F3.1-4, budgets and the 429 ratio check.
- [ ] Prove it bites: temporarily remove one `ParseUUIDPipe` (e.g. `links.controller.ts:59`), run, paste the red
      output (shrunk input + seed), restore it, and run green.
- [ ] Record any new 5xx/contract mismatch as an issue: one issue per root cause, with repro and oracle.
      Mark each as an expected failure with an issue link until fixed.

## C1 — the 500 fix
- [ ] Add `ParseUUIDPipe` to `members/:id` (PATCH, DELETE, POST resend) and `reports/:id` PATCH, the same
      pattern as `links.controller.ts:52-56`. Add a regression test.

## C6 — matrix suite
- [ ] `access-matrix.stack.test.ts`. Asserts `approved` rows only, and **fails if any row is still `observed`**.
- [ ] Coverage guard: rows ↔ inventory, both directions.
- [ ] M4 no-side-effect check on every denied mutation, with a fresh target per case.
- [ ] Rows with `intended` ≠ observed become expected failures linked to their issue.

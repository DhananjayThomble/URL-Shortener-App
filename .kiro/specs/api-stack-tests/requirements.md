# Generated API tests: contract fuzzing and the access matrix — requirements

Status: proposed. Two suites on one harness, both talking HTTP to the real API on the local staging
stack (`pnpm staging:up`, api `:3001`, Postgres `:5435`). Verified against `main` @ `3df871e`.

## 1. Why

- **Edge cases.** The API accepts payloads from 68 hand-registered routes
  (`apps/api/src/openapi/paths/*.ts`), validated by a hand-written zod pipe
  (`apps/api/src/common/zod.pipe.ts`). Any error the pipe or the global filter does not
  anticipate becomes a **500** (`apps/api/src/common/postgres-error.filter.ts:83-88`). On
  2026-10-30, four authenticated routes returned 500 for a non-UUID id (filed as #887). Nobody listed
  that case by hand, and a generator would have found it on its first run.
- **Authorization.** 71 routes, 4 roles, API keys with scopes, and workspace scoping done **by
  hand inside each service** (no shared helper). No test sends every route as every principal.
  Only one route's `@Roles` metadata is asserted anywhere (`domains.update.integration.test.ts:219-229`).
  A missing `eq(x.workspaceId, …)` on one query is a cross-tenant leak, the worst bug class
  for a multi-tenant SaaS (`.kiro/steering/security-and-context.md`, "Multi-tenancy").

## 2. Harness requirements

- **H1** Tests run with Vitest in `apps/api`, under a separate config and a `test:stack` script.
  They skip unless `STACK_API_URL` is set, mirroring the existing `describeDb` convention. The
  default `pnpm test` is unchanged.
- **H2** A **route inventory** derived by reflection from the real controllers (method, full path,
  `@Public`, `@Roles`, `@Scope`), using the technique already in
  `session-hardening.integration.test.ts:51-62`.
- **H3** A **parity guard**: the inventory equals the OpenAPI registry's route set exactly. The
  registry is missing `POST /auth/invite/accept`, `GET /auth/workspaces` and
  `POST /members/{id}/resend` today, and the guard must fail on that before the fix adds them.
- **H4** Principal seeding: anonymous; owner/admin/editor/viewer of workspace A; owner of workspace B;
  an API key of A with every scope; an API key of A with only `links:read`; an API key of B.
  Seeding must tolerate the 5/min register throttle with a bounded back-off.

## 3. Contract fuzzing requirements

- **F1** Generate request bodies, queries and path params from the zod schemas the registry binds to
  each route, using fast-check (already a devDependency of `packages/contract` and
  `packages/domain`, 4.9.0). **No new third-party dependency.** No zod→fast-check bridge exists, so
  write one in-repo.
- **F2** The generator is self-checking: every "valid" sample must pass `schema.safeParse`, and every
  "invalid" sample must fail it. That property is the generator's own oracle, and it runs without
  a stack.
- **F3 Oracles**, per request:
  1. status is never 5xx;
  2. a contract-invalid input gets a 4xx;
  3. a contract-valid input never gets the **validation** 400. That response is identifiable by
     its `issues` array (`ValidationErrorBody`, `zod.pipe.ts:29-34`). Getting one means the controller
     and the registry disagree about the schema;
  4. every 2xx body parses against the registry's response schema for that status.
- **F4** Failures shrink to a minimal input and print the seed, path and payload needed to replay them.
- **F5** Budgets: a fixed seed and ~25 runs per route on PRs, a random seed and ~300 runs per route
  nightly, both set through env vars.

## 4. Access-matrix requirements

- **M1 The oracle is a maintainer-approved table, not the decorators.** No independent statement of
  role permissions exists anywhere in the repo. The only one is the implementation (`@Roles`/`@Scope`
  plus `MembersService.changeRole`), and `qa-oracles.md` §1 forbids using it as its own oracle. So:
  draft the table from observed behaviour, mark every row `observed`, and have the maintainer flip
  each row to `approved` or record a different intended answer. The suite asserts only
  approved rows.
- **M2** One row per inventory route. A route with no row fails the suite, so a new route forces an
  explicit permission decision.
- **M3** Expected outcomes are drawn from `allow` / `401` / `403` / `404` / `own-only` (lists that
  must not contain another workspace's ids).
- **M4 A denial has no side effect.** For every mutating route and every denied principal, the
  target resource is unchanged afterwards, verified by the owner reading it back.
- **M5** Rows where the approved intent differs from today's behaviour are marked as expected
  failures with an issue link. They go red when fixed, which forces removal of the marker. This is the
  same rule as `real-stack-ci` R5.
- **M6** Formalise the de-facto rule "cross-workspace access answers 404, indistinguishable from a
  nonexistent id" as an ADR. Today it lives only in code comments and test titles.

## 5. Limits, stated up front

- **The fuzzer cannot catch schema widening.** It derives "invalid" from the same schema the API
  validates with, so widening a zod schema shifts both sides together. The
  hand-written contract property tests and Stryker on `packages/contract` (`mutation-testing`
  spec) cover that case.
- Route-level `@Throttle` limits (5-30/min) cap how deeply public and auth routes can be fuzzed.
  `THROTTLE_LIMIT` raises only the global bucket. Those routes get a token sample, and the gap is
  recorded in the suite header.
- Generated hostnames are restricted to `example.com|org|net`. The DNS half of the SSRF guard
  (`apps/api/src/common/ssrf-guard.ts:51`) does a real lookup, and random hosts would make runs slow
  and nondeterministic. The hand-written SSRF property tests already cover hostile hosts.

## 6. Acceptance criteria

1. `STACK_API_URL=http://localhost:3001/api/v1 pnpm --filter @snapurl/api test:stack` runs both suites.
2. The parity guard is green, and the registry has the three missing routes.
3. The fuzz suite is proven to bite. With one `ParseUUIDPipe` temporarily removed it goes red with a shrunk repro (evidence in the PR), and with the pipe restored it goes green. #887 (the four routes found by hand on 2026-10-30) is fixed in Sprint 1 and is not held back as a demo.
4. Every inventory route has an approved matrix row, and the matrix suite is green.

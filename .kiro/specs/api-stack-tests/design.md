# Generated API tests — design

## 1. Why HTTP against staging, not in-process

The existing integration tests never boot `AppModule`. `content-type-parser.integration.test.ts:16-18`
says doing so "requires external services and would crash the Vitest worker process", and
Vitest's esbuild transform does not emit `design:paramtypes`, so Nest DI breaks
(`register-throttle.integration.test.ts:65-74`). Calling services directly would also skip the
layer most likely to be wrong for authz: the controller wiring that passes `actor.workspaceId`
down. So both suites drive the real built API image over HTTP. That is also what was asked
("send them to the real API").

## 2. Layout

```
apps/api/
  vitest.stack.config.ts           include: src/**/*.stack.test.ts
  vitest.config.ts                 + exclude: src/**/*.stack.test.ts   (it would match src/**/*.test.ts)
  src/stack/
    env.ts                         STACK_API_URL, STACK_DATABASE_URL; describeStack = url ? describe : describe.skip
    route-inventory.ts             reflection over every controller → RouteInfo[]
    route-inventory.stack.test.ts  H3 parity guard (does not actually need the stack — see note)
    principals.ts                  seedPrincipals(): 9 principals + one resource of each kind in A and B
    zod-arbitrary.ts               valid/invalid arbitraries from zod v4 defs
    zod-arbitrary.test.ts          F2 self-check (plain unit test, runs in normal `pnpm test`)
    fuzz.stack.test.ts             F3 oracles over every registry route
    access-matrix.expected.ts      M1 oracle table (excluded from the production build)
    access-matrix.stack.test.ts    M2-M5
```

Note: the parity guard and the generator self-check need no stack. Name them `*.test.ts` so they run
in the normal `pnpm test` / `verify` job, and keep only the HTTP suites as `*.stack.test.ts`.

`apps/api/tsconfig.json` already excludes `src/**/*.test.ts` from the build. Add
`src/stack/access-matrix.expected.ts`, and `zod-arbitrary.ts` if it ends up importing `fast-check`.
Add `fast-check` to `apps/api` devDependencies at the **same range** as contract and domain
(`^4.9.0`). It is already in the lockfile, so this is not a new external dependency.

## 3. Route inventory

Import every controller class (14, listed in the gatherer inventory), walk prototype methods, and
read `PATH_METADATA` (class and method), `METHOD_METADATA`, `IS_PUBLIC`, `REQUIRED_ROLES` and
`REQUIRED_SCOPE`. Prefix with `env.API_PREFIX` (default `api/v1`, `config/env.ts:10`). Normalise
`:id` to `{id}` to compare with the registry.

Parity source: `registry.definitions.filter(d => d.type === "route")` from
`apps/api/src/openapi/registry.ts`. The registry module applies `extendZodWithOpenApi(z)` before
importing the contract (lines 15-17), so import it **before anything else** that imports
`@snapurl/contract`, or the refs lack `.openapi()`.

Adding the three missing routes to `paths/*.ts` regenerates `web/src/lib/api/openapi.generated.json`
(`pnpm --filter @snapurl/api emit:openapi`). That feeds `web/src/lib/api/fixture-parity.test.ts`,
which will then demand fixture branches or reasoned allowlist entries for them. Handle that in
the same PR.

## 4. Principals

| Principal | How |
|---|---|
| anon | no `Authorization` header |
| ownerA, ownerB | `POST /auth/register` (5/min/IP, so back off on 429 with a cap) |
| adminA, editorA, viewerA | register, then insert a `memberships` row into A over `STACK_DATABASE_URL` (`createDatabase` from `@snapurl/database`), then `POST /auth/refresh {refreshToken, workspaceId: A}` to get a JWT carrying that role. This mirrors `session-hardening.integration.test.ts` (accept → refresh) without the mail outbox. |
| keyA-all, keyA-links-read, keyB-all | insert `apiKeys` rows with `keyHash = sha256(raw)` and `scopes`, the exact shape of `api-key-scope.integration.test.ts:61-75` |

Resources, created over HTTP as the owner so creation goes through real code: a link, a form, a
pending domain, a bio page, a webhook, an API key, an invited member, and an abuse report (via
`POST /public/links/:slug/report`), in **both** A and B. Every `{id}` route then has a real target
in each workspace.

Cleanup: delete both workspaces and the five users by id over `STACK_DATABASE_URL` in `afterAll`.

## 5. The zod → fast-check walker

Zod is v4 (`zod@4.4.3`). Walk `schema._zod.def.type`. Construct counts across the contract
(grep): `object` 83, `string` 210, `number` 56, `boolean` 34, `array` 33, `enum` 26, `literal` 7,
`record` 4, `optional` 92, `nullable` 70, `default` 37, `union` 1, `discriminatedUnion` 1, `pipe` 1,
`coerce` 1, `refine` 5. No `transform`, `superRefine`, `preprocess`, `lazy`, `custom`, `brand` or
`catch`.

- Read string checks (`min_length`, `max_length`, `regex`, `email`, `uuid`, `url`) and number checks
  (`int`, `gte`, `lte`) from `def.checks`. Use `fc.stringMatching` for regexes. Do not filter
  `fc.string()`, which starves the generator (the comment in `slug.property.test.ts` says why).
- **Refinements cannot be generated generically.** Keep an override map keyed by schema identity:
  - `HttpUrl` (`packages/contract/src/http-url.ts:148-175`): `https://{example.com|example.org|example.net}/<path>`
    with an optional query string. **Never** random hosts (requirements §5).
  - `LinkDateInput` (`link.ts:76`): ISO-8601 instants within ±5 years.
  - The object-level rule at `workspace.ts:108` (`rootRedirect` or `notFoundRedirect` must be set):
    always set at least one.
- **Throw on an unknown construct**, naming its path. A silent `fc.anything()` fallback would produce
  junk that looks like coverage.
- Invalid mode: pick one strategy per sample.
  - Swap a field's type.
  - Drop a required key.
  - Violate a bound (length ±1, a non-integer for an `int`, a value outside the enum).
  - Add an unknown key, **only on `.strict()` objects**. Non-strict objects strip unknown keys,
    so that input is *valid*. F2 catches the mistake if this rule is broken.
  - Use a hostile `HttpUrl`, reusing the hand-written denied-host arbitraries from
    `packages/contract/src/schemas.property.test.ts`.
- Transport-level invalids, per body route: a malformed JSON string, the wrong `content-type`, and
  an empty body on a route that requires one. Each must be 4xx, never 5xx. Whether malformed
  JSON gives 400 or 500 has **not** been verified (`main.ts` ~88-96 hands the `SyntaxError` to
  Fastify's `done(err)`). The fuzzer settles it.

## 6. Fuzz runner

For each registry route: authenticate as ownerA. Substitute path params from the principal
fixtures, with a `{id}`-shaped arbitrary in invalid mode (non-UUID strings, then random valid
UUIDs). Run F3's oracles. Use `fc.assert(fc.asyncProperty(...), { numRuns, seed })` with
`FUZZ_RUNS` (default 25) and `FUZZ_SEED` (default a fixed number on PR, `Date.now()` nightly).

- **Destructive routes** (`DELETE …`, `POST /auth/logout`, `POST /auth/2fa/disable`, password-reset
  confirm) are fuzzed **only with invalid input or nonexistent ids**. Valid deletes belong to the
  matrix, which uses a fresh resource per case.
- **Route-level throttled routes** (`@Throttle` in `auth.controller.ts` and `public.controller.ts`)
  are capped at 3 samples each. List them in the suite header as a known coverage gap.
- A 429 is a 4xx, so it satisfies oracle 2 but tells you nothing. Count 429s and fail if more
  than 5% of a run's requests got one: that means the budget is wrong, not the API.

## 7. Access-matrix oracle file

```ts
type Expect = "allow" | 401 | 403 | 404 | "own-only";
type Principal = "anon" | "ownerA" | "adminA" | "editorA" | "viewerA" | "ownerB"
               | "keyA-all" | "keyA-links-read" | "keyB-all";
interface Row {
  route: `${"GET"|"POST"|"PUT"|"PATCH"|"DELETE"} /api/v1/${string}`;
  expect: Partial<Record<Principal, Expect>> & { any?: Expect };  // `any` for @Public rows
  status: "observed" | "approved";
  intended?: Partial<Record<Principal, Expect>>;                   // maintainer's answer when it differs
  issue?: number;                                                  // required when `intended` is set
  note?: string;
}
```

- `ownerB` against A's resource is the cross-tenant probe. Expect `404` for `{id}` routes and
  `own-only` for lists.
- Public rows only need `anon` and `ownerA`. Testing all 9 principals would just burn the 5/min
  route throttles.
- **Assertion of `allow`:** status not in {401, 403} and not a scope 403. For a `{id}` route, also not a 404 on the
  principal's own workspace resource.

### Questions the draft must put to the maintainer (C5)

These are behaviours where the code answers but nothing says whether the answer is intended:

1. **Can an admin remove an owner?** `MembersService.remove` (`members.service.ts` ~247-260)
   receives no actor role. Only the last-owner guard stops it. `changeRole` has rank rules (#345)
   and `remove` has none.
2. **Is the stale-role window accepted?** The guard trusts the role in the JWT
   (`auth.guard.ts` `actorFromJwt`). A demoted or removed member keeps their old role for up to the
   15-minute access TTL. `GET /auth/me` re-checks and 401s, but other routes do not.
3. **Should a viewer read the member roster and the audit log?** `GET /members` and `GET /audit`
   have no `@Roles`.
4. **Should a viewer record conversions?** `POST /conversions` has `@Scope("conversions:write")` but
   no `@Roles`, so every session role passes.
5. **Should `PATCH /reports/:id` be editor or admin?** It flags links platform-side.

## 8. CI

Both suites run in the `real-stack` job's `aux` shard (see `real-stack-ci` design §2), after
`staging:up`, with `STACK_API_URL` and `STACK_DATABASE_URL` set. The pino error-level gate in that
job is the backstop oracle for 500s the assertions somehow miss. Nightly runs use `FUZZ_RUNS=300`
and a random seed. The job prints the seed on failure.

## Appendix A — route inventory at `3df871e` (71 routes, 14 controllers)

Prefix `/api/v1` on every path. `P` = `@Public`. `R:x` = `@Roles("x")`. `S:x` = `@Scope("x")`.
`T:n` = route-level `@Throttle` per minute. `U` = `:id` uses `ParseUUIDPipe`. Routes with neither
`P` nor `R:` are open to every member role, viewer included. API keys always act as `editor`
(`auth.guard.ts` `actorFromApiKey`) and reach **only** routes that declare `S:`. The guard
checks `@Roles` before `@Scope`, so a key never reaches an `R:admin` route.

| Controller | Method & path | Decorators |
|---|---|---|
| auth | POST /auth/register | P, T:5 |
| auth | POST /auth/login | P, T:5 |
| auth | POST /auth/oauth | P |
| auth | POST /auth/refresh | P |
| auth | POST /auth/invite/accept | T:10 *(missing from registry)* |
| auth | GET /auth/workspaces | *(missing from registry)* |
| auth | POST /auth/logout | P |
| auth | POST /auth/password-reset/request | P, T:5 |
| auth | POST /auth/password-reset/confirm | P, T:5 |
| auth | POST /auth/email/verify | P |
| auth | POST /auth/email/resend | P, T:5 |
| auth | GET /auth/me | — |
| auth | POST /auth/2fa/setup | — |
| auth | POST /auth/2fa/enable | — |
| auth | POST /auth/2fa/verify | P, T:5 |
| auth | POST /auth/2fa/disable | — |
| public | GET /public/links/:slug/preview | P |
| public | GET /public/links/:slug/lock | P |
| public | POST /public/links/:slug/unlock | P, T:5 |
| public | GET /public/forms/:slug | P |
| public | GET /public/bio-pages/by-domain/:domain/:slug | P |
| public | GET /public/bio-pages/:slug | P |
| public | POST /public/bio-pages/by-domain/:domain/:slug/view | P, T:30 |
| public | POST /public/bio-pages/by-domain/:domain/:slug/blocks/:blockId/click | P, T:30, U(blockId) |
| public | POST /public/bio-pages/:slug/view | P, T:30 |
| public | POST /public/bio-pages/:slug/blocks/:blockId/click | P, T:30 |
| public | POST /public/forms/:slug | P, T:10 |
| public | POST /public/links/:slug/report | P, T:10 |
| health | GET /health | P |
| links | GET /links | S:links:read |
| links | GET /links/export | S:links:read |
| links | GET /links/:id | S:links:read, U |
| links | POST /links | R:editor, S:links:write |
| links | POST /links/bulk | R:editor, S:links:write |
| links | POST /links/:id/clone | R:editor, S:links:write, U |
| links | PATCH /links/:id | R:editor, S:links:write, U |
| links | DELETE /links/:id | R:editor, S:links:write, U |
| forms | GET /forms | S:links:read |
| forms | GET /forms/:id | S:links:read, U |
| forms | GET /forms/:id/responses | S:links:read, U |
| forms | GET /forms/:id/responses.csv | S:links:read, U |
| forms | POST /forms | R:editor, S:links:write |
| forms | PATCH /forms/:id | R:editor, S:links:write, U |
| forms | DELETE /forms/:id | R:editor, S:links:write, U |
| domains | GET /domains | S:domains:read |
| domains | POST /domains | R:admin, S:domains:write |
| domains | POST /domains/:id/verify | R:admin, S:domains:write, U |
| domains | PATCH /domains/:id | R:admin, S:domains:write, U |
| domains | DELETE /domains/:id | R:admin, S:domains:write, U |
| members | GET /members | — |
| members | POST /members | R:admin |
| members | PATCH /members/:id | R:admin, **no U** (C1) |
| members | POST /members/:id/resend | R:admin, **no U** (C1) *(missing from registry)* |
| members | DELETE /members/:id | R:admin, **no U** (C1) |
| members | GET /audit | — |
| developers | GET /api-keys | R:admin |
| developers | POST /api-keys | R:admin |
| developers | DELETE /api-keys/:id | R:admin, U |
| developers | GET /webhooks | R:admin |
| developers | POST /webhooks | R:admin |
| developers | DELETE /webhooks/:id | R:admin, U |
| bio-pages | GET /bio-pages | — |
| bio-pages | PUT /bio-pages | R:editor |
| bio-pages | DELETE /bio-pages/:id | R:editor, U |
| workspaces | GET /workspaces/current | — |
| workspaces | PATCH /workspaces/current | R:admin |
| conversions | GET /conversions | S:analytics:read |
| conversions | POST /conversions | S:conversions:write, **no R** (design §7 Q4) |
| reports | GET /reports | S:links:read |
| reports | PATCH /reports/:id | R:editor, S:links:write, **no U** (C1) |
| analytics | GET /analytics | S:analytics:read |

This table was derived by reading the decorators. Reading decorators is fine for an **inventory**,
but it is **not** the oracle. The oracle is the maintainer-approved `access-matrix.expected.ts` (C5).
Before relying on this table, check it against `route-inventory.ts` (C2). A count that is not 71
means the code moved.

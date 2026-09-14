# L3 — API ↔ contract differential

QA layer L3: does every response the *real* running API sends back actually
satisfy the zod schema in `@snapurl/contract` that the frontend imports to
type it?

## What this is

`run.ts` is a standalone script (not a vitest suite — see "Why not vitest"
below) that:

1. Loads `apps/api/dist/openapi/registry.ts`'s route table via
   `buildOpenApiDocument()` (the same function `apps/api/scripts/emit-openapi.mjs`
   uses) to enumerate the API's declared route surface — method, path, and
   which `@snapurl/contract` schema is registered as each route's response.
2. Registers a real, throwaway account against the live API
   (`POST /auth/register`) to get a session.
3. For every route it can reach with that session (see `summary.md`'s coverage
   gaps for what it could not reach), makes the real HTTP call and runs
   `schema.safeParse(responseBody)` where `schema` is the exact
   `@snapurl/contract` export the OpenAPI registry says is the answer to that
   route — never a schema adjusted after the fact to fit what came back.
4. Every `safeParse` failure, every response field absent from the schema, and
   every `.strict()` schema that got extra keys is one line in
   `.qa-runs/l3-contract/findings.jsonl` (steering §3 format). No verdicts.

## Why not vitest

The brief allows either. This one is a plain tsx script because:
- It runs once, end-to-end, against one seeded account and a handful of
  objects it creates itself; there is no fixture matrix or parametrization
  vitest buys anything for.
- It writes structured findings to `.qa-runs/l3-contract/findings.jsonl` per
  steering §3, which is not naturally a passing/failing `it()` block — a
  `safeParse` miss is not "test failed", it is "evidence recorded"; framing it
  as a red vitest test would tempt fixing the check instead of reporting the
  drift (steering §2 — evidence, not verdicts).
- No existing test file is touched (per the brief).

## Running it

The staging stack must already be up (`api` on `:3001`). This script does
**not** start/stop it.

```bash
pnpm --filter @snapurl/contract build   # for CommonJS runtime schema access
pnpm --filter @snapurl/api build        # for buildOpenApiDocument()
API_BASE=http://localhost:3001/api/v1 npx tsx qa/l3-contract/run.ts
```

Output: `.qa-runs/l3-contract/findings.jsonl` and `.qa-runs/l3-contract/summary.md`
(both gitignored — local artifacts only, per steering §7).

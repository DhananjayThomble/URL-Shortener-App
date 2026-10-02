# L3 — web/ consumption vs. contract guarantee

Part of #606 (the other half of #428's L3 layer, which only checked API responses
against the contract — never what `web/` actually reads off them).

## What this is

`run.mts` is a standalone static-analysis script (no running stack needed) that:

1. Parses every `web/src/lib/api/hooks/*.ts` file with the TypeScript compiler API
   and extracts, for each exported `useX` hook, the exact `@snapurl/contract` schema
   identifier passed as the second argument to `request(path, Schema, ...)`. This is
   read literally off the source — never guessed or re-derived — so the hook→schema
   pairing is the same one the app's own runtime `schema.safeParse()` in
   `web/src/lib/api/client.ts` enforces.
2. Loads the **real, built** `@snapurl/contract` package and asks each schema, at
   runtime, which of its fields are optional/nullable (`ZodOptional`/`ZodNullable`
   introspection via `.isOptional()`/`.isNullable()`/`.unwrap()`) — never a shape
   re-typed by hand. This is the oracle (`.kiro/steering/qa-oracles.md` §1.1:
   "packages/contract — the zod schemas are the declared truth").
3. Parses every `.ts`/`.tsx` file under `web/src/app/**` and `web/src/components/**`,
   finds call sites of each hook, and walks the property-access chains read off the
   hook's result (`const l = link.data; … l.safeBrowsing.status`, `a?.totals.clicks`,
   etc.).
4. For every chain that passes through a field the schema marks optional or
   nullable **without** the source guarding it (no `?.` at that segment, no `??`/
   `&&` wrapping the whole expression, no destructure default), it is one line in
   `.qa-runs/l3-web-usage/findings.jsonl`: `web/ reads <path> as if required, but
   @snapurl/contract says it is optional/nullable`.

This is a heuristic, not a type-checker: it does not model an enclosing `if
(x.field) { … x.field.sub … }` guard a few lines above the access, so a flagged
chain may already be safe at runtime for a reason this script cannot see. Every
such case is still recorded as a finding with the guard caveat in `notes`
(`.kiro/steering/qa-oracles.md` §2 — report it anyway, don't self-adjudicate) —
adjudicating whether the surrounding control flow actually covers it is for the
reviewer, not this script.

## Why not vitest / why not touch an existing test

Same reasoning as `qa/l3-contract`: this writes structured findings, not
pass/fail assertions, and no existing source or test file is modified.

## Running it

No staging stack needed — this only reads source files and the built contract
package.

```bash
pnpm --filter @snapurl/contract build
npx tsx qa/l3-web-usage/run.mts
```

Output: `.qa-runs/l3-web-usage/findings.jsonl` and
`.qa-runs/l3-web-usage/summary.md` (both gitignored — local artifacts only, per
steering §7).

## Bug-injection gate

Per steering §4, before trusting this suite: widen a `packages/contract` schema
field from required to `.optional()` (catalog item 5) on a field `web/` already
reads unguarded, and confirm the suite goes from reporting that chain clean to
flagging it. See the PR description for the specific field used and the
before/after run output; the injection is reverted in the same PR, never merged.

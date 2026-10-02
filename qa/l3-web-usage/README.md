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
   nullable **without** the source guarding it, it is one line in
   `.qa-runs/l3-web-usage/findings.jsonl`: `web/ reads <path> as if required, but
   @snapurl/contract says it is optional/nullable`. A guard is checked
   per-segment (`analyzer.mts`'s `isGuardedAt()`), because a whole-chain test
   only proves the *final* value is safe to read as a boolean/compare — it
   says nothing about an earlier loose segment that gets dereferenced to
   reach that final value. `l.safeBrowsing.status === "clean"` is NOT a guard
   on `safeBrowsing` itself: if `safeBrowsing` were optional, `.status` is
   read off it before the `===` ever runs. A segment is guarded when: `?.` is
   used at that exact segment; it is the chain's *last* segment and the whole
   expression is wrapped in `??`, is the `whenTrue` branch of a ternary whose
   condition tests the same base/prefix, or is used only as a
   truthiness/equality test itself (ternary condition, `&&`/`||` left
   operand, `!`/`Boolean()` operand, `==`/`===`/`!=`/`!==` comparison); or
   (valid at any segment, not just the last) an earlier sibling `&&` operand
   in the same logical expression already tests the same base/prefix truthy.

This is a heuristic, not a type-checker: it does not model an enclosing `if
(x.field) { … x.field.sub … }` guard a few lines above the access, hook results
passed through props/helpers, or TypeScript's own control-flow narrowing from
an early return — so a flagged chain may already be safe at runtime for a
reason this script cannot see. Every such case is still recorded as a finding
with the guard caveat in `notes` (`.kiro/steering/qa-oracles.md` §2 — report it
anyway, don't self-adjudicate) — adjudicating whether the surrounding control
flow actually covers it is for the reviewer, not this script.

## Why not vitest / why not touch an existing test

Same reasoning as `qa/l3-contract`: `run.mts` writes structured findings, not
pass/fail assertions, and no existing source or test file is modified.
`selftest.mts` (the regression suite below) *is* pass/fail by nature — it
asserts a fixed guard outcome against a fixture, not a drifting real-world
answer — but is kept as a second plain script rather than a vitest spec so
the whole layer stays runnable the same way (`node --experimental-strip-types`,
no new devDependency, no vitest config/workspace wiring for a two-file qa
tool).

## Running it

No staging stack needed — this only reads source files and the built contract
package.

```bash
pnpm --filter @snapurl/contract build
pnpm run qa:l3-web-usage
```

`qa:l3-web-usage` runs `node --experimental-strip-types qa/l3-web-usage/run.mts`
directly — no `npx`/`tsx` auto-install, so it works offline right after
`pnpm install --frozen-lockfile` (confirmed: `npx tsx` fails closed with
`tsx: not found` in an environment with no registry egress after a frozen
install; `typescript` is already a workspace devDependency, which is the only
non-builtin import this script needs, and Node 22's native
`--experimental-strip-types` handles the `.mts` syntax itself).

Output: `.qa-runs/l3-web-usage/findings.jsonl`, `.qa-runs/l3-web-usage/summary.md`
and `.qa-runs/l3-web-usage/progress.md` (all gitignored — local artifacts only,
per steering §7). Per steering §3: `summary.md` is written with every phase
marked pending before any check runs, each phase appends a line to
`progress.md` and updates `summary.md`'s phase status the moment it finishes,
and `findings.jsonl` is appended to as each finding is confirmed rather than
buffered — if a later phase throws, everything an earlier phase wrote is
already on disk.

## Regression tests

`analyzer.mts` holds the pure AST guard-detection logic (no contract package,
no web/ tree) so it can be exercised directly against a small fixture:

```bash
pnpm run qa:l3-web-usage:selftest
```

`fixtures/consumer.fixture.tsx` + `selftest.mts` cover three cases added after
a review on PR #635 caught two false positives in the original baseline run:

1. **Guarded ternary**: `l.createdBy ? \`by ${l.createdBy}\` : ""` — the access
   flagged was the ternary's own condition, which only tests truthiness and
   never dereferences a sub-field. `isPureTruthinessTest()` recognizes a
   ternary condition, `&&`/`||` left operand, `!`/`Boolean()` operand, and
   `==`/`===`/`!=`/`!==` comparison as never a loose-field bug regardless of
   what the schema says.
2. **Guarded short-circuit**: `data?.nextCursor && use(data.nextCursor!)` — the
   right operand's `data.nextCursor!` only runs once the left operand already
   proved `data.nextCursor` truthy. `isGuardedBySiblingTest()` walks up through
   enclosing `&&` chains and ternary conditions collecting every same-base
   path already tested, and treats an exact or prefix match as a guard on the
   later access.
3. **Unguarded positive control**: `l.title.length` — no guard of any kind,
   asserted to still produce `guarded === false` so the two fixes above can't
   regress into blanket-suppressing everything.
4. **Final-segment test does not mask an earlier loose segment**:
   `l.safeBrowsing.status === "clean"` — the `===` only tests the *final*
   `.status` value; if `safeBrowsing` itself is the loose segment, `.status`
   is dereferenced off it before the comparison ever runs, so this must
   still be flagged for the `safeBrowsing` segment. Found by hand while
   re-running the bug-injection gate below after adding cases 1–3: the first
   version of `isGuarded()` applied the whole-chain truthiness/equality
   exemption to every segment in the chain, which silently stopped flagging
   `useLink-safeBrowsing` when `Link.safeBrowsing` was widened to
   `.optional()` — the opposite of a false positive, a false negative that
   would have hidden a real finding. Fixed by splitting into
   `isGuardedAt(node, rootName, fullPath, targetIdx)`, which only applies the
   final-value truthiness/equality exemption when `targetIdx` is the chain's
   last segment; the sibling-`&&`-test case stays valid at any segment since
   it is already prefix-aware.

Bug-injection proof for this regression suite itself (steering §4): removing
the ternary-condition branch from both `isPureTruthinessTest()` and
`isGuardedBySiblingTest()` makes `selftest.mts` fail case 1 (`guarded=false`,
expected `true`) while cases 2–3 stay green — confirming the test actually
exercises that code path rather than passing vacuously. Reverted before
committing; `git diff` on `analyzer.mts` is empty.

## Bug-injection gate

Per steering §4, before trusting this suite: widen a `packages/contract` schema
field from required to `.optional()` (catalog item 5) on a field `web/` already
reads unguarded, and confirm the suite goes from reporting that chain clean to
flagging it. See the PR description for the specific field used and the
before/after run output; the injection is reverted in the same PR, never merged.

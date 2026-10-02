/*
 * Regression fixture for qa/l3-web-usage's guard analysis. Not real web/
 * source — a minimal stand-in exercising the three cases the review on
 * PR #635 required coverage for:
 *
 *   1. Guarded ternary:        createdBy ? `by ${createdBy}` : ""
 *      The access flagged is the ternary's own *condition*, which only
 *      tests truthiness and never dereferences a sub-field. Safe
 *      regardless of what the schema says — selftest.mts asserts
 *      isGuarded() === true here.
 *
 *   2. Guarded short-circuit:  data?.nextCursor && use(data.nextCursor!)
 *      The right operand's `data.nextCursor!` is only evaluated once the
 *      left operand already proved `data.nextCursor` truthy — a sibling
 *      guard in the same logical expression. selftest.mts asserts
 *      isGuarded() === true for the right-hand access.
 *
 *   3. Unguarded positive control: title.length
 *      No guard of any kind on an optional field — selftest.mts asserts
 *      isGuarded() === false, so a real regression (the guard logic
 *      becoming too permissive) still gets caught.
 *
 *   4. Final-segment test must not mask an earlier loose segment:
 *      l.safeBrowsing.status === "clean"
 *      The `===` only tests the final `.status` value; if `safeBrowsing`
 *      itself were the loose/optional segment, `.status` is dereferenced
 *      off it *before* the comparison runs, so this access must still be
 *      flagged for the `safeBrowsing` segment specifically. Asserts
 *      isGuardedAt(..., targetIdx=0) === false (the `safeBrowsing` segment,
 *      index 0) even though isGuardedAt(..., targetIdx=1) (the `status`
 *      segment) would be true.
 *
 * selftest.mts parses this file directly with the TypeScript compiler API
 * (the same parser run.mts uses) and locates each case by its marker
 * comment, so the fixture stays human-readable source rather than needing
 * a hand-built AST.
 */
function render(
  l: { createdBy: string | null; title: string | undefined; safeBrowsing?: { status: string } },
  data: { nextCursor?: string; total: number } | undefined,
  use: (s: string) => void,
) {
  // CASE_1_GUARDED_TERNARY
  const label = l.createdBy ? `by ${l.createdBy}` : "";

  // CASE_2_GUARDED_SHORT_CIRCUIT
  data?.nextCursor && use(data.nextCursor!);

  // CASE_3_UNGUARDED_POSITIVE_CONTROL
  const len = l.title.length;

  // CASE_4_FINAL_SEGMENT_TEST_MUST_NOT_MASK_EARLIER_SEGMENT
  const verdict = l.safeBrowsing.status === "clean" ? "safe" : "unverified";

  return { label, len, verdict };
}

void render;

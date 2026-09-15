import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { generateSlug } from "./slug.js";

/* Property tests for generateSlug() itself (issue #430).

   slug.property.test.ts (this package) pins the RULE layer against
   isSlugAvailableShape — reserved words, file extensions, the length
   ceiling — and says up front that it does not cover generateSlug(). It
   didn't need to warn about that gap being empty: destination.test.ts's two
   assertions on generateSlug() (no look-alikes over 200 draws, one length
   check at 12) were the entire coverage. A bug-injection run (#430) hard-coded
   generateSlug() to always return one fixed value and only ONE existing
   assertion went red — the length-12 check — because nothing anywhere
   asserted that successive calls differ, or checked alphabet membership
   beyond the look-alike exclusion, or checked length at more than one value.

   These three assert exactly the properties a constant return violates.
   Seeded for deterministic CI, same convention as slug.property.test.ts. */

const SEED = 8817;

describe("generateSlug produces properties a constant return would violate", () => {
  it("N successive calls produce N distinct values", () => {
    /* generateSlug()'s alphabet has 55 characters (see the "No look-alikes"
       comment on ALPHABET in slug.ts) and the default length is 7, so the
       space is 55^7 ≈ 1.52e12 combinations. The birthday-style collision
       bound for N draws from a space of size S is roughly N*(N-1)/(2S). For
       N=2000 that is 2000*1999/(2 * 1.52e12) ≈ 1.3e-6 — a flake from a
       genuine random collision is vanishingly unlikely, while a hard-coded
       constant (or any generator whose effective range collapses) shrinks
       this set to size 1 on the first duplicate call. */
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) seen.add(generateSlug());
    expect(seen.size).toBe(2000);
  });

  it("every character comes from the documented alphabet, and the look-alike-excluded characters never appear", () => {
    /* The oracle here is generateSlug's own doc comment in slug.ts: "No
       look-alikes: 0/O, 1/l/I are all absent, so a slug read aloud or off a
       printed QR code cannot be transcribed into a different link." That is
       an independent statement of intent, not slug.ts's private ALPHABET
       constant — this asserts the invariant the comment promises, rather
       than re-deriving the exact string from the implementation.
       destination.test.ts already runs the look-alike half of this over 200
       draws; this adds alphanumeric-only membership on top of it, over enough
       draws that either a stray out-of-alphabet character or a fixed string
       containing one would be caught. */
    const LOOK_ALIKES = /[0O1lI]/;
    const ALPHANUMERIC_ONLY = /^[A-Za-z0-9]+$/;
    for (let i = 0; i < 500; i++) {
      const slug = generateSlug();
      expect(slug).toMatch(ALPHANUMERIC_ONLY);
      expect(slug).not.toMatch(LOOK_ALIKES);
    }
  });

  it("honours the requested length across a range of lengths, not only the default", () => {
    // destination.test.ts's existing length assertion checks exactly one
    // value (12). A generator hard-coded to the default length of 7 would
    // pass that single check and fail everywhere else — this sweeps a range
    // instead of pinning one point.
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 64 }), (length) => {
        expect(generateSlug(length)).toHaveLength(length);
      }),
      { numRuns: 100, seed: SEED },
    );
  });
});

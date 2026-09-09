import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { RESERVED_SLUGS, isSlugAvailableShape } from "./slug.js";

/* Property tests for the slug RULES (issue #356). The contract schema only pins
   the slug SHAPE (`^[a-zA-Z0-9._-]*$`); the reserved-word, file-extension and
   length rules live here in the domain layer. A generator built only from the
   schema produces slugs the contract accepts but the service still rejects — so
   these pin the domain layer directly. (This test lives in @snapurl/domain, not
   @snapurl/contract: contract must not import domain, which would be a cycle.)

   Seeded for deterministic CI. */

const SHAPE = /^[a-zA-Z0-9._-]+$/;
const SEED = 4356;

describe("slug rules reject shapes the contract schema would accept", () => {
  it("reserved slugs are shape-valid but rule-rejected", () => {
    fc.assert(
      fc.property(fc.constantFrom(...RESERVED_SLUGS), (slug) => {
        // Reserved entries are all made of shape-legal characters.
        expect(SHAPE.test(slug)).toBe(true);
        expect(isSlugAvailableShape(slug).ok).toBe(false);
      }),
      { numRuns: 100, seed: SEED },
    );
  });

  it("file-extension slugs are shape-valid but rule-rejected", () => {
    fc.assert(
      fc.property(
        fc.tuple(
          fc.stringMatching(/^[a-z]{1,10}$/),
          fc.constantFrom("html", "htm", "php", "aspx", "jsp", "json", "xml", "txt", "js", "css", "map"),
        ),
        ([stem, ext]) => {
          const slug = `${stem}.${ext}`;
          expect(SHAPE.test(slug)).toBe(true);
          expect(isSlugAvailableShape(slug).ok).toBe(false);
        },
      ),
      { numRuns: 200, seed: SEED },
    );
  });

  it("over-length slugs (shape-legal chars) are rule-rejected", () => {
    // Generate directly from the shape alphabet — filtering a broad fc.string()
    // for SHAPE would reject almost every candidate and starve the generator.
    const shapeChar = fc.constantFrom(..."abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-".split(""));
    const overLong = fc.array(shapeChar, { minLength: 65, maxLength: 200 }).map((cs) => cs.join(""));
    fc.assert(
      fc.property(overLong, (slug) => {
        expect(isSlugAvailableShape(slug).ok).toBe(false);
      }),
      { numRuns: 100, seed: SEED },
    );
  });

  it("a shape-legal, non-reserved, extension-free, in-length slug is accepted", () => {
    // Same: build from the alphabet, then exclude the two rule-level rejections.
    const shapeChar = fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789_-".split(""));
    const goodSlug = fc
      .array(shapeChar, { minLength: 1, maxLength: 30 })
      .map((cs) => cs.join(""))
      .filter((s) => !RESERVED_SLUGS.has(s.toLowerCase()) && !/\.[a-z]+$/.test(s));
    fc.assert(
      fc.property(goodSlug, (slug) => {
        expect(isSlugAvailableShape(slug).ok).toBe(true);
      }),
      { numRuns: 200, seed: SEED },
    );
  });
});

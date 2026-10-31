import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { RESERVED_SLUGS, generateSlug, isSlugAvailableShape } from "./slug.js";

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

  it("'.' and '..' are shape-valid but rule-rejected (unreachable after WHATWG dot-segment normalisation)", () => {
    fc.assert(
      fc.property(fc.constantFrom(".", ".."), (slug) => {
        expect(SHAPE.test(slug)).toBe(true);
        expect(isSlugAvailableShape(slug).ok).toBe(false);
      }),
      { numRuns: 2, seed: SEED },
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


/* #894 — mutation testing. The property tests above assert only `.ok`, so a
   mutated reason message or a blanked reserved-word entry still produced a
   rejection and survived. The reasons are user-facing copy and the reserved
   list is a security boundary (a slug must never shadow a route), so both are
   pinned exactly here. */
describe("isSlugAvailableShape — exact reasons", () => {
  it("names why an empty or over-long back-half is refused", () => {
    expect(isSlugAvailableShape("")).toEqual({ ok: false, reason: "Give the link a back-half." });
    expect(isSlugAvailableShape("x".repeat(65))).toEqual({
      ok: false,
      reason: "Back-halves are limited to 64 characters.",
    });
    // Exactly 64 is allowed (kills the `> 64` -> `>= 64` boundary mutant).
    expect(isSlugAvailableShape("x".repeat(64)).ok).toBe(true);
    expect(isSlugAvailableShape("x".repeat(63)).ok).toBe(true);
  });

  it("names the allowed character set when an illegal character is used", () => {
    expect(isSlugAvailableShape("has space")).toEqual({
      ok: false,
      reason: "Use letters, numbers, dots, dashes or underscores.",
    });
    expect(isSlugAvailableShape("slash/here").reason).toBe("Use letters, numbers, dots, dashes or underscores.");
  });

  it("refuses the single- and double-dot forms with the dot-segment reason", () => {
    const reason = 'Back-halves can\'t be "." or ".." — browsers can never reach them.';
    expect(isSlugAvailableShape(".")).toEqual({ ok: false, reason });
    expect(isSlugAvailableShape("..")).toEqual({ ok: false, reason });
    // "..." is NOT normalised and remains shape-legal and allowed.
    expect(isSlugAvailableShape("...").ok).toBe(true);
  });

  it("quotes the reserved slug back in its reason", () => {
    expect(isSlugAvailableShape("admin")).toEqual({
      ok: false,
      reason: '"admin" is reserved by SnapURL. Try another back-half.',
    });
    // Case-insensitive: the preview-shadowing "p" and "API" are both reserved.
    expect(isSlugAvailableShape("P").ok).toBe(false);
    expect(isSlugAvailableShape("API").ok).toBe(false);
  });

  it.each(["api", "p", "login", "settings", "admin", "www", "health", "qr", "bio"])(
    "reserves %s so a link can never shadow that route",
    (reserved) => {
      expect(isSlugAvailableShape(reserved).ok).toBe(false);
    },
  );

  it("refuses a profane prefix with the available-copy reason", () => {
    expect(isSlugAvailableShape("shitpost")).toEqual({ ok: false, reason: "That back-half isn't available." });
    // The profanity match is anchored at the start only.
    expect(isSlugAvailableShape("nofuckshere").ok).toBe(true);
  });

  it("refuses a file-extension ending with its reason, anchored at the end", () => {
    expect(isSlugAvailableShape("page.html")).toEqual({
      ok: false,
      reason: "Back-halves can't end in a file extension.",
    });
    // Anchored at the end (kills the `$`-drop regex mutant): an interior
    // ".html" that is not the ending is allowed.
    expect(isSlugAvailableShape("html-guide").ok).toBe(true);
    expect(isSlugAvailableShape("a.json").ok).toBe(false);
  });

  it("accepts a plain, legal back-half", () => {
    expect(isSlugAvailableShape("spring-sale")).toEqual({ ok: true });
  });
});

describe("generateSlug uses only the unambiguous alphabet", () => {
  it("never emits a look-alike character (0, O, 1, l, I)", () => {
    const allowed = /^[23456789abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ]+$/;
    for (let i = 0; i < 200; i++) {
      const s = generateSlug();
      expect(s).toHaveLength(7);
      expect(s).toMatch(allowed);
      expect(s).not.toMatch(/[01OlI]/);
    }
  });

  it("honours a requested length", () => {
    expect(generateSlug(1)).toHaveLength(1);
    expect(generateSlug(20)).toHaveLength(20);
  });
});


/* #894 — every reserved word is a security boundary (a link must never shadow
   a route or an official-looking page). Asserted as a hardcoded literal list so
   blanking ANY single RESERVED_SLUGS entry is caught — deriving the list from
   RESERVED_SLUGS itself would mutate both sides and hide the regression. */
describe("the full reserved list is rejected, entry by entry", () => {
  const EXPECTED_RESERVED = [
    "api", "p", "preview", "_next", "static", "assets", "favicon.ico", "robots.txt", "sitemap.xml",
    "health", "healthz", "metrics", "status",
    "login", "register", "signup", "signin", "logout", "settings", "links", "analytics",
    "conversions", "domains", "team", "developers", "bio", "qr", "dashboard", "account",
    "admin", "root", "support", "help", "billing", "security", "abuse", "legal", "privacy",
    "terms", "www", "mail", "smtp", "ftp", "ns1", "ns2",
  ];

  it.each(EXPECTED_RESERVED)("reserves %s", (word) => {
    expect(RESERVED_SLUGS.has(word)).toBe(true);
    expect(isSlugAvailableShape(word).ok).toBe(false);
  });

  it("contains exactly the expected set, no more and no fewer", () => {
    expect([...RESERVED_SLUGS].sort()).toEqual([...EXPECTED_RESERVED].sort());
  });
});

describe("file-extension regex is anchored and case-insensitive", () => {
  it.each(["html", "htm", "php", "aspx", "asp", "jsp", "json", "xml", "txt", "js", "css", "map"])(
    "rejects a .%s ending (and its upper-case form)",
    (ext) => {
      expect(isSlugAvailableShape(`page.${ext}`).ok).toBe(false);
      expect(isSlugAvailableShape(`page.${ext.toUpperCase()}`).ok).toBe(false);
    },
  );

  it("only rejects the extension at the END, not in the middle (kills the $-drop)", () => {
    expect(isSlugAvailableShape("json-schema-guide").ok).toBe(true);
    expect(isSlugAvailableShape("about.css.old").ok).toBe(true);
  });
});

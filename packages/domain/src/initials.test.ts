import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { initialsOf } from "./initials.js";

/* #788 — the avatar rule. The QA pass saw "Q<" for a name containing "<":
   the old rule sliced the first UTF-16 code unit of each word. */

const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

describe("initialsOf", () => {
  it("takes the first letter of the first and last word", () => {
    expect(initialsOf("Dhananjay Thomble")).toBe("DT");
    expect(initialsOf("Ada Byron Lovelace")).toBe("AL");
    expect(initialsOf("QA User One")).toBe("QO");
  });

  it("takes the first two letters of a single name", () => {
    expect(initialsOf("Demo")).toBe("DE");
    expect(initialsOf("cher")).toBe("CH");
  });

  it("keeps a one-letter name as one letter", () => {
    expect(initialsOf("X")).toBe("X");
  });

  it("ignores leading, trailing and repeated whitespace of any kind", () => {
    expect(initialsOf("  Grace   Hopper  ")).toBe("GH");
    expect(initialsOf("\tGrace\n\nHopper\u00a0")).toBe("GH");
    expect(initialsOf("Grace\u00a0Hopper")).toBe("GH");
  });

  it("falls back to ? when there is nothing to show", () => {
    expect(initialsOf("")).toBe("?");
    expect(initialsOf("   ")).toBe("?");
    expect(initialsOf("\u200b")).toBe("?");
    expect(initialsOf("123 456")).toBe("?");
    expect(initialsOf("<>")).toBe("?");
  });

  describe("HTML-ish and punctuation", () => {
    it("never renders a bracket as an initial", () => {
      expect(initialsOf("QA <User>")).toBe("QU");
      // Letters only, no markup parsing: the "b" of "<b>" is a letter.
      expect(initialsOf("<b>Ada</b> Lovelace")).toBe("BL");
      expect(initialsOf("Q<")).toBe("Q");
    });

    it("uses the letters of a single markup-looking word", () => {
      expect(initialsOf("<script>")).toBe("SC");
      expect(initialsOf("<img src=x onerror=alert(1)>")).toBe("IO");
    });

    it("skips words that are only symbols or digits", () => {
      expect(initialsOf("Ada & Bob")).toBe("AB");
      expect(initialsOf("Ada - Bob")).toBe("AB");
      expect(initialsOf("Team 42")).toBe("TE");
      expect(initialsOf("& Ada")).toBe("AD");
    });

    it("handles hyphens and apostrophes inside a word", () => {
      expect(initialsOf("Jean-Luc Picard")).toBe("JP");
      expect(initialsOf("O'Brien")).toBe("OB");
      expect(initialsOf("'Ada' 'Lovelace'")).toBe("AL");
    });
  });

  describe("emoji and non-Latin scripts", () => {
    it("skips emoji instead of splitting them into lone surrogates", () => {
      expect(initialsOf("🎉 Ada")).toBe("AD");
      expect(initialsOf("Ada 🎉")).toBe("AD");
      expect(initialsOf("🎉 Ada Lovelace 🎉")).toBe("AL");
      expect(initialsOf("👩‍💻 Ada")).toBe("AD");
      expect(initialsOf("🎉")).toBe("?");
      expect(initialsOf("🎉🎉 🎉")).toBe("?");
    });

    it("never emits a lone surrogate", () => {
      for (const name of ["🎉", "🎉 🎉", "Ada 🎉", "🎉Ada", "a🎉b", "𝒜da 𝓛ovelace"]) {
        expect(initialsOf(name)).not.toMatch(LONE_SURROGATE);
      }
    });

    it("upper-cases accented and non-Latin letters", () => {
      expect(initialsOf("émile zola")).toBe("ÉZ");
      expect(initialsOf("ångström")).toBe("ÅN");
      expect(initialsOf("Ωmega Ψ")).toBe("ΩΨ");
    });

    it("counts a letter outside the BMP as one letter", () => {
      expect(initialsOf("𝒜da 𝓛ovelace")).toBe("𝒜𝓛");
    });

    it("keeps a combining mark attached to nothing it does not own", () => {
      // "e" + U+0301 (combining acute): the base letter counts, the mark is not a letter.
      expect(initialsOf("e\u0301mile zola")).toBe("EZ");
    });

    it("works for scripts without spaces", () => {
      expect(initialsOf("山田太郎")).toBe("山田");
      expect(initialsOf("山田 太郎")).toBe("山太");
    });

    it("does not widen a letter that upper-cases to two", () => {
      expect(initialsOf("ß")).toBe("S");
      expect(initialsOf("ßa")).toBe("SA");
    });
  });

  it("is pure and bounded for any input (property)", () => {
    fc.assert(
      fc.property(fc.string({ unit: "binary" }), (name) => {
        const out = initialsOf(name);
        // 1–2 code points, never a bracket/whitespace, never half a pair.
        const points = Array.from(out);
        expect(points.length).toBeGreaterThanOrEqual(1);
        expect(points.length).toBeLessThanOrEqual(2);
        expect(out).toBe(initialsOf(name));
        if (out !== "?") for (const p of points) expect(p).toMatch(/^\p{L}$/u);
        expect(out).not.toMatch(LONE_SURROGATE);
      }),
      { numRuns: 300 },
    );
  });
});

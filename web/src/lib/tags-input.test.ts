import { describe, expect, it } from "vitest";
import { formatTags, parseTags, reconcileTagsText } from "./tags-input";

/* Oracle: the Tags field of the link drawers (issue #752). The user types free
   text; the form value is the parsed array. The input must keep showing what
   was TYPED — a comma and a space are keystrokes, not noise to be re-derived
   away — while the saved value is the parsed list.

   Tag semantics come from what already consumes tags: the links filter is an
   exact `= any(tags)` match and the Analytics → Tags breakdown groups with
   `group by tag` (both case-sensitive), and the list page builds its tag
   options with `new Set(...)`. So "Spring" and "spring" are two tags. The
   helper only splits, trims and drops empty entries: it neither collapses
   inner whitespace nor removes repeats (out of scope for #752).
   packages/contract defines `tags` as `z.array(z.string())` with no length or
   count limit, so the helper adds none of its own. */

describe("parseTags", () => {
  it("splits on commas and trims each tag", () => {
    expect(parseTags("a, b")).toEqual(["a", "b"]);
    expect(parseTags("qa-tag1, qa-tag2")).toEqual(["qa-tag1", "qa-tag2"]);
    expect(parseTags("  a  ,b ,   c")).toEqual(["a", "b", "c"]);
  });

  it("keeps a space inside a tag", () => {
    expect(parseTags("spring sale")).toEqual(["spring sale"]);
    expect(parseTags("spring sale, summer sale")).toEqual(["spring sale", "summer sale"]);
  });

  it("keeps inner whitespace inside a tag exactly as typed (no collapsing)", () => {
    expect(parseTags("spring   sale")).toEqual(["spring   sale"]);
    expect(parseTags("spring\t sale")).toEqual(["spring\t sale"]);
    expect(parseTags("  spring   sale , b")).toEqual(["spring   sale", "b"]);
  });

  it("is empty for empty and whitespace-only input", () => {
    expect(parseTags("")).toEqual([]);
    expect(parseTags("   ")).toEqual([]);
    expect(parseTags(" \t \u00a0\u3000 ")).toEqual([]);
  });

  it("drops empty entries: leading, trailing, doubled and lone commas", () => {
    expect(parseTags("a,")).toEqual(["a"]);
    expect(parseTags(",a")).toEqual(["a"]);
    expect(parseTags("a,,b")).toEqual(["a", "b"]);
    expect(parseTags("a, , b")).toEqual(["a", "b"]);
    expect(parseTags(",")).toEqual([]);
    expect(parseTags(" , , ")).toEqual([]);
  });

  it("does not de-duplicate: repeated tags are kept as typed", () => {
    expect(parseTags("a, b, a")).toEqual(["a", "b", "a"]);
    expect(parseTags("a,a,a")).toEqual(["a", "a", "a"]);
    expect(parseTags("a b, a   b")).toEqual(["a b", "a   b"]);
  });

  it("treats tags that differ only by case as different tags (filter and analytics are case-sensitive)", () => {
    expect(parseTags("Spring, spring")).toEqual(["Spring", "spring"]);
  });

  it("keeps unicode and emoji intact", () => {
    expect(parseTags("café, 春セール, 🚀 launch, 👩🏽‍💻")).toEqual(["café", "春セール", "🚀 launch", "👩🏽‍💻"]);
  });

  it("parses a pasted list, including newline-separated lines", () => {
    expect(parseTags("alpha,beta,gamma,delta")).toEqual(["alpha", "beta", "gamma", "delta"]);
    expect(parseTags("alpha\nbeta\r\ngamma, delta")).toEqual(["alpha", "beta", "gamma", "delta"]);
  });

  it("keeps characters that are legal in a tag but are not separators", () => {
    expect(parseTags("campaign/spring, a;b, c|d, q3-2026, #hash")).toEqual([
      "campaign/spring",
      "a;b",
      "c|d",
      "q3-2026",
      "#hash",
    ]);
  });

  it("imposes no length or count limit of its own (the contract has none)", () => {
    const long = "x".repeat(500);
    expect(parseTags(long)).toEqual([long]);
    const many = Array.from({ length: 300 }, (_, i) => `t${i}`);
    expect(parseTags(many.join(","))).toEqual(many);
  });
});

describe("formatTags", () => {
  it("joins with a comma and a space", () => {
    expect(formatTags(["a", "b"])).toBe("a, b");
    expect(formatTags([])).toBe("");
    expect(formatTags(undefined)).toBe("");
  });

  it("round-trips through parseTags", () => {
    const tags = ["campaign/spring", "spring sale", "🚀"];
    expect(parseTags(formatTags(tags))).toEqual(tags);
  });
});

describe("reconcileTagsText", () => {
  it("keeps what the user typed while it still parses to the form value", () => {
    expect(reconcileTagsText("a, ", ["a"])).toBe("a, ");
    expect(reconcileTagsText("a,", ["a"])).toBe("a,");
    expect(reconcileTagsText("spring ", ["spring"])).toBe("spring ");
    expect(reconcileTagsText("", [])).toBe("");
  });

  it("re-renders from the form value when it was changed from outside (drawer reset / opened on another link)", () => {
    expect(reconcileTagsText("old, text", ["x", "y"])).toBe("x, y");
    expect(reconcileTagsText("leftover", [])).toBe("");
    expect(reconcileTagsText("leftover", undefined)).toBe("");
  });
});

describe("typing keystroke by keystroke (issue #752)", () => {
  /* What the field does on every keystroke: remember the raw text, publish the
     parsed list. The text shown must be the text typed so far — never derived
     from the parsed list. */
  function type(chars: string) {
    let text = "";
    let value: string[] = [];
    const shown: string[] = [];
    for (const ch of chars) {
      text = text + ch;
      value = parseTags(text);
      text = reconcileTagsText(text, value);
      shown.push(text);
    }
    return { text, value, shown };
  }

  it("a comma and the space after it survive being typed", () => {
    const { text, value, shown } = type("qa-tag1, qa-tag2");
    expect(shown[shown.length - 1]).toBe("qa-tag1, qa-tag2");
    expect(shown[6]).toBe("qa-tag1"); // 7 chars typed
    expect(shown[7]).toBe("qa-tag1,"); // the comma stays visible
    expect(shown[8]).toBe("qa-tag1, "); // and so does the space
    expect(text).toBe("qa-tag1, qa-tag2");
    expect(value).toEqual(["qa-tag1", "qa-tag2"]);
  });

  it("a space inside a tag can be typed", () => {
    const { text, value, shown } = type("spring sale");
    expect(shown[6]).toBe("spring "); // trailing space is not eaten
    expect(text).toBe("spring sale");
    expect(value).toEqual(["spring sale"]);
  });

  it("every intermediate text equals the typed prefix", () => {
    const typed = "a, b, spring sale, 🚀";
    const { shown } = type(typed);
    const prefixes = Array.from(typed).map((_, i) => Array.from(typed).slice(0, i + 1).join(""));
    expect(shown).toEqual(prefixes);
  });
});

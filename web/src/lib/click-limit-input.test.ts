import { describe, expect, it } from "vitest";
import {
  CLICK_LIMIT_MAX,
  clickLimitFromText,
  clickLimitProblem,
  parseClickLimit,
  reconcileClickLimitText,
} from "./click-limit-input";

/* Oracle: the "Click limit" field of the link drawers (issue #758).

   The field used to clamp on every keystroke (`"" -> 1`, `0 -> 1`, `-5 -> 5`), so
   a cleared field snapped back to "1" ("-5" typed as "-", "5" became "15"), and 0
   or a negative number was silently saved as 1. The field now keeps the text the
   user TYPED and this module decides, from that text alone, whether it is a valid
   click limit.

   What a valid limit is comes from what consumes it: `clickLimit` is stored in a
   Postgres `integer` column and the API treats `clicks >= clickLimit` as expired,
   so only a whole number from 1 to 2,147,483,647 (CLICK_LIMIT_MAX, the same bound
   packages/contract enforces) means anything. Having no limit is `null`, which the
   form expresses with the "Expire after a click limit" switch — an empty text box
   while that switch is on is an unfinished entry, not "no limit". */

describe("parseClickLimit — valid", () => {
  it.each([
    ["1", 1],
    ["5", 5],
    ["500", 500],
    ["42", 42],
    [String(CLICK_LIMIT_MAX), CLICK_LIMIT_MAX],
  ])("accepts %j as %d", (text, value) => {
    expect(parseClickLimit(text)).toEqual({ ok: true, value });
  });

  it("ignores spaces around the number (including non-breaking and ideographic spaces)", () => {
    expect(parseClickLimit("  7  ")).toEqual({ ok: true, value: 7 });
    expect(parseClickLimit("\u00a07\u3000")).toEqual({ ok: true, value: 7 });
  });

  it("reads leading zeros as the number they spell, not as octal", () => {
    expect(parseClickLimit("007")).toEqual({ ok: true, value: 7 });
    expect(parseClickLimit("010")).toEqual({ ok: true, value: 10 });
    expect(parseClickLimit("0001")).toEqual({ ok: true, value: 1 });
    expect(parseClickLimit("00002147483647")).toEqual({ ok: true, value: CLICK_LIMIT_MAX });
  });
});

describe("parseClickLimit — empty", () => {
  it.each([[""], ["   "], ["\t"], ["\u00a0\u3000"]])("rejects %j as empty", (text) => {
    const r = parseClickLimit(text);
    expect(r).toMatchObject({ ok: false, reason: "empty" });
  });
});

describe("parseClickLimit — below 1", () => {
  it.each([["0"], ["00"], ["000000"], ["-1"], ["-5"], ["-0"], ["-2147483648"], ["-99999999999999999999"]])(
    "rejects %j as too small",
    (text) => {
      expect(parseClickLimit(text)).toMatchObject({ ok: false, reason: "too-small" });
    },
  );
});

describe("parseClickLimit — above the maximum", () => {
  it.each([
    [String(CLICK_LIMIT_MAX + 1)],
    ["3000000000"],
    ["99999999999999999999999"],
    ["00000000000000000002147483648"],
    ["9".repeat(400)],
  ])("rejects %j as too large", (text) => {
    expect(parseClickLimit(text)).toMatchObject({ ok: false, reason: "too-large" });
  });
});

describe("parseClickLimit — not a whole number", () => {
  it.each([
    ["1.5"],
    ["2.0"],
    ["1."],
    [".5"],
    ["1,000"],
    ["1e3"],
    ["1E3"],
    ["1e+3"],
    ["abc"],
    ["12abc"],
    ["1 0"],
    ["-"],
    ["+"],
    ["+5"],
    ["--5"],
    ["5-"],
    ["0x10"],
    ["Infinity"],
    ["NaN"],
    ["٣"], // Arabic-indic digit three
    ["５"], // fullwidth digit five
    ["🚀"],
  ])("rejects %j as not a whole number", (text) => {
    expect(parseClickLimit(text)).toMatchObject({ ok: false, reason: "not-a-number" });
  });
});

describe("parseClickLimit — messages", () => {
  it("every rejection carries a plain-language message with no field names or zod strings", () => {
    for (const text of ["", "0", "-5", "1.5", "1e3", "abc", "99999999999"]) {
      const r = parseClickLimit(text);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.message.length).toBeGreaterThan(8);
        expect(r.message).not.toMatch(/clickLimit|Expected|received|invalid_type|NaN/);
      }
    }
  });

  it("says something different for each kind of mistake", () => {
    const messages = new Set(["", "0", "1.5", "99999999999"].map((t) => (parseClickLimit(t) as { message: string }).message));
    expect(messages.size).toBe(4);
  });
});

describe("clickLimitFromText — what the form holds", () => {
  it("is the number once the text is valid", () => {
    expect(clickLimitFromText("42")).toBe(42);
    expect(clickLimitFromText(" 007 ")).toBe(7);
  });

  it("is the raw text while it is not valid, so it survives a re-render and a tab switch", () => {
    expect(clickLimitFromText("")).toBe("");
    expect(clickLimitFromText("-")).toBe("-");
    expect(clickLimitFromText("0")).toBe("0");
    expect(clickLimitFromText("1e3")).toBe("1e3");
    expect(clickLimitFromText("2.5")).toBe("2.5");
  });
});

describe("clickLimitProblem — the problem with a form value", () => {
  it("is undefined for no limit and for a valid number", () => {
    expect(clickLimitProblem(null)).toBeUndefined();
    expect(clickLimitProblem(undefined)).toBeUndefined();
    expect(clickLimitProblem(1)).toBeUndefined();
    expect(clickLimitProblem(CLICK_LIMIT_MAX)).toBeUndefined();
  });

  it("describes raw text that is not valid", () => {
    expect(clickLimitProblem("")).toMatch(/click limit/i);
    expect(clickLimitProblem("0")).toBe(parseClickLimit("0").ok ? undefined : (parseClickLimit("0") as { message: string }).message);
    expect(clickLimitProblem("1e3")).toBeDefined();
  });

  it("describes a stored number that is out of range (a link saved before the field was validated)", () => {
    expect(clickLimitProblem(0)).toBeDefined();
    expect(clickLimitProblem(-3)).toBeDefined();
    expect(clickLimitProblem(2.5)).toBeDefined();
    expect(clickLimitProblem(CLICK_LIMIT_MAX + 1)).toBeDefined();
    expect(clickLimitProblem(Number.NaN)).toBeDefined();
  });

  it("treats raw text that is valid as no problem", () => {
    expect(clickLimitProblem("12")).toBeUndefined();
  });
});

describe("reconcileClickLimitText — what the input shows", () => {
  it("shows the raw text the form holds while it is not valid", () => {
    expect(reconcileClickLimitText("anything", "")).toBe("");
    expect(reconcileClickLimitText("", "-")).toBe("-");
    expect(reconcileClickLimitText("", "1e3")).toBe("1e3");
  });

  it("keeps what was typed while it still spells the form's number", () => {
    expect(reconcileClickLimitText("007", 7)).toBe("007");
    expect(reconcileClickLimitText(" 7 ", 7)).toBe(" 7 ");
  });

  it("shows the form's number when the typed text is stale (form reset, toggled on, another link opened)", () => {
    expect(reconcileClickLimitText("", 500)).toBe("500");
    expect(reconcileClickLimitText("12", 500)).toBe("500");
    expect(reconcileClickLimitText("abc", 500)).toBe("500");
  });

  it("is empty when there is no limit", () => {
    expect(reconcileClickLimitText("12", null)).toBe("");
    expect(reconcileClickLimitText("12", undefined)).toBe("");
  });

  it("shows a stored out-of-range number as it is, so the user can see what to fix", () => {
    expect(reconcileClickLimitText("", 0)).toBe("0");
    expect(reconcileClickLimitText("", -3)).toBe("-3");
  });
});

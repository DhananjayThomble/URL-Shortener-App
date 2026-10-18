import { CLICK_LIMIT_MAX } from "@snapurl/contract";

/* Pure helpers for the "Click limit" field of the create/edit link drawers (issue #758).

   The field used to clamp on every keystroke
   (`onChange(e.target.value === "" ? 1 : Math.max(1, Math.floor(Number(...))))`), so
   a cleared field snapped back to "1" — typing "-5" gave "15" — and 0 or a negative
   number was silently saved as 1.

   The field now keeps the text the user TYPED. While that text is a valid limit the
   form value is the number; while it is not, the form value is the raw text itself.
   Holding the raw text in the form (rather than in component state) is what lets it
   survive a tab switch, which unmounts the field, and is what makes the contract's
   `ClickLimitInput` reject the submit with a message instead of the form silently
   rewriting it. Nothing is ever "fixed up" behind the user's back, except spaces
   around the number and leading zeros, which are cosmetic ("007" -> 7).

   "No limit" is `null`, expressed by the "Expire after a click limit" switch: an
   EMPTY box while that switch is on is an unfinished entry (it blocks the save), not
   "no limit" — turning the switch off is how to remove the limit. */

export { CLICK_LIMIT_MAX };

export type ClickLimitProblem = "empty" | "not-a-number" | "too-small" | "too-large";

export type ClickLimitParse = { ok: true; value: number } | { ok: false; reason: ClickLimitProblem; message: string };

const MESSAGES: Record<ClickLimitProblem, string> = {
  empty: "Enter a click limit, or turn the limit off above.",
  "not-a-number": "Use a whole number, like 100 (digits only).",
  "too-small": "The click limit must be at least 1.",
  "too-large": `The click limit can't be more than ${CLICK_LIMIT_MAX.toLocaleString("en-US")}.`,
};

const fail = (reason: ClickLimitProblem): ClickLimitParse => ({ ok: false, reason, message: MESSAGES[reason] });

/** The digits of a whole number with its leading zeros dropped ("" -> "0"), as a number or "too large". */
function magnitude(digits: string): number | "too-large" {
  const trimmed = digits.replace(/^0+/, "");
  if (trimmed === "") return 0;
  if (trimmed.length > String(CLICK_LIMIT_MAX).length) return "too-large"; // never goes through Number(): no precision games
  const n = Number(trimmed);
  return n > CLICK_LIMIT_MAX ? "too-large" : n;
}

/** Text typed into the field -> the click limit it spells, or why it is not one. */
export function parseClickLimit(text: string): ClickLimitParse {
  const t = text.trim();
  if (t === "") return fail("empty");
  // Plain ASCII digits with an optional leading minus. No "+", ".", "e", "," or spaces inside.
  const m = /^(-?)([0-9]+)$/.exec(t);
  if (!m) return fail("not-a-number");
  const [, minus, digits] = m;
  if (minus) return fail("too-small"); // -5, and -0: there is no negative click limit
  const n = magnitude(digits);
  if (n === "too-large") return fail("too-large");
  return n < 1 ? fail("too-small") : { ok: true, value: n };
}

/** What the form holds for this text: the number when it is a valid limit, otherwise the raw text. */
export function clickLimitFromText(text: string): number | string {
  const parsed = parseClickLimit(text);
  return parsed.ok ? parsed.value : text;
}

/**
 * The problem with the form's value, in words for the user — or undefined when there
 * is none. A number can be out of range too: a link saved before the API checked the
 * limit may carry 0 or a negative one, and the field must say so rather than hide it.
 */
export function clickLimitProblem(value: number | string | null | undefined): string | undefined {
  if (value == null) return undefined;
  if (typeof value === "string") {
    const parsed = parseClickLimit(value);
    return parsed.ok ? undefined : parsed.message;
  }
  if (!Number.isInteger(value)) return MESSAGES["not-a-number"];
  if (value < 1) return MESSAGES["too-small"];
  if (value > CLICK_LIMIT_MAX) return MESSAGES["too-large"];
  return undefined;
}

/**
 * The text the field should show. The form's raw text while it is not a valid limit
 * (it IS what the user typed); otherwise what the user typed, for as long as it still
 * spells the form's number ("007" stays "007" until they leave the field); otherwise
 * the form's own value — the form was reset, the limit was switched on, or another
 * link opened, so the typed text is stale.
 */
export function reconcileClickLimitText(text: string, value: number | string | null | undefined): string {
  if (value == null) return "";
  if (typeof value === "string") {
    const parsed = parseClickLimit(value);
    return parsed.ok ? text : value;
  }
  const typed = parseClickLimit(text);
  return typed.ok && typed.value === value ? text : String(value);
}

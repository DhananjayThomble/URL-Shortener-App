/* #761 — when do the New link / Edit link drawers ask before closing?

   Esc, a click on the backdrop, the ✕ and Cancel all dismiss a drawer whose form
   is thrown away on the next open, so a half-written link vanished with no way
   back. These are the pure decisions behind the shared confirmation; the
   components just wire them to events (kept UI-free so Node-only tests cover them). */

/** Nothing the user would miss: unset, empty text, or an empty list/object of the same. */
function prune(value: unknown): unknown {
  if (value === undefined || value === null || value === "") return undefined;
  if (Array.isArray(value)) {
    const kept = value.map(prune).filter((v) => v !== undefined);
    return kept.length > 0 ? kept : undefined;
  }
  if (typeof value === "object") {
    const kept = Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => [k, prune(v)] as const)
      .filter(([, v]) => v !== undefined);
    return kept.length > 0 ? Object.fromEntries(kept) : undefined;
  }
  return value;
}

function same(a: unknown, b: unknown): boolean {
  if (a === undefined || b === undefined) return a === b;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => same(v, b[i]));
  }
  if (a && b && typeof a === "object" && typeof b === "object") {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => k in b && same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return Object.is(a, b);
}

/**
 * Whether the form's current values differ from the ones it was opened with.
 *
 * Deliberately NOT react-hook-form's `isDirty` / `dirtyFields`: the moment any one field is
 * edited RHF re-derives every field's dirtiness from the whole form, and a text input the
 * user never touched reads back `""` where its default is `undefined` (see
 * blankOptionalUrlsToUndefined), so a form the user typed into and emptied again still
 * counted as changed. Here "unset", `null`, `""`, `[]` and `{}` are all the same thing —
 * nothing to lose — and anything else must match. Whitespace is not trimmed: typing a
 * space is typing.
 */
export function formValuesChanged(baseline: unknown, current: unknown): boolean {
  return !same(prune(baseline), prune(current));
}

export type CloseAction = "close" | "ask" | "ignore";

/**
 * What a request to close the drawer should do.
 *  - `ask`    — there is something to lose: show the confirmation instead of closing.
 *  - `close`  — nothing to lose: close at once, exactly as before.
 *  - `ignore` — the confirmation is already on screen (it owns Esc/backdrop itself).
 */
export function closeAction(dirty: boolean, confirming: boolean): CloseAction {
  if (confirming) return "ignore";
  return dirty ? "ask" : "close";
}

/** The confirmation's words. Neutral about the mutation: nothing was created or saved yet. */
export const DISCARD_COPY = {
  create: {
    title: "Discard this link?",
    body: "This link hasn’t been created yet. If you close now, what you’ve typed is lost.",
  },
  edit: {
    title: "Discard your changes?",
    body: "This link hasn’t been updated yet. If you close now, your edits are lost.",
  },
  confirmLabel: "Discard",
  cancelLabel: "Keep editing",
} as const;

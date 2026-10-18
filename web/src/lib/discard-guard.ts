/* #761 — when do the New link / Edit link drawers ask before closing?

   Esc, a click on the backdrop, the ✕ and Cancel all dismiss a drawer whose form
   is thrown away on the next open, so a half-written link vanished with no way
   back. These are the pure decisions behind the shared confirmation; the
   components just wire them to events (kept UI-free so Node-only tests cover them). */

/**
 * Whether react-hook-form's `formState.dirtyFields` names at least one field that
 * differs from its default value.
 *
 * RHF keeps a field's flag only while its value differs from the default (typing
 * something and then putting the original back removes it again), so "anything
 * flagged" is exactly "the user has changed something and not undone it" — which
 * is what `isDirty` would say, minus its comparison of the WHOLE value against the
 * defaults (the drawer seeds the back-half domain and redirect type after it
 * opens, and `isDirty` counts those programmatic values against the user).
 * Nested objects (utm, social, rules) and arrays (tags) are walked.
 */
export function hasDirtyFields(dirtyFields: unknown): boolean {
  if (dirtyFields === true) return true;
  if (Array.isArray(dirtyFields)) return dirtyFields.some(hasDirtyFields);
  if (dirtyFields && typeof dirtyFields === "object") return Object.values(dirtyFields).some(hasDirtyFields);
  return false;
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

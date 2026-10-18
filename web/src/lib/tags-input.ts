/* Pure helpers for the Tags field of the create/edit link drawers (issue #752).

   The field used to be controlled FROM the parsed array
   (`value={tags.join(", ")}`, `onChange` -> split/trim/filter), so every
   keystroke was re-derived from the parsed list: a typed "," produced an empty
   entry that the filter dropped, and the input snapped back to "a" — the comma
   (and the space after it) could never be typed, and "a, b" was saved as "ab".

   The field now keeps the raw text the user typed and publishes
   `parseTags(text)` as the form value. `reconcileTagsText` is the one place
   that decides whether the raw text still describes the form value.

   Scope is deliberately minimal: split on separators, trim each entry, drop
   empty entries. Nothing else about a tag is rewritten — tag values are
   compared exactly (case-sensitive) by the rest of the system, inner
   whitespace is kept as typed, and repeats are not removed.
   packages/contract has no length or count limit on `tags`
   (`z.array(z.string())`), so none is imposed here. */

/** Separators: a comma, or a line break (pasting a list one-per-line). */
const SEPARATOR = /[,\r\n]/;

/** Text typed into the field -> the tags it describes. */
export function parseTags(text: string): string[] {
  return text
    .split(SEPARATOR)
    .map((part) => part.trim())
    .filter((tag) => tag !== "");
}

/** Tags -> the text to show for them. */
export function formatTags(tags: readonly string[] | undefined | null): string {
  return (tags ?? []).join(", ");
}

/**
 * The text the field should show: what the user typed while it still parses to
 * the form value, otherwise the form value itself (the form was reset or opened
 * on another link, so the typed text is stale).
 */
export function reconcileTagsText(text: string, value: readonly string[] | undefined | null): string {
  const tags = value ?? [];
  const parsed = parseTags(text);
  const same = parsed.length === tags.length && parsed.every((t, i) => t === tags[i]);
  return same ? text : formatTags(tags);
}

/* Mirrors CreateLinkInput.slug in packages/contract/src/link.ts — a comma-tail
   is only treated as a chosen back-half if it could actually be one. */
const SLUG_PATTERN = /^[a-zA-Z0-9._-]+$/;

/* A user-chosen back-half is written as "<destination>, <slug>" — every
   example in this panel's own placeholder and help text puts a space after
   the separating comma. A destination's query string can also contain
   commas (`?tags=a,b,c`), but never a comma immediately followed by
   whitespace, since URLs have no unencoded whitespace. Requiring that space
   is what tells the two apart, so only a comma-space pair is treated as the
   separator — a bare comma is just part of the destination. */
const SLUG_SEPARATOR = /, +(\S[\s\S]*)$/;

/**
 * One input line becomes one link.
 *
 * `https://example.com/a, spring` — everything before the *last* ", " is the
 * destination, and the tail is the back-half you want, but only if that tail
 * actually looks like a legal slug. Without a comma-space separator, or
 * without a slug-shaped tail after it, the server generates a back-half and
 * the whole line is the destination — this is what keeps a destination with
 * commas in its query string (`?tags=a,b,c`) from being truncated.
 */
export function parseRows(text: string): Array<{ destination: string; slug?: string }> {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(SLUG_SEPARATOR);
      if (!match) return { destination: line };
      const slug = match[1].trim();
      if (!SLUG_PATTERN.test(slug)) return { destination: line };
      return { destination: line.slice(0, match.index).trim(), slug };
    });
}

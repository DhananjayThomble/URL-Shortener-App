/* Escape a user-typed term for use inside a LIKE / ILIKE pattern.

   `%` and `_` are wildcards and backslash is Postgres's default escape
   character, so each is prefixed with a backslash and the term then matches
   literally. Pair every pattern built from this with an explicit
   `escape '\'` so the behaviour does not rest on the default. */
export function escapeLike(term: string): string {
  return term.replace(/[\\%_]/g, "\\$&");
}

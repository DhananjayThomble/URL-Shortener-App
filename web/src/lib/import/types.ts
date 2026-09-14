/**
 * The importer core, source-agnostic.
 *
 * A "source" (Bitly, YOURLS, Kutt, Dub, or the generic CSV shipped here) knows
 * how to turn one exported file into a list of {@link MappedRow}. Everything
 * after that — chunking to the /links/bulk 100-row cap, applying the workspace
 * domain, mapping to CreateLinkInput, surfacing skips and dropped fields — is
 * shared and lives in `to-links.ts`. A new source is therefore just a parser,
 * never a re-implementation of the submit pipeline.
 */

/** One link as extracted from a source export, before it becomes a
 *  CreateLinkInput. Only the fields SnapURL has a home for are carried; a
 *  source drops the rest and reports them via {@link ParseResult.dropped}. */
export interface MappedRow {
  /** The long/destination URL. Required — a row without one is a parse error. */
  destination: string;
  /** The desired back-half. Empty/omitted ⇒ the server generates one.
   *  On collision with an existing link the server SKIPS the row (approved
   *  policy Q1) and we surface it; there is no overwrite path. */
  slug?: string;
  /** Source "title"/"name" → SnapURL `comment` (≤280, truncated), flagged
   *  approximate. SnapURL has no top-level title field. */
  title?: string;
  /** Free-form tags. */
  tags?: string[];
  /** An ISO-8601 expiry, when the source carries one (Kutt, Dub). SnapURL has
   *  an `expiresAt` field; a source's created-at has no home and is dropped. */
  expiresAt?: string;
  /** The 0-based row number in the source file, for error attribution. */
  sourceIndex: number;
}

/** A field present in the source export that SnapURL cannot store, surfaced to
 *  the user before they commit so nothing is silently lost. */
export interface DroppedField {
  field: string;
  reason: string;
}

/** A row that could not be parsed into a {@link MappedRow} at all (e.g. no
 *  destination, malformed URL shape). Kept separate from the server's per-row
 *  outcomes: these never reach the API. */
export interface ParseError {
  sourceIndex: number;
  message: string;
}

export interface ParseResult {
  rows: MappedRow[];
  /** Distinct fields dropped on import, deduped across all rows. */
  dropped: DroppedField[];
  /** Rows the parser rejected before submit. */
  errors: ParseError[];
}

/** A competitor export format the importer understands. */
export interface ImportSource {
  /** Stable id used in the UI select and in tests. */
  id: string;
  /** Human label shown in the source picker. */
  label: string;
  /** One line describing what file this source expects. */
  hint: string;
  /** Parse the raw file text into mapped rows + dropped-field notices. Pure:
   *  no network, no DOM. */
  parse(text: string): ParseResult;
}

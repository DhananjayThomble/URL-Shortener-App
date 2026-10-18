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
  return parseBulkRows(text).map(({ destination, slug }) => (slug === undefined ? { destination } : { destination, slug }));
}

/** A parsed row plus the trimmed input line it came from, so the rows that
 *  must be tried again can be put back into the box exactly as the user wrote
 *  them. */
export type BulkRow = { line: string; destination: string; slug?: string };

/** `parseRows`, keeping each row's source line. Same row order and the same
 *  blank-line handling, so index N here is index N of the submitted batch. */
export function parseBulkRows(text: string): BulkRow[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(SLUG_SEPARATOR);
      if (!match) return { line, destination: line };
      const slug = match[1].trim();
      if (!SLUG_PATTERN.test(slug)) return { line, destination: line };
      return { line, destination: line.slice(0, match.index).trim(), slug };
    });
}

/** What the API said about one submitted row (the shape of `BulkLinkOutcome`
 *  that matters here). */
export type RowOutcome = { index: number; ok: boolean };

/**
 * The rows a second submit may send: every row that did NOT come back created.
 *
 * Why this exists (#755): the API can only recognise an already-created row by
 * its back-half, and a row with no slug gets a freshly generated one on every
 * request — so resending the whole box after a partial success created every
 * slug-less row a second time. The fix is to never resend a row that already
 * succeeded.
 *
 * Rows are matched to outcomes by their position in the submitted batch
 * (`index`), never by destination text, so two lines with the same
 * destination — legitimately two links — are told apart. A row the response
 * says nothing about is kept: dropping it would lose the user's input.
 * Outcomes pointing outside the batch are ignored, and if a response ever
 * reports one index twice, a success wins (a created row must not be resent).
 */
export function rowsToResubmit(
  rows: readonly BulkRow[],
  outcomes: readonly RowOutcome[],
): Array<{ row: BulkRow; index: number }> {
  const created = new Set<number>();
  for (const o of outcomes) if (o.ok) created.add(o.index);
  const remaining: Array<{ row: BulkRow; index: number }> = [];
  rows.forEach((row, index) => {
    if (!created.has(index)) remaining.push({ row, index });
  });
  return remaining;
}

/** The box contents that make a plain resubmit send only `rowsToResubmit`. */
export function resubmitText(rows: readonly BulkRow[], outcomes: readonly RowOutcome[]): string {
  return rowsToResubmit(rows, outcomes)
    .map((r) => r.row.line)
    .join("\n");
}

/** The part of `BulkLinkOutcome` the report reads (kept structural so this
 *  file does not depend on the contract package). */
export type BulkOutcome =
  | { ok: true; index: number; link: { domain: string; slug: string } }
  | { ok: false; index: number; destination: string; error: string };

export type BulkReportItem =
  | { kind: "created"; domain: string; slug: string }
  /** `line` is the row's line number in the box AFTER the resubmit text is put
   *  back (1-based), so "Line 2" points at what the user will see. */
  | { kind: "failed"; line: number; destination: string; error: string };

export type BulkReport = { created: number; failed: number; items: BulkReportItem[] };

/** Shown for a row the response did not mention. It is kept in the box rather
 *  than dropped, but it may already exist, so the user is told to look first. */
export const UNREPORTED_ROW_ERROR = "No result came back for this row. Check the links list before sending it again.";

/**
 * Everything the panel needs after a response: the text to put back into the
 * box (`rowsToResubmit`'s rows, as typed) and one report item per submitted
 * row, in submitted order. Failed rows are numbered by their place in the new
 * text, because the created rows no longer appear in it.
 */
export function summarizeBulkResult(
  batch: readonly BulkRow[],
  outcomes: readonly BulkOutcome[],
): { text: string; report: BulkReport } {
  const byIndex = new Map<number, BulkOutcome>();
  for (const o of outcomes) {
    if (o.index < 0 || o.index >= batch.length) continue;
    const prev = byIndex.get(o.index);
    // A success wins, as in rowsToResubmit.
    if (!prev || (o.ok && !prev.ok)) byIndex.set(o.index, o);
  }
  const remaining = rowsToResubmit(batch, outcomes);
  const lineOf = new Map(remaining.map((r, i) => [r.index, i + 1]));

  const items: BulkReportItem[] = [];
  for (let index = 0; index < batch.length; index++) {
    const o = byIndex.get(index);
    if (o?.ok) {
      items.push({ kind: "created", domain: o.link.domain, slug: o.link.slug });
    } else {
      items.push({
        kind: "failed",
        line: lineOf.get(index)!,
        destination: (o && o.destination) || batch[index]!.destination,
        error: o ? o.error : UNREPORTED_ROW_ERROR,
      });
    }
  }
  const created = items.filter((i) => i.kind === "created").length;
  return {
    text: remaining.map((r) => r.row.line).join("\n"),
    report: { created, failed: items.length - created, items },
  };
}

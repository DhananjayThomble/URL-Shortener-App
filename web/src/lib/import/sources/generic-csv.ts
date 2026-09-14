import { parseCsvRecords, pick } from "../csv";
import type { ImportSource, MappedRow, ParseError } from "../types";

/**
 * The built-in "any CSV" source.
 *
 * Matches broadly-named columns so a hand-rolled or unfamiliar export still
 * imports: it looks for a long-URL column, an optional back-half column, an
 * optional title column and an optional tags column, under the header names
 * those fields most commonly carry. Per-source importers (Bitly, YOURLS, …)
 * layer their exact header sets on top of the same machinery in later PRs.
 */
const DESTINATION_ALIASES = [
  "long url",
  "original url",
  "destination url",
  "destination",
  "target url",
  "target",
  "url",
];
const SLUG_ALIASES = ["back half", "back-half", "keyword", "short code", "slug", "key", "alias", "address"];
const TITLE_ALIASES = ["title", "name", "description"];
const TAG_ALIASES = ["tags", "labels"];

function splitTags(raw: string): string[] {
  return raw
    .split(/[,;|]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

export const genericCsv: ImportSource = {
  id: "generic-csv",
  label: "Generic CSV",
  hint: "Any CSV with a long-URL column (and optionally a back-half, title and tags column).",
  parse(text) {
    const records = parseCsvRecords(text);
    const rows: MappedRow[] = [];
    const errors: ParseError[] = [];

    records.forEach((rec, i) => {
      const destination = pick(rec, DESTINATION_ALIASES);
      if (!destination) {
        errors.push({ sourceIndex: i, message: "No destination URL column found in this row." });
        return;
      }
      const slug = pick(rec, SLUG_ALIASES);
      const title = pick(rec, TITLE_ALIASES);
      const tagsRaw = pick(rec, TAG_ALIASES);
      rows.push({
        destination,
        ...(slug ? { slug } : {}),
        ...(title ? { title } : {}),
        ...(tagsRaw ? { tags: splitTags(tagsRaw) } : {}),
        sourceIndex: i,
      });
    });

    return { rows, errors, dropped: standardDropped(records) };
  },
};

/**
 * The fields SnapURL cannot store, reported only when the export actually
 * carried them. Keeps the notice honest — a CSV without a "clicks" column
 * doesn't claim clicks were dropped.
 */
export function standardDropped(records: Array<Record<string, string>>) {
  const dropped: { field: string; reason: string }[] = [];
  const has = (aliases: string[]) => records.some((r) => aliases.some((a) => r[a] !== undefined && r[a] !== ""));
  if (has(["created", "created at", "date", "timestamp", "created date"])) {
    dropped.push({ field: "Original created date", reason: "Imported links are dated at import time." });
  }
  if (has(["clicks", "total clicks", "visit count", "visits"])) {
    dropped.push({ field: "Click history", reason: "Historical click counts are not imported." });
  }
  return dropped;
}

/**
 * A small RFC 4180-ish CSV reader.
 *
 * Deliberately hand-rolled rather than a dependency: importer exports are
 * comma-separated with double-quote escaping, and the one thing a naive
 * `split(",")` gets wrong — destinations and titles containing commas inside
 * quoted fields — is exactly what these files are full of. Handles:
 *   - quoted fields with embedded commas, newlines and "" escaped quotes
 *   - CRLF or LF line endings
 *   - a trailing newline
 * It does NOT try to guess delimiters or encodings; every supported source
 * exports comma-delimited UTF-8.
 */

/** Parse CSV text into rows of string cells. Empty input ⇒ no rows. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  let sawAny = false;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    sawAny = true;

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++; // consume the escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      pushField();
    } else if (c === "\r") {
      // Swallow; the \n (or a lone \r treated as EOL) ends the row.
      if (text[i + 1] === "\n") i++;
      pushRow();
    } else if (c === "\n") {
      pushRow();
    } else {
      field += c;
    }
  }

  // Flush a final field/row if the file did not end on a newline, or if it had
  // any content at all on the last (unterminated) line.
  if (field.length > 0 || row.length > 0) {
    pushRow();
  } else if (!sawAny) {
    return [];
  }

  // Drop a trailing fully-empty row produced by a file ending in a newline.
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

/** Normalize a header cell for alias matching: lowercase, trim, collapse
 *  internal whitespace and underscores/dashes to a single space. */
export function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[\s_-]+/g, " ");
}

/**
 * Parse CSV into records keyed by normalized headers.
 * The first non-empty row is the header. Returns [] when there is no data row.
 */
export function parseCsvRecords(text: string): Array<Record<string, string>> {
  const rows = parseCsv(text);
  if (rows.length < 2) return [];
  const headers = rows[0]!.map(normalizeHeader);
  return rows.slice(1).map((cells) => {
    const rec: Record<string, string> = {};
    headers.forEach((h, i) => {
      // Later columns with a duplicate header do not clobber the first.
      if (!(h in rec)) rec[h] = (cells[i] ?? "").trim();
    });
    return rec;
  });
}

/**
 * Pick the first present value among a set of candidate normalized-header
 * aliases. Returns "" when none match — callers decide whether that is fatal.
 */
export function pick(rec: Record<string, string>, aliases: string[]): string {
  for (const a of aliases) {
    const v = rec[normalizeHeader(a)];
    if (v !== undefined && v !== "") return v;
  }
  return "";
}

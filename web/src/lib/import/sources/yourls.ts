import { parseCsvRecords, pick } from "../csv";
import type { ImportSource, MappedRow, ParseError } from "../types";

/**
 * YOURLS CSV export (admin Tools → Export → CSV).
 *
 * Columns are: keyword, url, title, timestamp, ip, clicks. Unlike Bitly, the
 * `keyword` is a BARE back-half (e.g. "promo"), not a full short URL, so it maps
 * straight to slug. YOURLS has no tags concept.
 *
 * Dropped: timestamp (created date), clicks, ip.
 */
const URL_ALIASES = ["url", "long url", "original url"];
const KEYWORD_ALIASES = ["keyword", "short code", "shorturl", "short url", "slug"];
const TITLE_ALIASES = ["title"];

export const yourls: ImportSource = {
  id: "yourls",
  label: "YOURLS",
  hint: "YOURLS CSV export (keyword, url, title columns).",
  parse(text) {
    const records = parseCsvRecords(text);
    const rows: MappedRow[] = [];
    const errors: ParseError[] = [];

    records.forEach((rec, i) => {
      const destination = pick(rec, URL_ALIASES);
      if (!destination) {
        errors.push({ sourceIndex: i, message: "This row has no long URL — YOURLS exports it as the 'url' column." });
        return;
      }
      const slug = pick(rec, KEYWORD_ALIASES);
      const title = pick(rec, TITLE_ALIASES);
      rows.push({
        destination,
        ...(slug ? { slug } : {}),
        ...(title ? { title } : {}),
        sourceIndex: i,
      });
    });

    const has = (aliases: string[]) => records.some((r) => aliases.some((a) => r[a] !== undefined && r[a] !== ""));
    const dropped: { field: string; reason: string }[] = [];
    if (has(["timestamp", "created", "date"])) dropped.push({ field: "Timestamp", reason: "Imported links are dated at import time." });
    if (has(["clicks"])) dropped.push({ field: "Clicks", reason: "Historical click counts are not imported." });
    if (has(["ip"])) dropped.push({ field: "Creator IP", reason: "YOURLS records the creator IP; SnapURL does not import it." });

    return { rows, errors, dropped };
  },
};

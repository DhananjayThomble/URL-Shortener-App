import { parseCsvRecords, pick, slugFromShortUrl } from "../csv";
import type { ImportSource, MappedRow, ParseError } from "../types";

/**
 * Bitly CSV export.
 *
 * The dashboard's "Export" of a group's Bitlinks produces columns along the
 * lines of: Bitlink, Title, Long URL, Tags, Created, Total Clicks, Campaign,
 * Archived. Column names vary a little by account/plan, so each field is matched
 * against a small alias set.
 *
 * Bitly-specific vs the generic source:
 *   - the short link ("Bitlink") is a FULL short URL, so the back-half is its
 *     last path segment, not the cell verbatim.
 *   - the long URL is "Long URL" / "Original URL".
 *   - Total Clicks, Created, Campaign, Group, Archived have no SnapURL home and
 *     are dropped (Campaign is not folded into tags — it is a Bitly grouping,
 *     not a label).
 */
const LONG_URL_ALIASES = ["long url", "original url", "long link"];
const BITLINK_ALIASES = ["bitlink", "short url", "short link", "bitlink id"];
const TITLE_ALIASES = ["title", "name"];
const TAG_ALIASES = ["tags", "labels"];

function splitTags(raw: string): string[] {
  return raw
    .split(/[,;|]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

export const bitly: ImportSource = {
  id: "bitly",
  label: "Bitly",
  hint: "Bitly CSV export (Bitlink, Long URL, Title, Tags columns).",
  parse(text) {
    const records = parseCsvRecords(text);
    const rows: MappedRow[] = [];
    const errors: ParseError[] = [];

    records.forEach((rec, i) => {
      const destination = pick(rec, LONG_URL_ALIASES);
      if (!destination) {
        errors.push({ sourceIndex: i, message: "This row has no Long URL — Bitly exports it as the 'Long URL' column." });
        return;
      }
      const slug = slugFromShortUrl(pick(rec, BITLINK_ALIASES));
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

    const has = (aliases: string[]) => records.some((r) => aliases.some((a) => r[a] !== undefined && r[a] !== ""));
    const dropped: { field: string; reason: string }[] = [];
    if (has(["created", "created at", "date"])) dropped.push({ field: "Created date", reason: "Imported links are dated at import time." });
    if (has(["total clicks", "clicks"])) dropped.push({ field: "Total clicks", reason: "Historical click counts are not imported." });
    if (has(["campaign", "group", "channel"])) dropped.push({ field: "Campaign / group", reason: "Bitly campaigns and groups have no SnapURL equivalent." });

    return { rows, errors, dropped };
  },
};

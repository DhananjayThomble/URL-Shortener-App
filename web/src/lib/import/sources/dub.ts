import { parseCsvRecords, pick, slugFromShortUrl } from "../csv";
import type { ImportSource, MappedRow, ParseError } from "../types";

/**
 * Dub CSV export.
 *
 * Dub's export gives columns along the lines of: Short link (or Domain + Key),
 * Destination URL / URL, Title, Description, Tags, Created At, Clicks, Archived,
 * Folder.
 *
 * Dub-specific vs the generic source:
 *   - the back-half is the `Key` column when present (a bare back-half); if only
 *     a full `Short link` URL is exported, its last path segment is used
 *     (shared slugFromShortUrl, as with Bitly).
 *   - `Description` maps to social.description (the OG card), distinct from
 *     `Title` which maps to comment.
 *   - Created At, Clicks, Archived, Folder are dropped.
 */
const URL_ALIASES = ["destination url", "url", "long url", "destination", "target"];
const KEY_ALIASES = ["key", "short link key", "back half", "slug"];
const SHORTLINK_ALIASES = ["short link", "shortlink", "link"];
const TITLE_ALIASES = ["title"];
const DESC_ALIASES = ["description"];
const TAG_ALIASES = ["tags", "labels"];

function splitTags(raw: string): string[] {
  return raw
    .split(/[,;|]/)
    .map((t) => t.trim())
    .filter(Boolean);
}

export const dub: ImportSource = {
  id: "dub",
  label: "Dub",
  hint: "Dub CSV export (Destination URL, Key or Short link, Title, Description, Tags).",
  parse(text) {
    const records = parseCsvRecords(text);
    const rows: MappedRow[] = [];
    const errors: ParseError[] = [];

    records.forEach((rec, i) => {
      const destination = pick(rec, URL_ALIASES);
      if (!destination) {
        errors.push({ sourceIndex: i, message: "This row has no destination URL — Dub exports it as the 'Destination URL' column." });
        return;
      }
      // Prefer the bare Key; fall back to the last segment of a full Short link.
      const key = pick(rec, KEY_ALIASES);
      const slug = key || slugFromShortUrl(pick(rec, SHORTLINK_ALIASES));
      const title = pick(rec, TITLE_ALIASES);
      const description = pick(rec, DESC_ALIASES);
      const tagsRaw = pick(rec, TAG_ALIASES);
      rows.push({
        destination,
        ...(slug ? { slug } : {}),
        ...(title ? { title } : {}),
        ...(description ? { description } : {}),
        ...(tagsRaw ? { tags: splitTags(tagsRaw) } : {}),
        sourceIndex: i,
      });
    });

    const has = (aliases: string[]) => records.some((r) => aliases.some((a) => r[a] !== undefined && r[a] !== ""));
    const dropped: { field: string; reason: string }[] = [];
    if (has(["created at", "createdat", "created", "date"])) dropped.push({ field: "Created date", reason: "Imported links are dated at import time." });
    if (has(["clicks"])) dropped.push({ field: "Clicks", reason: "Historical click counts are not imported." });
    if (has(["archived"])) dropped.push({ field: "Archived flag", reason: "Dub's archived status is not imported." });
    if (has(["folder", "folderid", "folder id"])) dropped.push({ field: "Folder", reason: "Dub folders have no SnapURL equivalent on import." });

    return { rows, errors, dropped };
  },
};

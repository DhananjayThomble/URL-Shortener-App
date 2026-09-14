import type { ImportSource, MappedRow, ParseError } from "../types";

/**
 * Kutt export — JSON (the first non-CSV source).
 *
 * Kutt's API (`GET /api/v2/links`) and admin export return JSON: either a bare
 * array of link objects or an envelope `{ data: [...] }` / `{ links: [...] }`.
 * A link object looks like:
 *   { address, target, description, expire_in|expiration, created_at,
 *     visit_count, banned, domain }
 *
 * Mapping:
 *   - target      → destination (required)
 *   - address     → slug (a bare back-half, kept verbatim)
 *   - description → comment
 *   - expiration / expire_in → expiresAt, normalized to ISO when parseable
 * Dropped: created_at, visit_count, banned, domain.
 */
function toIso(raw: unknown): string | undefined {
  if (typeof raw !== "string" && typeof raw !== "number") return undefined;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

function extractLinks(parsed: unknown): Record<string, unknown>[] | null {
  if (Array.isArray(parsed)) return parsed as Record<string, unknown>[];
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    for (const key of ["data", "links", "results"]) {
      if (Array.isArray(obj[key])) return obj[key] as Record<string, unknown>[];
    }
  }
  return null;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

export const kutt: ImportSource = {
  id: "kutt",
  label: "Kutt",
  hint: "Kutt JSON export (an array of links, or a { data: [...] } envelope).",
  parse(text) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { rows: [], dropped: [], errors: [{ sourceIndex: 0, message: "This is not valid JSON — Kutt exports links as JSON, not CSV." }] };
    }

    const links = extractLinks(parsed);
    if (!links) {
      return { rows: [], dropped: [], errors: [{ sourceIndex: 0, message: "Expected a JSON array of links (or a { data: [...] } object)." }] };
    }

    const rows: MappedRow[] = [];
    const errors: ParseError[] = [];
    links.forEach((l, i) => {
      const destination = str(l.target) || str(l.url) || str(l.destination);
      if (!destination) {
        errors.push({ sourceIndex: i, message: "This link has no target URL." });
        return;
      }
      const slug = str(l.address) || str(l.slug);
      const title = str(l.description);
      const expiresAt = toIso(l.expiration ?? l.expire_in ?? l.expiresAt);
      rows.push({
        destination,
        ...(slug ? { slug } : {}),
        ...(title ? { title } : {}),
        ...(expiresAt ? { expiresAt } : {}),
        sourceIndex: i,
      });
    });

    const has = (keys: string[]) => links.some((l) => keys.some((k) => l[k] !== undefined && l[k] !== null && l[k] !== ""));
    const dropped: { field: string; reason: string }[] = [];
    if (has(["created_at", "createdAt"])) dropped.push({ field: "Created date", reason: "Imported links are dated at import time." });
    if (has(["visit_count", "visitCount", "visits"])) dropped.push({ field: "Visit count", reason: "Historical click counts are not imported." });
    if (has(["banned"])) dropped.push({ field: "Banned flag", reason: "Kutt's banned status is not imported." });

    return { rows, errors, dropped };
  },
};

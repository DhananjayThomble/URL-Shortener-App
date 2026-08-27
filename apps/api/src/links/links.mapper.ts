import type { Link, RoutingRule } from "@snapurl/contract";
import { deriveStatus } from "@snapurl/domain";

export interface LinkRow {
  id: string;
  slug: string;
  destination: string;
  title: string | null;
  comment: string | null;
  tags: string[];
  folder: string | null;
  redirectType: string;
  expiresAt: Date | null;
  expiresTo: string | null;
  clickLimit: number | null;
  passwordHash: string | null;
  forwardQuery: boolean;
  deepLink: boolean;
  hideReferrer: boolean;
  publicPreview: boolean;
  cloaked: boolean;
  safeBrowsingStatus: string;
  safeBrowsingCheckedAt: Date | null;
  utm: Link["utm"];
  social: Link["social"];
  clicks: number;
  uniqueClicks: number;
  archivedAt: Date | null;
  createdAt: Date;
}

export interface RuleRow {
  id: string;
  whenCountry: string | null;
  whenDevice: string | null;
  whenLanguage: string | null;
  then: string;
  weight: number | null;
}

/** G8 — always exactly 30 entries, oldest first, zero-filled.
 *
 *  A ragged array makes the sparkline component render inconsistent widths
 *  between rows; zero-filling is what makes position N mean the same day on
 *  every link in the table. */
export const SPARKLINE_DAYS = 30;

export function buildSparkline(daily: Array<{ day: string; clicks: number }>, today = new Date()): number[] {
  const byDay = new Map(daily.map((d) => [d.day, d.clicks]));
  const out: number[] = [];
  for (let i = SPARKLINE_DAYS - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    out.push(byDay.get(d.toISOString().slice(0, 10)) ?? 0);
  }
  return out;
}

export function toRoutingRule(row: RuleRow): RoutingRule {
  return {
    id: row.id,
    when: {
      country: row.whenCountry,
      device: row.whenDevice as RoutingRule["when"]["device"],
      language: row.whenLanguage,
    },
    then: row.then,
    weight: row.weight,
  };
}

export function toLinkDto(
  row: LinkRow,
  domain: string,
  rules: RuleRow[],
  sparkline: number[],
  createdBy: string | null,
): Link {
  return {
    id: row.id,
    domain,
    slug: row.slug,
    destination: row.destination,
    title: row.title,
    comment: row.comment,
    tags: row.tags ?? [],
    folder: row.folder,
    status: deriveStatus({
      archivedAt: row.archivedAt,
      expiresAt: row.expiresAt,
      clickLimit: row.clickLimit,
      clicks: row.clicks,
    }),
    clicks: row.clicks,
    uniqueClicks: row.uniqueClicks,
    redirectType: row.redirectType as Link["redirectType"],
    rules: rules.map(toRoutingRule),
    expiresAt: row.expiresAt?.toISOString() ?? null,
    expiresTo: row.expiresTo,
    clickLimit: row.clickLimit,
    // The hash itself never leaves the database — only whether one exists.
    passwordProtected: Boolean(row.passwordHash),
    forwardQuery: row.forwardQuery,
    deepLink: row.deepLink,
    hideReferrer: row.hideReferrer,
    publicPreview: row.publicPreview,
    cloaked: row.cloaked,
    safeBrowsing: {
      status: row.safeBrowsingStatus as Link["safeBrowsing"]["status"],
      checkedAt: (row.safeBrowsingCheckedAt ?? row.createdAt).toISOString(),
    },
    utm: row.utm ?? null,
    social: row.social ?? null,
    sparkline,
    createdAt: row.createdAt.toISOString(),
    createdBy,
  };
}

/* G4 — cursor pagination.

   The cursor is (createdAt, id), base64url'd so it reads as opaque and nobody
   builds a client that decodes and increments it. Keyset rather than OFFSET
   because links are created continuously: with OFFSET, a row inserted
   mid-pagination shifts everything after it and the reader silently skips one. */
export function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}|${id}`).toString("base64url");
}

export function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const [iso, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
    if (!iso || !id) return null;
    const createdAt = new Date(iso);
    return Number.isNaN(createdAt.getTime()) ? null : { createdAt, id };
  } catch {
    return null;
  }
}

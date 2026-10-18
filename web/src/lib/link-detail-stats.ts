import type { Analytics, AnalyticsRange, Link } from "@snapurl/contract";
import { full, NO_VALUE } from "./utils";

/* #768 — the link detail page mixed two scopes in one tile: the headline
   number was the link's ALL-TIME counter while its delta and every breakdown
   beneath it came from GET /analytics?range=…&linkId=… (the selected window).
   A reader saw "21,504 ▲29.1% vs prev 30d" next to countries summing to ~9,200.

   The rule these helpers encode: every number on the page is range-scoped and
   says so, and the all-time counter — useful, so kept — is labelled "all-time"
   and never sits in the slot a range total belongs in. */

/** How each window is named beside a number. Matches the range tabs and the
 *  "vs prev …" suffix on the delta, so the tile reads in one vocabulary. */
export const RANGE_SCOPE: Record<AnalyticsRange, string> = {
  "24h": "24h",
  "7d": "7d",
  "30d": "30d",
  "90d": "90d",
  "12m": "12m",
};

export interface HeadlineStat {
  /** The range total, or a dash while it is unknown — never the all-time figure. */
  value: string;
  /** "21,504 all-time", or undefined when the link carries no such counter. */
  allTime: string | undefined;
}

/** "N all-time", or undefined for a counter the link does not have (uniques are nullable). */
export function allTimeNote(count: number | null | undefined): string | undefined {
  return typeof count === "number" && Number.isFinite(count) ? `${full(count)} all-time` : undefined;
}

/** A range total for display. Undefined (still loading, or the request failed)
 *  is a dash: a number nobody measured must not be shown in its place. */
export function rangeValue(count: number | undefined): string {
  return typeof count === "number" && Number.isFinite(count) ? full(count) : NO_VALUE;
}

/**
 * The two headline tiles of the link detail page.
 *
 * `analytics` is the response for the SELECTED range and this link; `link`
 * supplies only the all-time counters, shown as the secondary figure.
 */
export function headlineStats(
  link: Pick<Link, "clicks" | "uniqueClicks">,
  analytics: Pick<Analytics, "totals"> | undefined,
): { clicks: HeadlineStat; unique: HeadlineStat } {
  return {
    clicks: { value: rangeValue(analytics?.totals.clicks), allTime: allTimeNote(link.clicks) },
    unique: { value: rangeValue(analytics?.totals.unique), allTime: allTimeNote(link.uniqueClicks) },
  };
}

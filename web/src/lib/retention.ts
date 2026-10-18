/* #769 — how the workspace's click-data retention is worded in the UI.

   The contract stores retention as an integer number of YEARS (1..100,
   packages/contract/src/workspace.ts); there is no months/days unit. The
   Settings "Forever" choice is stored as 100, and the install's operator limit
   still clamps it, so it must not be worded as a number of years. */

/** Settings stores "Forever" as the contract maximum. */
export const FOREVER_YEARS = 100;

/**
 * "1 year retention" / "3 years retention" / "maximum retention", or `null`
 * when `years` is not a value the contract could have stored (missing, 0,
 * negative, fractional, NaN, non-number) — callers then say nothing rather
 * than guess.
 */
export function retentionLabel(years: unknown): string | null {
  if (typeof years !== "number" || !Number.isInteger(years) || years < 1) return null;
  if (years >= FOREVER_YEARS) return "maximum retention";
  return `${years} ${years === 1 ? "year" : "years"} retention`;
}

const ANALYTICS_BASE = "No cookies set · click data never sold";

/** The Analytics page subtitle; the retention segment is omitted while unknown. */
export function analyticsSubtitle(years: unknown): string {
  const retention = retentionLabel(years);
  return retention ? `${ANALYTICS_BASE} · ${retention}` : ANALYTICS_BASE;
}

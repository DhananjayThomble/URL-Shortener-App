import { FOREVER_YEARS } from "./retention";

/* #780 — lowering the click-data retention deletes data.

   The contract stores retention as an integer number of YEARS (1..100) and the
   Settings "Forever" choice is FOREVER_YEARS (100), the contract maximum. The
   worker's maintenance pass (apps/worker/src/jobs/rollup.ts, pruneRetention)
   then permanently deletes the raw click rows older than the window, by default
   once an hour (MAINTENANCE_INTERVAL_SECONDS, 3600). Aggregated rollups are kept.

   Pure, so the decision can be tested without a browser. */

/** A stored retention value: a whole number of years, 1 or more. */
const isYears = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v >= 1;

/** "Forever" is everything at or past the sentinel, so 100 and 150 are the same window. */
const effective = (years: number) => Math.min(years, FOREVER_YEARS);

/**
 * Does moving the retention from `from` to `to` shorten the window, i.e. make
 * some already-stored click data eligible for deletion? Leaving "Forever" for a
 * number of years is a lowering. Anything that is not a value the contract could
 * store answers false rather than guessing.
 */
export function isRetentionLowering(from: unknown, to: unknown): boolean {
  if (!isYears(from) || !isYears(to)) return false;
  return effective(to) < effective(from);
}

export type RetentionWarning = { title: string; body: string };

/**
 * The confirmation wording for a retention change, or `null` when the change
 * deletes nothing new. The new window is always a number of years here (nothing
 * is shorter than "Forever" except a number), so it is never worded as 100.
 */
export function retentionLoweringWarning(from: unknown, to: unknown): RetentionWarning | null {
  if (!isYears(to) || !isRetentionLowering(from, to)) return null;
  const window = `${to} ${to === 1 ? "year" : "years"}`;
  return {
    title: `Delete click data older than ${window}?`,
    body:
      `Raw click events older than ${window} will be permanently deleted at the next maintenance pass, ` +
      `which runs hourly by default. This can’t be undone, even if you set a longer retention later. ` +
      `Click totals and charts built from rollups are kept.`,
  };
}

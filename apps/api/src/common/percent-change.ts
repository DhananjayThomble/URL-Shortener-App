/**
 * Period-over-period change, as a percentage rounded to one decimal.
 *
 * A zero baseline has no percentage change: growth from 0 is not +100%, and
 * 0 -> 0 is not "0%". Both used to be reported as numbers (100 and 0), which a
 * client cannot tell apart from a real +100% / real 0% and so rendered as
 * "▲ 100.0%" / "▲ 0.0%". Returning null says "there is nothing to compare
 * against" and lets the client render a dash.
 */
export function percentChange(before: number, after: number): number | null {
  if (before === 0) return null;
  return Math.round(((after - before) / before) * 1000) / 10;
}

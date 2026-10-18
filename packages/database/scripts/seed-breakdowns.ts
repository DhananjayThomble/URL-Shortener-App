/* The demo workspace's per-day breakdown mix, kept out of seed.ts so it can be
   tested without a database.

   Every dimension the analytics endpoint reads from breakdown_daily
   (apps/api/src/analytics/analytics.service.ts) must be here. One that is
   missing does not fail loudly: its card renders "Nothing here yet" beside a
   six-figure click total, and that reads as a broken pipeline. */

type Mix = ReadonlyArray<readonly [value: string, share: number]>;

export const COUNTRIES: Mix = [["IN", 42], ["US", 26], ["GB", 12], ["AE", 9], ["SG", 6], ["AU", 5]];
export const BROWSERS: Mix = [["Chrome", 50], ["Safari", 29], ["Instagram in-app", 13], ["Edge", 5], ["Firefox", 3]];
export const DEVICES: Mix = [["desktop", 44], ["ios", 31], ["android", 25]];

/* Cities track the country mix above (India's 42 is Mumbai through Chennai,
   and so on) so the two cards tell one story. More than eight are named on
   purpose: the analytics endpoint names the top eight and folds the rest into
   "Other cities", and the demo should show that bucket as real traffic does.
   "Unknown" is the share CloudFront could not place. */
export const CITIES: Mix = [
  ["Mumbai", 12], ["Bengaluru", 10], ["Delhi", 8], ["Pune", 5], ["Hyderabad", 4], ["Chennai", 3],
  ["New York", 8], ["San Francisco", 6], ["Austin", 4], ["Seattle", 3], ["Chicago", 3],
  ["London", 9], ["Manchester", 2],
  ["Dubai", 7], ["Abu Dhabi", 2],
  ["Singapore", 6],
  ["Sydney", 3], ["Melbourne", 2],
  ["Unknown", 3],
];

/* Referrer hosts as the redirect records them (parseReferrerHost: lower-case,
   no "www."). "Unknown" is a visit with no Referer — direct and QR scans —
   which is what the rollup writes for a null referrer_host. */
export const REFERRERS: Mix = [
  ["instagram.com", 28], ["Unknown", 24], ["whatsapp.com", 15], ["google.com", 13],
  ["linkedin.com", 9], ["t.co", 7], ["facebook.com", 4],
];

export const SEED_BREAKDOWNS = {
  country: COUNTRIES,
  city: CITIES,
  browser: BROWSERS,
  device: DEVICES,
  referrer: REFERRERS,
} as const satisfies Record<string, Mix>;

export type SeedDimension = keyof typeof SEED_BREAKDOWNS;

/** The breakdown_daily rows for one link-day with `clicks` clicks. A share that
 *  rounds to zero clicks is omitted, as a real rollup would never write it. */
export function dailyBreakdowns(clicks: number): Array<{ dimension: SeedDimension; value: string; count: number }> {
  const rows: Array<{ dimension: SeedDimension; value: string; count: number }> = [];
  for (const [dimension, mix] of Object.entries(SEED_BREAKDOWNS) as Array<[SeedDimension, Mix]>) {
    for (const [value, share] of mix) {
      const count = Math.round((clicks * share) / 100);
      if (count > 0) rows.push({ dimension, value, count });
    }
  }
  return rows;
}

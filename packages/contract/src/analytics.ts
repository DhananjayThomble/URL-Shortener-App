import { z } from "zod";

/* Analytics and conversions. Everything here is served from rollup tables —
   the dashboards never aggregate raw click rows. */

export const TimeseriesPoint = z.object({
  /**
   * The bucket's key. For a DAILY series (every range except 24h) this is a
   * `YYYY-MM-DD` calendar day; for the HOURLY series the 24h range now returns
   * (#770) it is a `YYYY-MM-DDTHH:00` UTC hour. `Analytics.granularity` says
   * which, so the chart can format the axis without parsing the string.
   */
  date: z.string(),
  clicks: z.number(),
  unique: z.number(),
  scans: z.number().optional(),
});
export type TimeseriesPoint = z.infer<typeof TimeseriesPoint>;

/**
 * The size of each `series` bucket.
 *
 * #770 — selecting 24h used to map to a single day over the click_daily
 * rollup, drawing one point for the whole window (a flat, misleading line). The
 * 24h range now returns up to 24 HOURLY buckets straight off the (partitioned,
 * time-indexed) click_events table; every other range stays DAILY off the
 * rollups. The chart reads this to label the x-axis in hours vs days rather
 * than inferring it from the date string.
 */
export const Granularity = z.enum(["day", "hour"]);
export type Granularity = z.infer<typeof Granularity>;

export const Breakdown = z.object({
  label: z.string(),
  value: z.number(),
  icon: z.string().optional(),
});
export type Breakdown = z.infer<typeof Breakdown>;

export const Analytics = z.object({
  totals: z.object({
    clicks: z.number(),
    unique: z.number(),
    scans: z.number(),
    conversions: z.number(),
    blocked: z.number(),
  }),
  /** Percent change vs the previous window; null when that window was zero (nothing to compare against). */
  deltas: z.object({
    clicks: z.number().nullable(),
    unique: z.number().nullable(),
    scans: z.number().nullable(),
    conversions: z.number().nullable(),
  }),
  series: z.array(TimeseriesPoint),
  /**
   * The bucket size of `series`. "hour" only for the 24h range (#770), "day"
   * for everything else. Defaults to "day" so an older client — or an adapter
   * that does not set it — reads the series as daily, exactly as before.
   */
  granularity: Granularity.default("day"),
  countries: z.array(Breakdown),
  /**
   * Cities, with a k-anonymity floor applied — anything below the threshold is
   * folded into "Other cities" rather than named. Resolved from CloudFront's
   * edge header, so no IP is stored to produce it. See docs/DECISIONS.md.
   */
  cities: z.array(Breakdown),
  devices: z.array(Breakdown),
  browsers: z.array(Breakdown),
  referrers: z.array(Breakdown),
  tags: z.array(Breakdown),
  topLinks: z.array(Breakdown),
});
export type Analytics = z.infer<typeof Analytics>;

export const AnalyticsRange = z.enum(["24h", "7d", "30d", "90d", "12m"]);
export type AnalyticsRange = z.infer<typeof AnalyticsRange>;

// `.strict()` so an unsupported or misspelled query param (e.g. `from`/`to`,
// or `rnge`) is rejected with a 400 naming the offending key, rather than
// silently stripped — which previously returned the default 30d window with a
// 200 and made a client typo look like real, empty data.
export const AnalyticsQuery = z
  .object({
    range: AnalyticsRange.default("30d"),
    // A uuid, not any string: the value reaches a uuid column (click_daily.link_id),
    // so a malformed one surfaced as a 500 from Postgres (22P02) rather than a 400
    // naming the field. Same refinement the sibling RecordConversionInput.linkId
    // already carries — linkId is a link id (#908, same class as #887).
    linkId: z.string().uuid("linkId must be a link id").optional(),
  })
  .strict();
export type AnalyticsQuery = z.infer<typeof AnalyticsQuery>;

export const ConversionEvent = z.object({
  id: z.string(),
  kind: z.enum(["lead", "signup", "sale", "custom"]),
  name: z.string(),
  source: z.string(),
  count: z.number(),
});
export type ConversionEvent = z.infer<typeof ConversionEvent>;

/* G7 — revenue was a bare number with no unit.

   Two things went wrong with that: floats lose cents at scale, and a workspace
   with mixed-currency conversions summed USD into INR and reported a number
   that meant nothing. Values are stored as integer minor units and the report
   now says which currency it is in. Nothing is converted — a converted total
   needs a rate source and a rate date, which is a product decision. */
export const CurrencyCode = z.string().length(3).describe("ISO 4217, e.g. INR");
export type CurrencyCode = z.infer<typeof CurrencyCode>;

/** G7 — conversions recorded in a currency other than the workspace's are not
 *  summed into revenue and nothing is converted. This is the other half of that
 *  rule: the report says how many were left out, so the exclusion is never
 *  silent (#654). Same date window as `totals`. */
export const ExcludedConversions = z.object({
  /** All conversions in the window whose currency is not the workspace currency. */
  count: z.number().int(),
  /** One entry per excluded currency, largest count first, then by currency code. */
  byCurrency: z.array(
    z.object({
      currency: CurrencyCode,
      count: z.number().int(),
      /** Sum of valueMinor in that currency, in its own minor units (4900 = 49.00). */
      valueMinor: z.number().int(),
    }),
  ),
});
export type ExcludedConversions = z.infer<typeof ExcludedConversions>;

export const ConversionsReport = z.object({
  currency: CurrencyCode.default("INR"),
  excluded: ExcludedConversions.default({ count: 0, byCurrency: [] }),
  totals: z.object({
    clicks: z.number(),
    leads: z.number(),
    signups: z.number(),
    paid: z.number(),
    revenue: z.number(),
  }),
  /** Percent change vs the previous window; null when that window was zero (nothing to compare against). */
  deltas: z.object({
    clicks: z.number().nullable(),
    leads: z.number().nullable(),
    signups: z.number().nullable(),
    paid: z.number().nullable(),
    revenue: z.number().nullable(),
  }),
  events: z.array(ConversionEvent),
  byLink: z.array(
    z.object({
      link: z.string(),
      campaign: z.string(),
      clicks: z.number(),
      signups: z.number(),
      cvr: z.number(),
      revenue: z.number(),
    }),
  ),
  revenueSeries: z.array(z.number()),
});
export type ConversionsReport = z.infer<typeof ConversionsReport>;

/** Ingest — how a customer's site reports a conversion back to us. */
export const RecordConversionInput = z.object({
  /* A uuid, not any string: the value reaches a uuid column, so a malformed one
     used to surface as a 500 from Postgres rather than a 400 naming the field. */
  linkId: z.string().uuid("linkId must be a link id").optional(),
  slug: z.string().optional(),
  kind: z.enum(["lead", "signup", "sale", "custom"]),
  name: z.string().min(1).max(120),
  /** Integer minor units. 1999 is ₹19.99, never 19.99. */
  valueMinor: z.number().int().min(0).default(0),
  currency: CurrencyCode.optional(),
  externalId: z.string().max(200).optional(),
  visitorHash: z.string().optional(),
});
export type RecordConversionInput = z.infer<typeof RecordConversionInput>;

/** `recorded` is false when externalId matched an existing row. The ingest is
 *  idempotent on purpose — a customer retrying a timed-out webhook must not
 *  book the same sale twice — so the caller needs to be able to tell. */
export const RecordConversionResult = z.object({
  id: z.string().nullable(),
  recorded: z.boolean(),
});
export type RecordConversionResult = z.infer<typeof RecordConversionResult>;

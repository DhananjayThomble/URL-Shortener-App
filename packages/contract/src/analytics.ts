import { z } from "zod";

/* Analytics and conversions. Everything here is served from rollup tables —
   the dashboards never aggregate raw click rows. */

export const TimeseriesPoint = z.object({
  date: z.string(),
  clicks: z.number(),
  unique: z.number(),
  scans: z.number().optional(),
});
export type TimeseriesPoint = z.infer<typeof TimeseriesPoint>;

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
  deltas: z.object({
    clicks: z.number(),
    unique: z.number(),
    scans: z.number(),
    conversions: z.number(),
  }),
  series: z.array(TimeseriesPoint),
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

export const AnalyticsQuery = z.object({
  range: AnalyticsRange.default("30d"),
  linkId: z.string().optional(),
});
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

export const ConversionsReport = z.object({
  currency: CurrencyCode.default("INR"),
  totals: z.object({
    clicks: z.number(),
    leads: z.number(),
    signups: z.number(),
    paid: z.number(),
    revenue: z.number(),
  }),
  deltas: z.object({
    clicks: z.number(),
    leads: z.number(),
    signups: z.number(),
    paid: z.number(),
    revenue: z.number(),
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
  linkId: z.string().optional(),
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

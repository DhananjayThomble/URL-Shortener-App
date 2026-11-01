import { z } from "zod";

/* ============================================================
   #973 — platform-wide analytics (admin panel 6/7, epic #975).

   The shapes behind GET /api/v1/admin/analytics. Every figure is built from
   the existing daily SUMMARY tables (click_daily, breakdown_daily,
   click_daily_uniques) plus users/workspaces/memberships/conversions/
   abuse_reports — never a full scan of click_events. The platform view is the
   same question the per-workspace /analytics answers, asked across all
   workspaces at once: by construction every platform total equals the sum of
   the per-workspace figures for the same range (there is a test for exactly
   that).

   These are READ shapes only. The route is a read, so nothing here goes
   through the admin audit log — that helper is for admin WRITES, of which this
   part has none.
   ============================================================ */

/** The ranges the platform view offers. Wider than the per-workspace
 *  AnalyticsRange because the operator reasons in calendar-ish spans; the
 *  server maps each to a day count. */
export const AdminAnalyticsRange = z.enum(["7d", "30d", "90d", "12m"]);
export type AdminAnalyticsRange = z.infer<typeof AdminAnalyticsRange>;

/** Which view a CSV export is for — each table on the page can be exported on
 *  its own, so the export route names the one it wants. */
export const AdminAnalyticsCsvView = z.enum([
  "growth",
  "usage",
  "business",
  "abuse",
  "topWorkspaces",
  "topLinks",
]);
export type AdminAnalyticsCsvView = z.infer<typeof AdminAnalyticsCsvView>;

/** `.strict()` so a misspelled param (e.g. `rnge`, `from`) is a 400 naming the
 *  key rather than silently ignored and answered with the default window. */
export const AdminAnalyticsQuery = z
  .object({
    range: AdminAnalyticsRange.default("30d"),
    /** When true the response carries a `previous` block: the same figures over
     *  the immediately-preceding window of equal length, so the UI can show a
     *  period-over-period comparison. */
    compare: z.coerce.boolean().default(false),
  })
  .strict();
export type AdminAnalyticsQuery = z.infer<typeof AdminAnalyticsQuery>;

/** One day of a platform-wide series. `date` is a `YYYY-MM-DD` UTC day, the
 *  same key the daily rollups and partitions use. */
export const AdminSeriesPoint = z.object({
  date: z.string(),
  value: z.number().int(),
});
export type AdminSeriesPoint = z.infer<typeof AdminSeriesPoint>;

/** A ranked (label, value) row — top workspaces/links and every breakdown. */
export const AdminRankRow = z.object({
  label: z.string(),
  value: z.number().int(),
});
export type AdminRankRow = z.infer<typeof AdminRankRow>;

/* ── Growth ─────────────────────────────────────────────── */

export const AdminGrowth = z.object({
  /** New users, counted by users.created_at falling inside the window. */
  signups: z.number().int(),
  /** New workspaces, by workspaces.created_at inside the window. */
  newWorkspaces: z.number().int(),
  /** Distinct users with any membership activity inside the window — the
   *  platform's active-user count for the range. */
  activeUsers: z.number().int(),
  /** Signups per day across the window (zero-filled). */
  signupsSeries: z.array(AdminSeriesPoint),
  /** Active users per day / week / month over the window. */
  activeDaily: z.number().int(),
  activeWeekly: z.number().int(),
  activeMonthly: z.number().int(),
  /** Simple retention: of the users who signed up in the window, how many were
   *  still active at least N weeks later. Keyed by week offset ("1","2","4"). */
  retention: z.array(
    z.object({
      weeks: z.number().int(),
      /** Users who signed up in the window and were active >= `weeks` after. */
      retained: z.number().int(),
      /** The signup cohort the retained count is out of. */
      cohort: z.number().int(),
    }),
  ),
});
export type AdminGrowth = z.infer<typeof AdminGrowth>;

/* ── Usage ──────────────────────────────────────────────── */

export const AdminUsage = z.object({
  linksCreated: z.number().int(),
  totalClicks: z.number().int(),
  uniqueVisitors: z.number().int(),
  clicksSeries: z.array(AdminSeriesPoint),
  topWorkspaces: z.array(AdminRankRow),
  topLinks: z.array(AdminRankRow),
  byCountry: z.array(AdminRankRow),
  byDevice: z.array(AdminRankRow),
  byBrowser: z.array(AdminRankRow),
  byReferrer: z.array(AdminRankRow),
});
export type AdminUsage = z.infer<typeof AdminUsage>;

/* ── Business ───────────────────────────────────────────── */

export const AdminBusiness = z.object({
  /** Workspace count per plan name, largest first. */
  byPlan: z.array(AdminRankRow),
  /** Workspaces whose clicks in the window are at or above a fraction of their
   *  included allowance — "near their limit". */
  nearLimit: z.array(
    z.object({
      workspace: z.string(),
      plan: z.string(),
      clicks: z.number().int(),
      included: z.number().int(),
      /** clicks / included, rounded to 2 dp. >= 1 means over the allowance. */
      usedFraction: z.number(),
    }),
  ),
});
export type AdminBusiness = z.infer<typeof AdminBusiness>;

/* ── Email (SES) ────────────────────────────────────────── */

/**
 * SES sends / bounces / complaints.
 *
 * These live in SES/CloudWatch, not the database — they have no per-workspace
 * decomposition and cannot be seeded, so they sit behind their own reader port
 * (EmailStatsReader). When no SES source is configured (the default, and every
 * test environment) `available` is false and the figures are null, so the view
 * renders honestly rather than showing a fabricated zero. Wiring the CloudWatch
 * adapter and the read-only IAM grant on the API role is a documented
 * follow-up; the shape is defined now so adding the data later changes no
 * contract.
 */
export const AdminEmail = z.object({
  available: z.boolean(),
  sends: z.number().int().nullable(),
  bounces: z.number().int().nullable(),
  complaints: z.number().int().nullable(),
  /** Bounce rate and complaint rate as fractions of sends, or null. */
  bounceRate: z.number().nullable(),
  complaintRate: z.number().nullable(),
});
export type AdminEmail = z.infer<typeof AdminEmail>;

/* ── Abuse ──────────────────────────────────────────────── */

export const AdminAbuse = z.object({
  /** Reports filed in the window. */
  reports: z.number().int(),
  /** Reports per ISO week in the window, oldest first. `label` is `YYYY-Www`. */
  reportsByWeek: z.array(z.object({ label: z.string(), value: z.number().int() })),
  /** Reports resolved in the window (status moved off "open"). */
  resolved: z.number().int(),
  /** Mean hours from a report's creation to its last update, over reports
   *  resolved in the window. Null when none were resolved. */
  avgResolutionHours: z.number().nullable(),
});
export type AdminAbuse = z.infer<typeof AdminAbuse>;

/* ── The whole response ─────────────────────────────────── */

/** The figures that get a period-over-period comparison when `compare=true`.
 *  Only the scalar headline numbers compare; the series and breakdowns do not. */
export const AdminAnalyticsComparable = z.object({
  signups: z.number().int(),
  newWorkspaces: z.number().int(),
  activeUsers: z.number().int(),
  linksCreated: z.number().int(),
  totalClicks: z.number().int(),
  uniqueVisitors: z.number().int(),
  reports: z.number().int(),
});
export type AdminAnalyticsComparable = z.infer<typeof AdminAnalyticsComparable>;

export const PlatformAnalytics = z.object({
  range: AdminAnalyticsRange,
  /** The window the figures cover, both ends inclusive, as `YYYY-MM-DD`. */
  window: z.object({ start: z.string(), end: z.string() }),
  growth: AdminGrowth,
  usage: AdminUsage,
  business: AdminBusiness,
  email: AdminEmail,
  abuse: AdminAbuse,
  /** Present only when the request asked to compare; the same headline figures
   *  over the immediately-preceding window of equal length. */
  previous: AdminAnalyticsComparable.optional(),
});
export type PlatformAnalytics = z.infer<typeof PlatformAnalytics>;

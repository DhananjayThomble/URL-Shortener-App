import { describe, expect, it } from "vitest";
import { AdminMe } from "./admin.js";
import {
  AdminAbuse,
  AdminAnalyticsComparable,
  AdminAnalyticsCsvView,
  AdminAnalyticsQuery,
  AdminAnalyticsRange,
  AdminBusiness,
  AdminEmail,
  AdminGrowth,
  AdminRankRow,
  AdminSeriesPoint,
  AdminUsage,
  PlatformAnalytics,
} from "./admin-analytics.js";

/* #973 — behavioural tests for the platform-analytics wire shapes. Like the
   sibling analytics.test.ts, these pin the enum membership, the query
   validation (strict, range default, compare coercion), the defaults older
   clients rely on, and every nested output shape — so a mutation that drops a
   refinement, flips a boolean/conditional, or collapses an object to {} is
   caught by a real parse, not by asserting a literal equals itself
   (StringLiteral mutants are excluded for this package by design). */

describe("AdminMe (#968) — the admin identity shape", () => {
  it("requires id/name/email and isPlatformAdmin literally true", () => {
    const parsed = AdminMe.parse({ id: "u1", name: "Dee", email: "dee@example.com", isPlatformAdmin: true });
    expect(parsed.isPlatformAdmin).toBe(true);
    // z.literal(true): false (or any non-true) must be rejected — kills the
    // BooleanLiteral mutant that flips the literal.
    expect(AdminMe.safeParse({ id: "u1", name: "Dee", email: "dee@example.com", isPlatformAdmin: false }).success).toBe(false);
    expect(AdminMe.safeParse({ id: "u1", name: "Dee", email: "dee@example.com" }).success).toBe(false); // missing flag
    expect(AdminMe.safeParse({ name: "Dee", email: "dee@example.com", isPlatformAdmin: true }).success).toBe(false); // missing id
  });
});

describe("AdminAnalyticsRange / AdminAnalyticsCsvView enums", () => {
  it("AdminAnalyticsRange is the four supported windows", () => {
    for (const r of ["7d", "30d", "90d", "12m"]) expect(AdminAnalyticsRange.safeParse(r).success).toBe(true);
    expect(AdminAnalyticsRange.safeParse("24h").success).toBe(false); // not offered platform-wide
    expect(AdminAnalyticsRange.safeParse("1y").success).toBe(false);
    expect(AdminAnalyticsRange.safeParse("").success).toBe(false);
  });

  it("AdminAnalyticsCsvView is exactly the six exportable views", () => {
    for (const v of ["growth", "usage", "business", "abuse", "topWorkspaces", "topLinks"])
      expect(AdminAnalyticsCsvView.safeParse(v).success).toBe(true);
    expect(AdminAnalyticsCsvView.safeParse("email").success).toBe(false); // email has no CSV
    expect(AdminAnalyticsCsvView.safeParse("nope").success).toBe(false);
  });
});

describe("AdminAnalyticsQuery — strict, range default, compare coercion", () => {
  it("defaults range to 30d and compare to false", () => {
    const parsed = AdminAnalyticsQuery.parse({});
    expect(parsed.range).toBe("30d"); // kills range default("30d")
    expect(parsed.compare).toBe(false); // kills compare default(false)
  });

  it("coerces compare from a query-string value and accepts a valid range", () => {
    // z.coerce.boolean(): any non-empty string is true, empty string is false —
    // the only values that reach a query param. Kills the coerce drop.
    expect(AdminAnalyticsQuery.parse({ compare: "true" }).compare).toBe(true);
    expect(AdminAnalyticsQuery.parse({ compare: "" }).compare).toBe(false);
    expect(AdminAnalyticsQuery.parse({ range: "7d", compare: "1" })).toEqual({ range: "7d", compare: true });
  });

  it("rejects an unknown query param (kills .strict() dropped)", () => {
    expect(AdminAnalyticsQuery.safeParse({ rnge: "7d" }).success).toBe(false);
    expect(AdminAnalyticsQuery.safeParse({ from: "2026-01-01" }).success).toBe(false);
  });

  it("rejects an invalid range", () => {
    expect(AdminAnalyticsQuery.safeParse({ range: "24h" }).success).toBe(false);
  });
});

describe("AdminSeriesPoint / AdminRankRow — integer values", () => {
  it("AdminSeriesPoint requires a date string and an integer value", () => {
    expect(AdminSeriesPoint.parse({ date: "2026-01-01", value: 5 }).value).toBe(5);
    expect(AdminSeriesPoint.safeParse({ date: "2026-01-01", value: 1.5 }).success).toBe(false); // .int()
    expect(AdminSeriesPoint.safeParse({ date: "2026-01-01" }).success).toBe(false); // no value
    expect(AdminSeriesPoint.safeParse({ date: 20260101, value: 5 }).success).toBe(false); // date must be string
  });

  it("AdminRankRow requires a label string and an integer value", () => {
    expect(AdminRankRow.parse({ label: "Acme", value: 10 }).label).toBe("Acme");
    expect(AdminRankRow.safeParse({ label: "Acme", value: 10.5 }).success).toBe(false); // .int()
    expect(AdminRankRow.safeParse({ label: "Acme" }).success).toBe(false);
    expect(AdminRankRow.safeParse({ label: 1, value: 10 }).success).toBe(false);
  });
});

describe("AdminGrowth shape", () => {
  const valid = {
    signups: 3,
    newWorkspaces: 2,
    activeUsers: 3,
    signupsSeries: [{ date: "2026-01-01", value: 1 }],
    activeDaily: 1,
    activeWeekly: 2,
    activeMonthly: 3,
    retention: [{ weeks: 2, retained: 1, cohort: 3 }],
  };

  it("accepts a well-formed growth block", () => {
    expect(AdminGrowth.parse(valid).retention[0]!.cohort).toBe(3);
  });

  it("requires integer scalars and the nested series/retention arrays (kills shape → {})", () => {
    expect(AdminGrowth.safeParse({ ...valid, signups: 1.5 }).success).toBe(false); // .int()
    expect(AdminGrowth.safeParse({ ...valid, signupsSeries: [{ date: "2026-01-01" }] }).success).toBe(false); // bad point
    expect(AdminGrowth.safeParse({ ...valid, retention: [{ weeks: 2, retained: 1 }] }).success).toBe(false); // no cohort
    const { activeMonthly: _m, ...missing } = valid;
    expect(AdminGrowth.safeParse(missing).success).toBe(false);
  });
});

describe("AdminUsage shape", () => {
  const valid = {
    linksCreated: 2,
    totalClicks: 20,
    uniqueVisitors: 16,
    clicksSeries: [{ date: "2026-01-01", value: 10 }],
    topWorkspaces: [{ label: "a", value: 14 }],
    topLinks: [{ label: "l", value: 10 }],
    byCountry: [{ label: "IN", value: 16 }],
    byDevice: [],
    byBrowser: [],
    byReferrer: [],
  };

  it("accepts a well-formed usage block and requires every array (kills shape → {})", () => {
    expect(AdminUsage.parse(valid).totalClicks).toBe(20);
    expect(AdminUsage.safeParse({ ...valid, totalClicks: 1.5 }).success).toBe(false); // .int()
    expect(AdminUsage.safeParse({ ...valid, topWorkspaces: [{ label: "a" }] }).success).toBe(false); // bad rank row
    const { byReferrer: _b, ...missing } = valid;
    expect(AdminUsage.safeParse(missing).success).toBe(false);
  });
});

describe("AdminBusiness shape — byPlan and the near-limit rows", () => {
  const valid = {
    byPlan: [{ label: "Pro", value: 1 }],
    nearLimit: [{ workspace: "b", plan: "Free", clicks: 6, included: 5, usedFraction: 1.2 }],
  };

  it("accepts a well-formed business block; usedFraction is a plain number (fraction, not int)", () => {
    const parsed = AdminBusiness.parse(valid);
    expect(parsed.nearLimit[0]!.usedFraction).toBe(1.2); // NOT .int(): a fraction must survive
  });

  it("requires the near-limit row fields (kills the row shape → {})", () => {
    expect(AdminBusiness.safeParse({ ...valid, nearLimit: [{ workspace: "b", plan: "Free" }] }).success).toBe(false);
    expect(AdminBusiness.safeParse({ ...valid, nearLimit: [{ ...valid.nearLimit[0], clicks: 1.5 }] }).success).toBe(false); // clicks .int()
    expect(AdminBusiness.safeParse({ byPlan: [{ label: "Pro", value: 1 }] }).success).toBe(false); // no nearLimit
  });
});

describe("AdminEmail shape — available flag, nullable counts and rates", () => {
  it("accepts the unavailable form (all nulls)", () => {
    const parsed = AdminEmail.parse({
      available: false,
      sends: null,
      bounces: null,
      complaints: null,
      bounceRate: null,
      complaintRate: null,
    });
    expect(parsed.available).toBe(false);
    expect(parsed.sends).toBeNull();
  });

  it("accepts the available form with integer counts and fractional rates", () => {
    const parsed = AdminEmail.parse({
      available: true,
      sends: 1000,
      bounces: 25,
      complaints: 2,
      bounceRate: 0.025,
      complaintRate: 0.002,
    });
    expect(parsed.bounceRate).toBe(0.025); // rate is a fraction, must not be .int()
  });

  it("requires available to be a boolean and counts to be integers-or-null", () => {
    expect(AdminEmail.safeParse({ available: "yes", sends: null, bounces: null, complaints: null, bounceRate: null, complaintRate: null }).success).toBe(false); // boolean
    expect(AdminEmail.safeParse({ available: true, sends: 1.5, bounces: null, complaints: null, bounceRate: null, complaintRate: null }).success).toBe(false); // sends .int()
    expect(AdminEmail.safeParse({ available: true, sends: 1, bounces: null, complaints: null, bounceRate: null }).success).toBe(false); // missing complaintRate
  });
});

describe("AdminAbuse shape — reports, weekly series, nullable avg", () => {
  const valid = {
    reports: 2,
    reportsByWeek: [{ label: "2026-W01", value: 2 }],
    resolved: 1,
    avgResolutionHours: 24,
  };

  it("accepts a well-formed abuse block and a null avg", () => {
    expect(AdminAbuse.parse(valid).avgResolutionHours).toBe(24);
    expect(AdminAbuse.parse({ ...valid, avgResolutionHours: null }).avgResolutionHours).toBeNull();
  });

  it("requires integer counts, the weekly array, and a nullable-number avg", () => {
    expect(AdminAbuse.safeParse({ ...valid, reports: 1.5 }).success).toBe(false); // .int()
    expect(AdminAbuse.safeParse({ ...valid, reportsByWeek: [{ label: "w", value: 1.5 }] }).success).toBe(false); // value .int()
    expect(AdminAbuse.safeParse({ ...valid, avgResolutionHours: "x" }).success).toBe(false); // number|null
    const { resolved: _r, ...missing } = valid;
    expect(AdminAbuse.safeParse(missing).success).toBe(false);
  });
});

describe("AdminAnalyticsComparable — the headline figures that compare", () => {
  const valid = {
    signups: 1,
    newWorkspaces: 0,
    activeUsers: 1,
    linksCreated: 0,
    totalClicks: 100,
    uniqueVisitors: 90,
    reports: 0,
  };
  it("requires all seven integer headline figures (kills shape → {})", () => {
    expect(AdminAnalyticsComparable.parse(valid).totalClicks).toBe(100);
    expect(AdminAnalyticsComparable.safeParse({ ...valid, totalClicks: 1.5 }).success).toBe(false); // .int()
    const { reports: _r, ...missing } = valid;
    expect(AdminAnalyticsComparable.safeParse(missing).success).toBe(false);
  });
});

describe("PlatformAnalytics — the whole response, previous optional", () => {
  const growth = {
    signups: 0,
    newWorkspaces: 0,
    activeUsers: 0,
    signupsSeries: [],
    activeDaily: 0,
    activeWeekly: 0,
    activeMonthly: 0,
    retention: [],
  };
  const usage = {
    linksCreated: 0,
    totalClicks: 0,
    uniqueVisitors: 0,
    clicksSeries: [],
    topWorkspaces: [],
    topLinks: [],
    byCountry: [],
    byDevice: [],
    byBrowser: [],
    byReferrer: [],
  };
  const business = { byPlan: [], nearLimit: [] };
  const email = { available: false, sends: null, bounces: null, complaints: null, bounceRate: null, complaintRate: null };
  const abuse = { reports: 0, reportsByWeek: [], resolved: 0, avgResolutionHours: null };
  const base = { range: "30d" as const, window: { start: "2026-01-01", end: "2026-01-30" }, growth, usage, business, email, abuse };

  it("accepts a response without the previous block (previous is optional)", () => {
    const parsed = PlatformAnalytics.parse(base);
    expect(parsed.previous).toBeUndefined();
  });

  it("accepts a response WITH the previous block", () => {
    const parsed = PlatformAnalytics.parse({
      ...base,
      previous: { signups: 1, newWorkspaces: 0, activeUsers: 1, linksCreated: 0, totalClicks: 100, uniqueVisitors: 90, reports: 0 },
    });
    expect(parsed.previous?.totalClicks).toBe(100);
  });

  it("requires the window with start AND end, and every figure block (kills shape → {})", () => {
    expect(PlatformAnalytics.safeParse({ ...base, window: { start: "2026-01-01" } }).success).toBe(false); // no end
    expect(PlatformAnalytics.safeParse({ ...base, growth: { ...growth, signups: 1.5 } }).success).toBe(false); // bad growth
    const { email: _e, ...missing } = base;
    expect(PlatformAnalytics.safeParse(missing).success).toBe(false);
    expect(PlatformAnalytics.safeParse({ ...base, range: "24h" }).success).toBe(false); // range enum
  });
});

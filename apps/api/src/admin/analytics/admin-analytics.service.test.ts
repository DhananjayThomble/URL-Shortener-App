import { describe, expect, it } from "vitest";
import type { PlatformAnalytics } from "@snapurl/contract";
import {
  AdminAnalyticsService,
  fillSeries,
  iso,
  previousWindow,
  windowFor,
} from "./admin-analytics.service.js";
import type { AdminAnalyticsReader, DayPoint, RankRow, WorkspaceUsageRow } from "./admin-analytics.reader.js";
import type { EmailStats, EmailStatsReader } from "./email-stats.reader.js";

/* ============================================================
   #973 — the store-agnostic shaping in AdminAnalyticsService, with the readers
   faked so no database is needed (this runs in the required CI gate, unlike the
   DB-gated integration suite). Proves the window math, the zero-fill, the
   near-limit rule, the compare block, the email rates and the CSV escaping —
   each with numbers written out by hand.
   ============================================================ */

/** A reader that answers from a fixed script, so the service's SHAPING is under
 *  test rather than any SQL. Every method returns a constant; the ones the
 *  near-limit / retention logic reads are set per-case. */
function fakeReader(over: Partial<AdminAnalyticsReader> = {}): AdminAnalyticsReader {
  const empty = async () => 0;
  const emptyRows = async () => [] as RankRow[];
  const base: AdminAnalyticsReader = {
    signups: empty,
    signupsByDay: async () => [] as DayPoint[],
    newWorkspaces: empty,
    activeUsers: empty,
    retentionAfterWeeks: async () => ({ retained: 0, cohort: 0 }),
    linksCreated: empty,
    clickTotals: async () => ({ clicks: 0, unique: 0 }),
    clicksByDay: async () => [] as DayPoint[],
    topWorkspaces: emptyRows,
    topLinks: emptyRows,
    breakdown: emptyRows,
    clicksByWorkspace: async () => [],
    workspacesByPlan: emptyRows,
    workspaceUsage: async () => [] as WorkspaceUsageRow[],
    reportsFiled: empty,
    reportsByWeek: async () => [],
    resolvedReports: async () => ({ resolved: 0, avgResolutionHours: null }),
  };
  return { ...base, ...over };
}

function emailReader(stats: EmailStats): EmailStatsReader {
  return { stats: async () => stats };
}

const unavailableEmail = emailReader({ available: false, sends: null, bounces: null, complaints: null });

describe("windowFor / previousWindow", () => {
  it("a 30d window is 30 inclusive days ending today, with an exclusive end of tomorrow", () => {
    const now = new Date("2026-06-30T12:00:00Z");
    const w = windowFor(30, now);
    expect(w.start).toBe("2026-06-01"); // 30 days: Jun 1..Jun 30 inclusive
    expect(w.endInclusive).toBe("2026-06-30");
    expect(w.end).toBe("2026-07-01"); // exclusive upper bound
  });

  it("the previous window is the equal-length span immediately before", () => {
    const now = new Date("2026-06-30T12:00:00Z");
    const w = windowFor(30, now);
    const prev = previousWindow(w, 30);
    expect(prev.start).toBe("2026-05-02"); // 30 days before Jun 1
    expect(prev.end).toBe("2026-06-01"); // ends where current starts (exclusive)
    expect(prev.endInclusive).toBe("2026-05-31");
  });
});

describe("fillSeries", () => {
  it("zero-fills every day of the window and keeps seeded values on their day", () => {
    const w = windowFor(7, new Date("2026-06-30T00:00:00Z"));
    const rows: DayPoint[] = [
      { date: "2026-06-25", value: 5 },
      { date: "2026-06-30", value: 9 },
    ];
    const filled = fillSeries(rows, w);
    expect(filled).toHaveLength(7);
    expect(filled[0]).toEqual({ date: "2026-06-24", value: 0 });
    expect(filled.find((p) => p.date === "2026-06-25")?.value).toBe(5);
    expect(filled.find((p) => p.date === "2026-06-30")?.value).toBe(9);
    // Untouched days are a real zero, not a gap.
    expect(filled.find((p) => p.date === "2026-06-26")?.value).toBe(0);
  });
});

describe("AdminAnalyticsService.platform shaping", () => {
  it("near-limit keeps only workspaces at or above 80% of their allowance, ranked by fraction", async () => {
    const usage: WorkspaceUsageRow[] = [
      { workspace: "over", plan: "Free", clicks: 60, included: 50 }, // 1.2
      { workspace: "at", plan: "Pro", clicks: 80, included: 100 }, // 0.8 — included
      { workspace: "under", plan: "Pro", clicks: 10, included: 100 }, // 0.1 — excluded
      { workspace: "unlimited", plan: "Ent", clicks: 999, included: 0 }, // included 0 — excluded (no basis)
    ];
    const service = new AdminAnalyticsService(fakeReader({ workspaceUsage: async () => usage }), unavailableEmail);
    const res = await service.platform({ range: "30d", compare: false });
    expect(res.business.nearLimit.map((w) => w.workspace)).toEqual(["over", "at"]);
    expect(res.business.nearLimit[0]!.usedFraction).toBeCloseTo(1.2, 5);
    expect(res.business.nearLimit[1]!.usedFraction).toBeCloseTo(0.8, 5);
  });

  it("email rates are computed from available counts and are null when unavailable", async () => {
    const withStats = new AdminAnalyticsService(
      fakeReader(),
      emailReader({ available: true, sends: 1000, bounces: 25, complaints: 2 }),
    );
    const res = await withStats.platform({ range: "30d", compare: false });
    expect(res.email.available).toBe(true);
    expect(res.email.bounceRate).toBeCloseTo(0.025, 6);
    expect(res.email.complaintRate).toBeCloseTo(0.002, 6);

    const noStats = new AdminAnalyticsService(fakeReader(), unavailableEmail);
    const res2 = await noStats.platform({ range: "30d", compare: false });
    expect(res2.email.bounceRate).toBeNull();
    expect(res2.email.complaintRate).toBeNull();
  });

  it("compare=true queries and attaches the previous window; compare=false omits it", async () => {
    // Make signups window-sensitive so the previous block is a different number.
    const reader = fakeReader({
      signups: async (start) => (start === windowFor(30).start ? 7 : 3),
    });
    const service = new AdminAnalyticsService(reader, unavailableEmail);

    const compared = await service.platform({ range: "30d", compare: true });
    expect(compared.previous).toBeDefined();
    expect(compared.growth.signups).toBe(7);
    expect(compared.previous!.signups).toBe(3);

    const plain = await service.platform({ range: "30d", compare: false });
    expect(plain.previous).toBeUndefined();
  });

  it("reports the window both ends inclusive", async () => {
    const service = new AdminAnalyticsService(fakeReader(), unavailableEmail);
    const res: PlatformAnalytics = await service.platform({ range: "7d", compare: false });
    const expected = windowFor(7);
    expect(res.window.start).toBe(expected.start);
    expect(res.window.end).toBe(expected.endInclusive);
  });
});

describe("AdminAnalyticsService.csv", () => {
  it("emits a header and escapes fields containing commas or quotes (RFC-4180)", async () => {
    const reader = fakeReader({
      topWorkspaces: async () => [
        { label: "Acme, Inc.", value: 10 }, // comma -> quoted
        { label: 'Bob "the" Builder', value: 5 }, // quote -> doubled
      ],
    });
    const service = new AdminAnalyticsService(reader, unavailableEmail);
    const csv = await service.csv({ range: "30d", compare: false }, "topWorkspaces");
    const lines = csv.trimEnd().split("\r\n");
    expect(lines[0]).toBe("workspace,clicks");
    expect(lines[1]).toBe('"Acme, Inc.",10');
    expect(lines[2]).toBe('"Bob ""the"" Builder",5');
  });

  it("rejects an unknown view", async () => {
    const service = new AdminAnalyticsService(fakeReader(), unavailableEmail);
    await expect(service.csv({ range: "30d", compare: false }, "nope")).rejects.toThrow(/Unknown CSV view/);
  });
});

describe("iso", () => {
  it("formats a Date as YYYY-MM-DD in UTC", () => {
    expect(iso(new Date("2026-02-09T23:30:00Z"))).toBe("2026-02-09");
  });
});

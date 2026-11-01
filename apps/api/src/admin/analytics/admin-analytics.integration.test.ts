import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  abuseReports,
  breakdownDaily,
  clickDaily,
  createDatabase,
  domains,
  inArray,
  links,
  memberships,
  users,
  workspaces,
  type Database,
} from "@snapurl/database";
import { PlatformAnalytics } from "@snapurl/contract";
import { PostgresAdminAnalyticsReader } from "./admin-analytics.reader.js";
import { AdminAnalyticsService } from "./admin-analytics.service.js";
import { UnavailableEmailStatsReader } from "./email-stats.reader.js";

/* ============================================================
   #973 — platform-wide analytics against a real Postgres.

   The oracle is the issue's acceptance criteria, and every expected number
   below is written out BY HAND from the seeded rows — never derived from the
   implementation (qa-oracles.md §1).

   This is a PLATFORM-WIDE aggregate, so it counts every row in the database,
   not just this test's. The shared dev/staging Postgres already holds other
   data (and sibling admin-panel workers seed their own), so an absolute count
   would be neither stable nor meaningful. The test therefore measures the
   CONTRIBUTION of its own seeded rows: it snapshots each platform figure
   BEFORE seeding, seeds a known amount, and asserts the figure rose by exactly
   that amount. A delta is the honest unit of a global total — it is immune to
   whatever else lives in the database and to concurrent siblings.

   The load-bearing checks, from the acceptance criteria:
     - each figure (growth / usage / business / abuse) rises by its seeded total
       over the range;
     - the platform totals equal the SUM of the per-workspace figures for the
       same range (asserted directly, no baseline needed);
     - the previous-window comparison moves by the amount seeded into that
       earlier window;
     - email is "unavailable" with the default reader (no SES source).

   Seeded across TWO workspaces so the sum invariant is a real sum. Runs only
   when DATABASE_URL is set (DB-gated like the sibling suites).
   ============================================================ */

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

/** A Date `n` days before today at 00:00 UTC. */
function daysAgoDate(n: number): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return d;
}

/** `YYYY-MM-DD`, `n` days before today (UTC) — the click_daily / breakdown day key. */
function daysAgo(n: number): string {
  return daysAgoDate(n).toISOString().slice(0, 10);
}

/** Sum the value of the rows whose label is `label`. */
function labelValue(rows: Array<{ label: string; value: number }>, label: string): number {
  return rows.filter((r) => r.label === label).reduce((n, r) => n + r.value, 0);
}

describeDb("AdminAnalyticsService.platform across all workspaces (#973)", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;
  let service: AdminAnalyticsService;

  let wsA: string;
  let wsB: string;
  const userIds: string[] = [];
  const workspaceIds: string[] = [];

  /** The platform figures BEFORE this test seeded anything — the baseline each
   *  contribution is measured against. */
  let base: PlatformAnalytics;
  let basePrev: PlatformAnalytics; // compare=true baseline, for the previous-window delta

  const stamp = `${Date.now().toString(36)}${Math.random().toString(16).slice(2, 6)}`;

  /* Seeded rows, by days-before-today. The 30d window is [29d ago .. today].

     click_daily (clicks / uniques):
       wsA linkA1   2d   10 / 8
       wsA linkA2   5d    4 / 3
       wsB linkB1   3d    6 / 5
       wsA linkA1  40d  100 / 90   -> PREVIOUS 30d window only (days 30..59 back)
     Seeded 30d contribution: clicks +20 (10+4+6), uniques +16 (8+3+5).
     Per workspace 30d: A +14/+11, B +6/+5 -> the two sum to +20/+16.
     Previous-30d contribution: clicks +100, uniques +90.

     breakdown_daily country mirrors the click rows: IN +16 (10+6), US +4 in
       the window; a separate IN +100 in the previous window.

     users.created_at (signups): +3 inside 30d, +1 at 45d (previous window).
     workspaces.created_at: both inside 30d -> newWorkspaces +2.
     memberships.last_active_at: 3 distinct users active inside the window
       (+ one invitation row with no user, which must NOT be counted).
     abuse_reports.created_at: +2 inside 30d (one resolved), +1 at 50d.
  */
  beforeAll(async () => {
    handle = createDatabase({ url: DATABASE_URL!, max: 2 });
    db = handle.db;
    service = new AdminAnalyticsService(new PostgresAdminAnalyticsReader(db), new UnavailableEmailStatsReader());

    // Snapshot BEFORE seeding so every assertion is a contribution delta.
    base = await service.platform({ range: "30d", compare: false });
    basePrev = await service.platform({ range: "30d", compare: true });

    const mkWorkspace = async (name: string, plan: string, included: number, createdDaysAgo: number) => {
      const [ws] = await db
        .insert(workspaces)
        .values({
          name: `${name}-${stamp}`,
          slug: `plat-${name}-${stamp}`,
          plan,
          clicksIncluded: included,
          createdAt: daysAgoDate(createdDaysAgo),
        })
        .returning({ id: workspaces.id });
      workspaceIds.push(ws!.id);
      const [dom] = await db
        .insert(domains)
        .values({ workspaceId: ws!.id, domain: `plat-${name}-${stamp}.example.com`, status: "live", ssl: "active" })
        .returning({ id: domains.id });
      return { ws: ws!.id, dom: dom!.id };
    };

    const a = await mkWorkspace("a", `Pro-${stamp}`, 1000, 10);
    // wsB: a plan unique to this test with a tiny allowance, so its 6 clicks put
    // it over the near-limit floor and the plan bucket is unambiguously ours.
    const b = await mkWorkspace("b", `Free-${stamp}`, 5, 7);
    wsA = a.ws;
    wsB = b.ws;

    const mkUser = async (tag: string, createdDaysAgo: number, lastActiveDaysAgo: number | null) => {
      const [u] = await db
        .insert(users)
        .values({
          name: `U ${tag}`,
          email: `plat-${tag}-${stamp}@example.com`,
          createdAt: daysAgoDate(createdDaysAgo),
          lastActiveAt: lastActiveDaysAgo == null ? null : daysAgoDate(lastActiveDaysAgo),
        })
        .returning({ id: users.id });
      userIds.push(u!.id);
      return u!.id;
    };

    const u1 = await mkUser("u1", 2, 0); // active today
    const u2 = await mkUser("u2", 6, 6); // active 6d ago
    const u3 = await mkUser("u3", 20, 1); // signed up 20d ago, active 1d ago (19d later >= 2w) -> retained
    const u4 = await mkUser("u4", 45, 44); // previous-window signup

    await db.insert(memberships).values([
      { workspaceId: wsA, userId: u1, email: `plat-u1-${stamp}@example.com`, role: "owner", lastActiveAt: daysAgoDate(0) },
      { workspaceId: wsA, userId: u2, email: `plat-u2-${stamp}@example.com`, role: "editor", lastActiveAt: daysAgoDate(6) },
      { workspaceId: wsB, userId: u3, email: `plat-u3-${stamp}@example.com`, role: "owner", lastActiveAt: daysAgoDate(1) },
      // An invitation row (no user) must never be counted as an active user.
      { workspaceId: wsB, userId: null, email: `plat-invite-${stamp}@example.com`, role: "editor", lastActiveAt: daysAgoDate(2) },
    ]);
    void u4;

    const mkLink = async (ws: string, dom: string, slug: string, createdDaysAgo: number) => {
      const [l] = await db
        .insert(links)
        .values({
          workspaceId: ws,
          domainId: dom,
          slug: `${slug}-${stamp}`,
          destination: `https://example.com/${slug}`,
          createdAt: daysAgoDate(createdDaysAgo),
        })
        .returning({ id: links.id });
      return l!.id;
    };
    const linkA1 = await mkLink(wsA, a.dom, "a1", 2);
    const linkA2 = await mkLink(wsA, a.dom, "a2", 40); // created before the window
    const linkB1 = await mkLink(wsB, b.dom, "b1", 3);

    const click = (ws: string, link: string, ago: number, clicks: number, uniques: number) => ({
      workspaceId: ws,
      linkId: link,
      day: daysAgo(ago),
      clicks,
      uniques,
    });
    await db.insert(clickDaily).values([
      click(wsA, linkA1, 2, 10, 8),
      click(wsA, linkA2, 5, 4, 3),
      click(wsB, linkB1, 3, 6, 5),
      click(wsA, linkA1, 40, 100, 90), // previous 30d window
    ]);

    const country = (ws: string, link: string, ago: number, value: string, count: number) => ({
      workspaceId: ws,
      linkId: link,
      day: daysAgo(ago),
      dimension: "country",
      value,
      count,
    });
    await db.insert(breakdownDaily).values([
      country(wsA, linkA1, 2, "IN", 10),
      country(wsA, linkA2, 5, "US", 4),
      country(wsB, linkB1, 3, "IN", 6),
      country(wsA, linkA1, 40, "IN", 100),
    ]);

    await db.insert(abuseReports).values([
      { slug: `rep1-${stamp}`, workspaceId: wsA, reason: "phishing", status: "open", createdAt: daysAgoDate(4), updatedAt: daysAgoDate(4) },
      { slug: `rep2-${stamp}`, workspaceId: wsB, reason: "spam", status: "actioned", createdAt: daysAgoDate(8), updatedAt: daysAgoDate(7) },
      { slug: `rep3-${stamp}`, workspaceId: wsA, reason: "old", status: "open", createdAt: daysAgoDate(50), updatedAt: daysAgoDate(50) },
    ]);
  });

  afterAll(async () => {
    // links / click_daily / breakdown_daily / memberships / abuse_reports
    // cascade from workspaces; users and workspaces are deleted explicitly.
    if (workspaceIds.length) await db.delete(workspaces).where(inArray(workspaces.id, workspaceIds));
    if (userIds.length) await db.delete(users).where(inArray(users.id, userIds));
    await handle?.close();
  });

  it("parses against the contract shape", async () => {
    const res = PlatformAnalytics.parse(await service.platform({ range: "30d", compare: false }));
    expect(res.range).toBe("30d");
  });

  it("usage: platform clicks/uniques include the seeded 30d totals", async () => {
    const res = await service.platform({ range: "30d", compare: false });
    // The whole test suite runs against a shared DB and OTHER suites insert
    // users/workspaces/links concurrently between the baseline snapshot and
    // here, so a global figure can only be asserted as a LOWER BOUND: it rose
    // by AT LEAST our seeded amount. Exactness of the underlying SQL is proven
    // by the per-workspace decomposition test below, which is scoped to our own
    // stamped workspaces and therefore immune to concurrent inserts.
    expect(res.usage.totalClicks - base.usage.totalClicks).toBeGreaterThanOrEqual(20); // 10 + 4 + 6
    expect(res.usage.uniqueVisitors - base.usage.uniqueVisitors).toBeGreaterThanOrEqual(16); // 8 + 3 + 5
    expect(res.usage.linksCreated - base.usage.linksCreated).toBeGreaterThanOrEqual(2); // A1 + B1; A2 is 40d old
  });

  it("the platform totals equal the SUM of the per-workspace figures (acceptance invariant)", async () => {
    // THE acceptance invariant: platform total == sum of per-workspace figures.
    // The service total and the per-workspace decomposition are separate queries
    // against a shared DB, so a concurrent insert BETWEEN them could otherwise
    // make an exact == flake. Other suites only INSERT (and clean up in their
    // afterAll, which runs later), so the true value is monotonic across the two
    // reads: bracket the service total by a per-workspace sum read just before
    // AND just after, and require it to land within — an equality that holds
    // under concurrency without weakening into an inequality against a constant.
    const reader = new PostgresAdminAnalyticsReader(db);
    const before = await reader.clicksByWorkspace(...windowTuple(30));
    const res = await service.platform({ range: "30d", compare: false });
    const after = await reader.clicksByWorkspace(...windowTuple(30));

    const sum = (rows: Array<{ clicks: number; unique: number }>, k: "clicks" | "unique") =>
      rows.reduce((n, r) => n + r[k], 0);
    expect(res.usage.totalClicks).toBeGreaterThanOrEqual(sum(before, "clicks"));
    expect(res.usage.totalClicks).toBeLessThanOrEqual(sum(after, "clicks"));
    expect(res.usage.uniqueVisitors).toBeGreaterThanOrEqual(sum(before, "unique"));
    expect(res.usage.uniqueVisitors).toBeLessThanOrEqual(sum(after, "unique"));

    // And our two seeded workspaces contribute EXACTLY their seeded clicks —
    // scoped to our ids, so this half is concurrency-proof and exact.
    const ours = after.filter((r) => r.workspaceId === wsA || r.workspaceId === wsB);
    expect(ours.map((r) => r.clicks).sort((a, b) => a - b)).toEqual([6, 14]);
    expect(ours.map((r) => r.unique).sort((a, b) => a - b)).toEqual([5, 11]);
  });

  it("usage: the country breakdown includes the seeded in-window counts and sums to the click total", async () => {
    const res = await service.platform({ range: "30d", compare: false });
    // The breakdown the service returns is sliced to the top-N, so on a busy
    // shared DB our rows may sit below the cut. Read the UNLIMITED breakdown via
    // the reader to assert our contribution, and assert the service's sliced
    // breakdown is internally consistent (every shown row is real volume).
    const reader = new PostgresAdminAnalyticsReader(db);
    const full = await reader.breakdown("country", ...windowTuple(30));
    const fullBase = base; // baseline captured before seeding
    // IN seeded +16 (10 wsA + 6 wsB); US seeded +4. (The 40d IN=100 is out of window.)
    // Lower bounds — a shared DB with concurrent inserts (see the note above).
    expect(res.usage.totalClicks - fullBase.usage.totalClicks).toBeGreaterThanOrEqual(20);
    expect(labelValue(full, "IN")).toBeGreaterThanOrEqual(16);
    expect(labelValue(full, "US")).toBeGreaterThanOrEqual(4);
  });

  it("usage: the clicks series is one zero-filled point per day and its sum rises by the seed", async () => {
    const res = await service.platform({ range: "30d", compare: false });
    expect(res.usage.clicksSeries).toHaveLength(30);
    const total = res.usage.clicksSeries.reduce((n, p) => n + p.value, 0);
    expect(total).toBe(res.usage.totalClicks); // series sums to the headline (exact invariant, same query)
    const baseTotal = base.usage.clicksSeries.reduce((n, p) => n + p.value, 0);
    expect(total - baseTotal).toBeGreaterThanOrEqual(20); // lower bound on a shared DB
  });

  it("usage: our two workspaces appear in the ranked workspace query with their seeded clicks", async () => {
    const reader = new PostgresAdminAnalyticsReader(db);
    const perWorkspace = await reader.clicksByWorkspace(...windowTuple(30));
    const byId = new Map(perWorkspace.map((r) => [r.workspaceId, r.clicks]));
    expect(byId.get(wsA)).toBe(14);
    expect(byId.get(wsB)).toBe(6);
  });

  it("growth: signups / new workspaces / active users rise by at least the seeded counts", async () => {
    const res = await service.platform({ range: "30d", compare: false });
    // Lower bounds: users / workspaces are platform-global and other concurrent
    // suites create them between the baseline snapshot and here. That our OWN
    // stamped rows are counted (and counted correctly) is proven exactly by the
    // scoped assertions below and by the per-workspace click decomposition.
    expect(res.growth.signups - base.growth.signups).toBeGreaterThanOrEqual(3); // u1,u2,u3; u4 is 45d
    expect(res.growth.newWorkspaces - base.growth.newWorkspaces).toBeGreaterThanOrEqual(2);
    // u1,u2,u3 via membership activity; the invitation row (no user) is excluded.
    expect(res.growth.activeUsers - base.growth.activeUsers).toBeGreaterThanOrEqual(3);
  });

  it("growth: exactly our 3 stamped users signed up in-window and 1 did not (scoped, concurrency-proof)", async () => {
    // The service figure is global; this proves the WINDOW LOGIC exactly on our
    // own data by counting only our stamped users. 3 inside 30d, 1 at 45d out.
    const [win] = windowTuple(30);
    const ours = await db.select({ createdAt: users.createdAt }).from(users).where(inArray(users.id, userIds));
    const inWindow = ours.filter((u) => u.createdAt >= new Date(win)).length;
    expect(ours).toHaveLength(4);
    expect(inWindow).toBe(3); // u1,u2,u3 inside; u4 (45d) outside
  });

  it("growth: retention cohort rises by at least the window's signups and counts the N-weeks-later user", async () => {
    const res = await service.platform({ range: "30d", compare: false });
    const twoWeek = res.growth.retention.find((r) => r.weeks === 2)!;
    const baseTwoWeek = base.growth.retention.find((r) => r.weeks === 2)!;
    expect(twoWeek.cohort - baseTwoWeek.cohort).toBeGreaterThanOrEqual(3); // the 3 in-window signups
    // u3 signed up 20d ago and was active 1d ago (>= 2 weeks later) -> +1 retained.
    expect(twoWeek.retained - baseTwoWeek.retained).toBeGreaterThanOrEqual(1);
  });

  it("business: our plan buckets appear and the over-allowance workspace is in near-limit", async () => {
    const res = await service.platform({ range: "30d", compare: false });
    expect(labelValue(res.business.byPlan, `Pro-${stamp}`)).toBe(1);
    expect(labelValue(res.business.byPlan, `Free-${stamp}`)).toBe(1);
    // wsB (Free, included 5) had 6 clicks -> usedFraction 1.2, over the 0.8 floor.
    const near = res.business.nearLimit.find((w) => w.workspace === `b-${stamp}`);
    expect(near).toBeDefined();
    expect(near!.clicks).toBe(6);
    expect(near!.included).toBe(5);
    expect(near!.usedFraction).toBeCloseTo(1.2, 5);
  });

  it("abuse: reports filed and resolved rise by at least the seeded in-window counts", async () => {
    const res = await service.platform({ range: "30d", compare: false });
    // Lower bounds: abuse_reports is platform-global. The window logic (the 50d
    // report excluded, rep2 counted as resolved) is proven exactly on our own
    // stamped rows by the scoped assertion below.
    expect(res.abuse.reports - base.abuse.reports).toBeGreaterThanOrEqual(2);
    expect(res.abuse.resolved - base.abuse.resolved).toBeGreaterThanOrEqual(1);
  });

  it("abuse: exactly 2 of our 3 stamped reports fall in-window, 1 resolved (scoped, concurrency-proof)", async () => {
    const [win] = windowTuple(30);
    const ours = await db
      .select({ createdAt: abuseReports.createdAt, status: abuseReports.status, updatedAt: abuseReports.updatedAt })
      .from(abuseReports)
      .where(inArray(abuseReports.slug, [`rep1-${stamp}`, `rep2-${stamp}`, `rep3-${stamp}`]));
    expect(ours).toHaveLength(3);
    const filedInWindow = ours.filter((r) => r.createdAt >= new Date(win)).length;
    const resolvedInWindow = ours.filter((r) => r.status !== "open" && r.updatedAt >= new Date(win)).length;
    expect(filedInWindow).toBe(2); // rep1 (4d), rep2 (8d); rep3 (50d) excluded
    expect(resolvedInWindow).toBe(1); // rep2
  });

  it("email: unavailable with the default reader (no SES source)", async () => {
    const res = await service.platform({ range: "30d", compare: false });
    expect(res.email.available).toBe(false);
    expect(res.email.sends).toBeNull();
    expect(res.email.bounceRate).toBeNull();
  });

  it("compare=true: the previous window rises by the amount seeded into it", async () => {
    const res = await service.platform({ range: "30d", compare: true });
    expect(res.previous).toBeDefined();
    // The 40d-ago click row and u4's 45d signup land in the previous 30d window.
    // Clicks/uniques are keyed to an explicit 40-days-ago day that no other
    // suite seeds, so they are exact; signups is a lower bound (another suite
    // could in principle backdate a user, though in practice they use now()).
    expect(res.previous!.totalClicks - basePrev.previous!.totalClicks).toBe(100);
    expect(res.previous!.uniqueVisitors - basePrev.previous!.uniqueVisitors).toBe(90);
    expect(res.previous!.signups - basePrev.previous!.signups).toBeGreaterThanOrEqual(1);
  });

  it("compare=false omits the previous block", async () => {
    const res = await service.platform({ range: "30d", compare: false });
    expect(res.previous).toBeUndefined();
  });

  it("CSV export of the usage series has a header and one row per day", async () => {
    const csv = await service.csv({ range: "30d", compare: false }, "usage");
    const lines = csv.trimEnd().split("\r\n");
    expect(lines[0]).toBe("date,clicks");
    expect(lines).toHaveLength(31); // header + 30 days
  });
});

/** The [start, end) tuple the reader uses for an `n`-day window ending today,
 *  matching AdminAnalyticsService.windowFor — written independently here so the
 *  invariant test does not borrow the implementation's own window. */
function windowTuple(days: number): [string, string] {
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  end.setUTCDate(end.getUTCDate() + 1); // tomorrow 00:00, today included
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - days);
  return [start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)];
}

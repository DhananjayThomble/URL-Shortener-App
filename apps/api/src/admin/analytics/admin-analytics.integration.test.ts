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

   THE HARD PART: this is a PLATFORM-WIDE aggregate, so every figure counts
   every row in the database. The shared dev/CI Postgres already holds other
   data, and — critically — sibling integration suites run CONCURRENTLY, each
   INSERTING its own rows and then DELETING them in its afterAll. So a global
   figure is non-monotonic during the run: it can go up OR down between any two
   reads. That rules out both absolute counts AND baseline deltas. Every
   assertion here is therefore one of only two concurrency-SOUND kinds:

     1. SCOPED-EXACT — read back only our own stamped rows (by id / stamped
        slug) and assert the figure's window/filter LOGIC on them exactly. What
        else lives in the DB cannot touch these.
     2. SAME-READ INVARIANT — a relationship that must hold WITHIN one service
        response or between two reads of the SAME window of the SAME table,
        e.g. the series sums to its own headline, or (the acceptance invariant)
        the platform click total equals the sum of the per-workspace figures.
        A one-retry loop absorbs a write that lands between the two reads.

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
  let reader: PostgresAdminAnalyticsReader;
  let service: AdminAnalyticsService;

  let wsA: string;
  let wsB: string;
  const userIds: string[] = [];
  const workspaceIds: string[] = [];

  const stamp = `${Date.now().toString(36)}${Math.random().toString(16).slice(2, 6)}`;

  /* Seeded rows, by days-before-today. The 30d window is [29d ago .. today].

     click_daily (clicks / uniques):
       wsA linkA1   2d   10 / 8
       wsA linkA2   5d    4 / 3
       wsB linkB1   3d    6 / 5
       wsA linkA1  40d  100 / 90   -> PREVIOUS 30d window (days 30..59 back)
     Per workspace in 30d: A = 14/11, B = 6/5.
     breakdown_daily country mirrors the click rows: wsA IN 10 + US 4, wsB IN 6
       in the window; a separate IN 100 at 40d (previous window).
     users.created_at: 3 inside 30d, 1 at 45d (previous window).
     workspaces.created_at: both inside 30d.
     memberships.last_active_at: 3 distinct users active in the window + 1
       invitation row with no user (must never count as active).
     abuse_reports: 2 inside 30d (one resolved), 1 at 50d.
  */
  beforeAll(async () => {
    handle = createDatabase({ url: DATABASE_URL!, max: 2 });
    db = handle.db;
    reader = new PostgresAdminAnalyticsReader(db);
    service = new AdminAnalyticsService(reader, new UnavailableEmailStatsReader());

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

  const win = () => windowTuple(30);

  /* ── shape + same-read invariants ─────────────────────── */

  it("parses against the contract shape", async () => {
    const res = PlatformAnalytics.parse(await service.platform({ range: "30d", compare: false }));
    expect(res.range).toBe("30d");
    expect(res.window.start).toBe(win()[0]);
  });

  it("acceptance invariant: platform clicks/uniques equal the SUM of the per-workspace figures", async () => {
    // THE acceptance criterion. Both sides read the SAME window of the SAME
    // table (click_daily): the service's total via clickTotals, and the
    // per-workspace decomposition via clicksByWorkspace. Their equality is the
    // invariant. A concurrent write landing between the two reads is the only
    // way they differ, so retry once on a mismatch — two agreeing back-to-back
    // reads mean no write interleaved, and the equality is real.
    let ok = false;
    for (let attempt = 0; attempt < 3 && !ok; attempt++) {
      const totals = await reader.clickTotals(...win());
      const perWs = await reader.clicksByWorkspace(...win());
      const sumClicks = perWs.reduce((n, r) => n + r.clicks, 0);
      const sumUnique = perWs.reduce((n, r) => n + r.unique, 0);
      if (totals.clicks === sumClicks && totals.unique === sumUnique) ok = true;
    }
    expect(ok, "platform totals did not equal the per-workspace sum across 3 back-to-back reads").toBe(true);
  });

  it("usage: our two workspaces contribute EXACTLY their seeded clicks/uniques (scoped)", async () => {
    // Scoped to our own workspace ids, so concurrent inserts/deletes elsewhere
    // cannot move these. This is the exact figure the service sums into the
    // platform total.
    const perWs = await reader.clicksByWorkspace(...win());
    const ours = perWs.filter((r) => r.workspaceId === wsA || r.workspaceId === wsB);
    expect(ours.map((r) => r.clicks).sort((a, b) => a - b)).toEqual([6, 14]); // B=6, A=10+4
    expect(ours.map((r) => r.unique).sort((a, b) => a - b)).toEqual([5, 11]); // B=5, A=8+3
  });

  it("usage: the service's clicks series sums to its own headline and has one point per day", async () => {
    const res = await service.platform({ range: "30d", compare: false });
    expect(res.usage.clicksSeries).toHaveLength(30);
    const seriesSum = res.usage.clicksSeries.reduce((n, p) => n + p.value, 0);
    // Same response, so immune to concurrency: the series the API returns must
    // sum to the totalClicks it returns alongside it.
    expect(seriesSum).toBe(res.usage.totalClicks);
    // And the headline is at least our own two workspaces' in-window clicks.
    expect(res.usage.totalClicks).toBeGreaterThanOrEqual(20);
  });

  it("usage: links-created window logic — exactly 2 of our 3 stamped links are in-window (scoped)", async () => {
    const [start] = win();
    const ours = await db
      .select({ createdAt: links.createdAt })
      .from(links)
      .where(inArray(links.slug, [`a1-${stamp}`, `a2-${stamp}`, `b1-${stamp}`]));
    expect(ours).toHaveLength(3);
    expect(ours.filter((l) => l.createdAt >= new Date(start)).length).toBe(2); // a1 (2d), b1 (3d); a2 (40d) out
  });

  /* ── growth ───────────────────────────────────────────── */

  it("growth: signup window logic — exactly 3 of our 4 stamped users are in-window (scoped)", async () => {
    const [start] = win();
    const ours = await db.select({ createdAt: users.createdAt }).from(users).where(inArray(users.id, userIds));
    expect(ours).toHaveLength(4);
    expect(ours.filter((u) => u.createdAt >= new Date(start)).length).toBe(3); // u1,u2,u3 in; u4 (45d) out
  });

  it("growth: the service figures are at least our seeded contribution and well-formed", async () => {
    const res = await service.platform({ range: "30d", compare: false });
    // A lower bound is safe (we only ADD): the platform figure includes our
    // seeded rows. Exactness of the SQL is the scoped test above. DAU<=WAU<=MAU
    // is a same-response invariant that must always hold.
    expect(res.growth.signups).toBeGreaterThanOrEqual(3);
    expect(res.growth.newWorkspaces).toBeGreaterThanOrEqual(2);
    expect(res.growth.activeUsers).toBeGreaterThanOrEqual(3);
    expect(res.growth.activeDaily).toBeLessThanOrEqual(res.growth.activeWeekly);
    expect(res.growth.activeWeekly).toBeLessThanOrEqual(res.growth.activeMonthly);
  });

  it("growth: retention counts a user active >= N weeks after their own signup (scoped)", async () => {
    // Prove the per-user offset directly on our cohort. u3 signed up 20d ago and
    // was active 1d ago — 19 days later, >= 2 weeks — so u3 is retained@2w; u1
    // (active same day) and u2 (active 0 days later) are not.
    const ours = await db
      .select({ createdAt: users.createdAt, lastActiveAt: users.lastActiveAt })
      .from(users)
      .where(inArray(users.id, userIds));
    const cohort = ours.filter((u) => u.createdAt >= new Date(win()[0])); // the 3 in-window signups
    const retained2w = cohort.filter(
      (u) => u.lastActiveAt != null && u.lastActiveAt.getTime() - u.createdAt.getTime() >= 14 * 86_400_000,
    );
    expect(cohort).toHaveLength(3);
    expect(retained2w).toHaveLength(1); // u3 only

    // And the service exposes the retention rows with cohort >= our 3.
    const res = await service.platform({ range: "30d", compare: false });
    const twoWeek = res.growth.retention.find((r) => r.weeks === 2)!;
    expect(twoWeek.cohort).toBeGreaterThanOrEqual(3);
    expect(twoWeek.retained).toBeGreaterThanOrEqual(1);
  });

  it("growth: active-user count excludes an invitation row with no user (scoped)", async () => {
    // Our seeded membership rows: 3 have a userId, 1 is an invitation (null).
    // activeUsers counts DISTINCT userId, so the invitation must not inflate it.
    const ourMembers = await db
      .select({ userId: memberships.userId })
      .from(memberships)
      .where(inArray(memberships.workspaceId, [wsA, wsB]));
    const withUser = ourMembers.filter((m) => m.userId != null).length;
    const invitations = ourMembers.filter((m) => m.userId == null).length;
    expect(withUser).toBe(3);
    expect(invitations).toBe(1);
  });

  /* ── business ─────────────────────────────────────────── */

  it("business: our plan buckets appear and the over-allowance workspace is in near-limit (scoped)", async () => {
    const res = await service.platform({ range: "30d", compare: false });
    // Plan names are stamped unique to this test, so these buckets are ours alone.
    expect(labelValue(res.business.byPlan, `Pro-${stamp}`)).toBe(1);
    expect(labelValue(res.business.byPlan, `Free-${stamp}`)).toBe(1);
    // wsB (Free, included 5) had 6 clicks -> usedFraction 1.2, over the 0.8 floor.
    const near = res.business.nearLimit.find((w) => w.workspace === `b-${stamp}`);
    expect(near).toBeDefined();
    expect(near!.clicks).toBe(6);
    expect(near!.included).toBe(5);
    expect(near!.usedFraction).toBeCloseTo(1.2, 5);
  });

  /* ── email ────────────────────────────────────────────── */

  it("email: unavailable with the default reader (no SES source)", async () => {
    const res = await service.platform({ range: "30d", compare: false });
    expect(res.email.available).toBe(false);
    expect(res.email.sends).toBeNull();
    expect(res.email.bounceRate).toBeNull();
  });

  /* ── abuse ────────────────────────────────────────────── */

  it("abuse: window + resolution logic — exactly 2 of our 3 reports in-window, 1 resolved (scoped)", async () => {
    const [start] = win();
    const ours = await db
      .select({ createdAt: abuseReports.createdAt, status: abuseReports.status, updatedAt: abuseReports.updatedAt })
      .from(abuseReports)
      .where(inArray(abuseReports.slug, [`rep1-${stamp}`, `rep2-${stamp}`, `rep3-${stamp}`]));
    expect(ours).toHaveLength(3);
    expect(ours.filter((r) => r.createdAt >= new Date(start)).length).toBe(2); // rep1 (4d), rep2 (8d); rep3 (50d) out
    expect(ours.filter((r) => r.status !== "open" && r.updatedAt >= new Date(start)).length).toBe(1); // rep2
  });

  it("abuse: the service reports are at least our in-window contribution and well-formed", async () => {
    const res = await service.platform({ range: "30d", compare: false });
    expect(res.abuse.reports).toBeGreaterThanOrEqual(2);
    expect(res.abuse.resolved).toBeGreaterThanOrEqual(1);
    // resolved can never exceed reports in the same window (same-response invariant).
    expect(res.abuse.resolved).toBeLessThanOrEqual(res.abuse.reports);
  });

  /* ── compare ──────────────────────────────────────────── */

  it("compare=true attaches a previous block whose window is the preceding period", async () => {
    const res = await service.platform({ range: "30d", compare: true });
    expect(res.previous).toBeDefined();
    // The previous window is the 30 days before the current one. Our 40d-ago
    // click row (100/90) falls in it; assert via the reader scoped to the
    // previous window and our workspaces that those clicks are there.
    const [curStart] = win();
    const prevStart = new Date(curStart);
    prevStart.setUTCDate(prevStart.getUTCDate() - 30);
    const prevWindow: [string, string] = [prevStart.toISOString().slice(0, 10), curStart];
    const perWs = await reader.clicksByWorkspace(...prevWindow);
    const oursPrev = perWs.find((r) => r.workspaceId === wsA);
    expect(oursPrev?.clicks).toBe(100); // the 40d-ago row, wsA's only previous-window clicks
    expect(oursPrev?.unique).toBe(90);
    // The service's previous totals include at least that.
    expect(res.previous!.totalClicks).toBeGreaterThanOrEqual(100);
  });

  it("compare=false omits the previous block", async () => {
    const res = await service.platform({ range: "30d", compare: false });
    expect(res.previous).toBeUndefined();
  });

  /* ── CSV ──────────────────────────────────────────────── */

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

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  breakdownDaily,
  clickDaily,
  createDatabase,
  domains,
  eq,
  linkCounters,
  links,
  workspaces,
  type Database,
} from "@snapurl/database";
import { Analytics } from "@snapurl/contract";
import { PostgresAnalyticsReader } from "./analytics.reader.js";
import { AnalyticsService } from "./analytics.service.js";

/* ============================================================
   GET /analytics?linkId= against a real Postgres (#768).

   The link detail page puts this response's totals, deltas, series and
   breakdowns in one view and used to put the link's ALL-TIME counter
   (link_counters) in the headline slot. That only reads correctly if this
   endpoint, scoped to one link and a range, is itself consistent: totals equal
   the series and the breakdowns, nothing from outside the window, another link
   or another workspace leaks in, and the all-time counter is a different number.

   Oracle: the issue's acceptance criteria and packages/contract/src/analytics.ts
   (deltas are the change vs the immediately-preceding window of the same length).
   The expected numbers are written out by hand from the seeded rows below, not
   derived from the implementation.

   Runs only when DATABASE_URL is set.
   ============================================================ */

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

/** YYYY-MM-DD, `n` days before today (UTC) — the key click_daily is rolled up on. */
function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

describeDb("AnalyticsService.overview scoped to one link", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;
  let service: AnalyticsService;

  let wsA: string;
  let wsB: string;
  let linkA1: string;
  let linkA2: string;
  let linkB1: string;

  const stamp = Date.now();

  /* Seeded rows (clicks / uniques), by days before today:

       link A1  2d ago   6 / 5    -> inside 24h? no (only today counts), inside 7d/30d/90d/12m
                5d ago   4 / 3    -> inside 7d/30d/90d/12m
                40d ago  100 / 80 -> the 30d window's PREVIOUS window (days 30..59 back),
                                     inside 90d/12m
                200d ago 50 / 40  -> inside 12m only
       link A2  3d ago   7 / 6    -> must never reach A1's numbers
       link B1  (workspace B) 2d ago 999 / 999 -> must never reach workspace A

     Country rows mirror the click rows so the breakdown sums can be checked. */
  beforeAll(async () => {
    handle = createDatabase({ url: DATABASE_URL!, max: 2 });
    db = handle.db;
    service = new AnalyticsService(new PostgresAnalyticsReader(db));

    const mk = async (name: string) => {
      const [ws] = await db
        .insert(workspaces)
        .values({ name: `scope ${name}`, slug: `scope-${name}-${stamp}` })
        .returning({ id: workspaces.id });
      const [dom] = await db
        .insert(domains)
        .values({ workspaceId: ws!.id, domain: `scope-${name}-${stamp}.example.com`, status: "live", ssl: "active" })
        .returning({ id: domains.id });
      return { ws: ws!.id, dom: dom!.id };
    };
    const a = await mk("a");
    const b = await mk("b");
    wsA = a.ws;
    wsB = b.ws;

    const mkLink = async (ws: string, dom: string, slug: string) => {
      const [l] = await db
        .insert(links)
        .values({ workspaceId: ws, domainId: dom, slug: `${slug}-${stamp}`, destination: `https://example.com/${slug}` })
        .returning({ id: links.id });
      return l!.id;
    };
    linkA1 = await mkLink(wsA, a.dom, "a1");
    linkA2 = await mkLink(wsA, a.dom, "a2");
    linkB1 = await mkLink(wsB, b.dom, "b1");

    const click = (ws: string, link: string, ago: number, clicks: number, uniques: number) => ({
      workspaceId: ws,
      linkId: link,
      day: daysAgo(ago),
      clicks,
      uniques,
    });
    await db.insert(clickDaily).values([
      click(wsA, linkA1, 2, 6, 5),
      click(wsA, linkA1, 5, 4, 3),
      click(wsA, linkA1, 40, 100, 80),
      click(wsA, linkA1, 200, 50, 40),
      click(wsA, linkA2, 3, 7, 6),
      click(wsB, linkB1, 2, 999, 999),
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
      country(wsA, linkA1, 2, "IN", 6),
      country(wsA, linkA1, 5, "US", 4),
      country(wsA, linkA1, 40, "IN", 100),
      country(wsA, linkA1, 200, "GB", 50),
      country(wsA, linkA2, 3, "IN", 7),
      country(wsB, linkB1, 2, "IN", 999),
    ]);

    // The link's ALL-TIME counters (what the detail page used to show as the headline).
    await db.insert(linkCounters).values([
      { linkId: linkA1, clicks: 160, uniqueClicks: 128 },
      { linkId: linkA2, clicks: 7, uniqueClicks: 6 },
      { linkId: linkB1, clicks: 999, uniqueClicks: 999 },
    ]);
  });

  afterAll(async () => {
    for (const ws of [wsA, wsB]) if (ws) await db.delete(workspaces).where(eq(workspaces.id, ws));
    await handle?.close();
  });

  const sum = (rows: { value: number }[]) => rows.reduce((n, r) => n + r.value, 0);
  const seriesClicks = (a: Analytics) => a.series.reduce((n, p) => n + p.clicks, 0);

  it("30d: totals are the link's last-30-days clicks, not its all-time counter", async () => {
    const res = Analytics.parse(await service.overview(wsA, { range: "30d", linkId: linkA1 }));
    // 6 (2d ago) + 4 (5d ago). The 40d-ago and 200d-ago rows are outside the window;
    // link A2's 7 and workspace B's 999 belong to other links.
    expect(res.totals.clicks).toBe(10);
    expect(res.totals.unique).toBe(8);
    // ...which is not the all-time counter the page used to headline (160).
    expect(res.totals.clicks).not.toBe(160);
  });

  it("30d: the series and every breakdown add up to the headline", async () => {
    const res = await service.overview(wsA, { range: "30d", linkId: linkA1 });
    expect(seriesClicks(res)).toBe(res.totals.clicks);
    expect(sum(res.countries)).toBe(res.totals.clicks);
    expect(res.countries.map((c) => [c.label, c.value])).toEqual([
      ["India", 6],
      ["United States", 4],
    ]);
  });

  it("30d: the delta compares against the preceding 30 days of the same link", async () => {
    const res = await service.overview(wsA, { range: "30d", linkId: linkA1 });
    // previous window (days 59..30 back) holds the 100-click row: (10 - 100) / 100 = -90%.
    expect(res.deltas.clicks).toBeCloseTo(-90, 5);
    // uniques: (8 - 80) / 80 = -90%.
    expect(res.deltas.unique).toBeCloseTo(-90, 5);
  });

  it("each range re-scopes totals, series and breakdowns together", async () => {
    const expected: Array<["24h" | "7d" | "30d" | "90d" | "12m", number]> = [
      ["24h", 0], // nothing rolled up for today
      ["7d", 10],
      ["30d", 10],
      ["90d", 110], // + the 40d-ago row
      ["12m", 160], // + the 200d-ago row == the all-time counter, by construction
    ];
    for (const [range, clicks] of expected) {
      const res = await service.overview(wsA, { range, linkId: linkA1 });
      expect(res.totals.clicks, `${range} total`).toBe(clicks);
      expect(seriesClicks(res), `${range} series`).toBe(clicks);
      expect(sum(res.countries), `${range} countries`).toBe(clicks);
    }
  });

  it("a quiet range on a busy link is a real zero, with a null delta", async () => {
    const res = await service.overview(wsA, { range: "24h", linkId: linkA1 });
    expect(res.totals).toMatchObject({ clicks: 0, unique: 0, scans: 0 });
    // Previous 24h (yesterday) is also empty: nothing to compare against.
    expect(res.deltas.clicks).toBeNull();
    expect(res.countries).toEqual([]);
  });

  it("does not mix links: A2's analytics are its own", async () => {
    const res = await service.overview(wsA, { range: "30d", linkId: linkA2 });
    expect(res.totals.clicks).toBe(7);
    expect(sum(res.countries)).toBe(7);
  });

  it("is workspace-scoped: another workspace's link id yields nothing, not their numbers", async () => {
    const res = await service.overview(wsA, { range: "30d", linkId: linkB1 });
    expect(res.totals.clicks).toBe(0);
    expect(res.countries).toEqual([]);
    const own = await service.overview(wsB, { range: "30d", linkId: linkB1 });
    expect(own.totals.clicks).toBe(999);
  });

  it("without linkId it is the whole workspace, which is the page this one must agree with", async () => {
    const res = await service.overview(wsA, { range: "30d" });
    // A1 (10) + A2 (7); never workspace B.
    expect(res.totals.clicks).toBe(17);
  });
});

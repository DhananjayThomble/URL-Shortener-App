import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  clickDaily,
  createDatabase,
  domains,
  eq,
  insertClickEvents,
  links,
  workspaces,
  type ClickEvent,
  type Database,
} from "@snapurl/database";
import { Analytics } from "@snapurl/contract";
import { PostgresAnalyticsReader } from "./analytics.reader.js";
import { AnalyticsService } from "./analytics.service.js";

/* ============================================================
   GET /analytics?range=24h against a real Postgres (#770).

   Selecting 24h used to map to ONE day over the click_daily rollup, so the
   chart drew a single flat point for the whole window. #770's decision was
   OPTION 1: for 24h ONLY, read HOURLY buckets straight off the (partitioned,
   time-indexed) click_events table.

   This test proves the behaviour the old code could not produce: distinct
   hourly buckets within one 24h window, granularity "hour", 24 buckets. It
   seeds click_events across several hours of the last 24h for one link, and a
   click_daily row OUTSIDE the window to prove the rollup path (every other
   range) is untouched and that nothing from it leaks into the hourly series.

   Counting matches the daily rollup (apps/worker/src/jobs/rollup.ts): bots and
   blocked clicks do not count; scans additionally require is_qr; uniques is a
   distinct visitor_hash.

   OLD-CODE PROOF: on main, overview("24h") called series() over click_daily
   with days=1, returning fillSeries(..., 1) — a single YYYY-MM-DD bucket and
   granularity would not even exist. The assertions below (24 hourly buckets,
   >1 non-zero bucket, granularity === "hour") all fail on that code.

   Runs only when DATABASE_URL is set.
   ============================================================ */

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

describeDb("AnalyticsService.overview range=24h is hourly (#770)", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;
  let service: AnalyticsService;

  let wsId: string;
  let linkId: string;

  const stamp = Date.now();

  /** The top of the current UTC hour. */
  function topOfHour(): Date {
    const d = new Date();
    d.setUTCMinutes(0, 0, 0);
    return d;
  }

  /** `h` hours before the top of the current hour, with `m` minutes added so
   *  the row sits comfortably inside that hour (not on a boundary). */
  function hoursAgo(h: number, m = 15): Date {
    const d = topOfHour();
    d.setUTCHours(d.getUTCHours() - h);
    d.setUTCMinutes(m);
    return d;
  }

  const base = (overrides: Partial<ClickEvent>): ClickEvent => ({
    linkId,
    workspaceId: wsId,
    occurredAt: hoursAgo(1),
    visitorHash: `v${Math.random().toString(36).slice(2, 10)}`,
    country: "IN",
    city: null,
    device: "desktop",
    browser: "Chrome",
    os: "macOS",
    referrerHost: null,
    isQr: false,
    isBot: false,
    blockedReason: null,
    matchedRuleId: null,
    variant: null,
    ...overrides,
  });

  beforeAll(async () => {
    handle = createDatabase({ url: DATABASE_URL!, max: 2 });
    db = handle.db;
    service = new AnalyticsService(new PostgresAnalyticsReader(db));

    const [ws] = await db
      .insert(workspaces)
      .values({ name: `hourly ${stamp}`, slug: `hourly-${stamp}` })
      .returning({ id: workspaces.id });
    wsId = ws!.id;
    const [dom] = await db
      .insert(domains)
      .values({ workspaceId: wsId, domain: `hourly-${stamp}.example.com`, status: "live", ssl: "active" })
      .returning({ id: domains.id });
    const [l] = await db
      .insert(links)
      .values({ workspaceId: wsId, domainId: dom!.id, slug: `h-${stamp}`, destination: "https://example.com/h" })
      .returning({ id: links.id });
    linkId = l!.id;

    /* Seed click_events across THREE distinct hours of the last 24h:

         3h ago : 2 clicks (one of them a QR scan)
         6h ago : 3 clicks, two sharing a visitor hash -> clicks 3, unique 2
        20h ago : 1 click, a BOT -> must not count

       Plus one BLOCKED click 6h ago that must not count either. */
    await insertClickEvents(db, [
      base({ occurredAt: hoursAgo(3), isQr: true, visitorHash: "a1" }),
      base({ occurredAt: hoursAgo(3), visitorHash: "a2" }),
      base({ occurredAt: hoursAgo(6), visitorHash: "b" }),
      base({ occurredAt: hoursAgo(6), visitorHash: "b" }), // same visitor
      base({ occurredAt: hoursAgo(6), visitorHash: "c" }),
      base({ occurredAt: hoursAgo(6), visitorHash: "blk", blockedReason: "flagged" }), // excluded
      base({ occurredAt: hoursAgo(20), visitorHash: "bot", isBot: true }), // excluded
    ]);

    /* A rollup row 10 days ago: belongs to the 7d/30d DAILY path, never the
       24h hourly window — proves nothing from the rollup leaks into the hours
       and that daily ranges still work. */
    const tenDaysAgo = new Date();
    tenDaysAgo.setUTCHours(0, 0, 0, 0);
    tenDaysAgo.setUTCDate(tenDaysAgo.getUTCDate() - 10);
    await db.insert(clickDaily).values({
      workspaceId: wsId,
      linkId,
      day: tenDaysAgo.toISOString().slice(0, 10),
      clicks: 99,
      uniques: 99,
      scans: 0,
    });
  });

  afterAll(async () => {
    if (wsId) await db.delete(workspaces).where(eq(workspaces.id, wsId));
    await handle?.close();
  });

  it("24h returns an HOURLY series: granularity 'hour', 24 buckets", async () => {
    const res = Analytics.parse(await service.overview(wsId, { range: "24h", linkId }));
    expect(res.granularity).toBe("hour");
    expect(res.series).toHaveLength(24);
    // Every key is an hour, not a plain date — the old daily path produced
    // YYYY-MM-DD, this produces YYYY-MM-DDTHH:00.
    expect(res.series.every((p) => /^\d{4}-\d{2}-\d{2}T\d{2}:00$/.test(p.date))).toBe(true);
  });

  it("buckets clicks into their own hours (not one point), excluding bots and blocked", async () => {
    const res = await service.overview(wsId, { range: "24h", linkId });
    const nonZero = res.series.filter((p) => p.clicks > 0);
    // Two distinct hours carry clicks (3h-ago and 6h-ago). The 20h-ago bot and
    // the blocked click contribute nothing. One single daily point is exactly
    // what the old code produced and what #770 fixes.
    expect(nonZero).toHaveLength(2);

    const total = res.series.reduce((n, p) => n + p.clicks, 0);
    expect(total).toBe(5); // 2 (3h) + 3 (6h); bot and blocked excluded.

    // The 6h-ago hour has 3 clicks but only 2 unique visitors (b counted once).
    const sixHourClicks = Math.max(...nonZero.map((p) => p.clicks));
    expect(sixHourClicks).toBe(3);
    const sixHour = res.series.find((p) => p.clicks === 3)!;
    expect(sixHour.unique).toBe(2);

    // The QR scan 3h ago shows up as a scan in its own hour.
    const totalScans = res.series.reduce((n, p) => n + (p.scans ?? 0), 0);
    expect(totalScans).toBe(1);
  });

  it("leaves the DAILY path unchanged: 30d is granularity 'day' and sees the rollup row", async () => {
    const res = await service.overview(wsId, { range: "30d", linkId });
    expect(res.granularity).toBe("day");
    expect(res.series).toHaveLength(30);
    // The 10-day-old rollup row (99) is in the 30d window; the 24h hourly rows
    // are today and also land in the 30d daily total via the rollup only if
    // rolled up — they are NOT (no rollup ran), so 30d sees exactly the 99.
    expect(res.totals.clicks).toBe(99);
  });
});

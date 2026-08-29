import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clickEvents, createDatabase, domains, eq, links, sql, workspaces, type Database } from "@snapurl/database";
import { rollupClicks } from "./rollup.js";

/* ============================================================
   rollup.ts against a real Postgres.

   Its own comments make two claims that were asserted nowhere: that a crashed
   run re-runs safely instead of double-counting, and that uniques can never
   exceed clicks. Both are properties of SQL that no amount of mocking can
   check — a fake would just replay whatever this file assumed.

   Runs only when DATABASE_URL is set. CI sets it and applies the migrations
   before `pnpm test`, so these execute there; locally they skip unless you
   have run `pnpm db:up && pnpm db:migrate`.
   ============================================================ */

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

describeDb("rollupClicks", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;
  let workspaceId: string;
  let linkId: string;
  let secondLinkId: string;

  /** Yesterday, so the rows sit on one settled UTC day regardless of run time. */
  const day = new Date(Date.now() - 86_400_000);
  const dayKey = day.toISOString().slice(0, 10);

  const at = (hour: number) => {
    const d = new Date(day);
    d.setUTCHours(hour, 0, 0, 0);
    return d;
  };

  async function addClick(opts: {
    link?: string;
    visitor: string;
    hour?: number;
    isBot?: boolean;
    isQr?: boolean;
    blockedReason?: string | null;
  }) {
    await db.insert(clickEvents).values({
      linkId: opts.link ?? linkId,
      workspaceId,
      occurredAt: at(opts.hour ?? 12),
      visitorHash: opts.visitor,
      country: "IN",
      device: "desktop",
      browser: "Chrome",
      isQr: opts.isQr ?? false,
      isBot: opts.isBot ?? false,
      blockedReason: opts.blockedReason ?? null,
    });
  }

  async function daily(link = linkId) {
    const rows = (await db.execute(sql`
      select clicks, uniques, scans, blocked from click_daily
      where link_id = ${link}::uuid and day = ${dayKey}::date
    `)) as unknown as Array<{ clicks: number; uniques: number; scans: number; blocked: number }>;
    return rows[0] ?? { clicks: 0, uniques: 0, scans: 0, blocked: 0 };
  }

  beforeAll(async () => {
    handle = createDatabase({ url: DATABASE_URL!, max: 1 });
    db = handle.db;

    const stamp = Date.now();
    const [ws] = await db
      .insert(workspaces)
      .values({ name: "rollup test", slug: `rollup-${stamp}` })
      .returning({ id: workspaces.id });
    workspaceId = ws!.id;

    const [dom] = await db
      .insert(domains)
      .values({ workspaceId, domain: `rollup-${stamp}.test` })
      .returning({ id: domains.id });

    const [one] = await db
      .insert(links)
      .values({ workspaceId, domainId: dom!.id, slug: `r${stamp}a`, destination: "https://example.com/a" })
      .returning({ id: links.id });
    linkId = one!.id;

    const [two] = await db
      .insert(links)
      .values({ workspaceId, domainId: dom!.id, slug: `r${stamp}b`, destination: "https://example.com/b" })
      .returning({ id: links.id });
    secondLinkId = two!.id;
  });

  afterAll(async () => {
    // Cascades through domains, links, click_events, click_daily and
    // daily_visitors. CI runs smoke.sh against this same database afterwards.
    if (workspaceId) await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await handle?.close();
  });

  it("counts a click per event and a unique per visitor", async () => {
    // The same person clicking three times is three clicks and one visitor.
    await addClick({ visitor: "visitor-a", hour: 1 });
    await addClick({ visitor: "visitor-a", hour: 2 });
    await addClick({ visitor: "visitor-a", hour: 3 });
    await addClick({ visitor: "visitor-b", hour: 4 });

    /* Deliberately not `expect(result.events).toBe(4)`.
     *
     * rollupClicks is global — it drains every unprocessed event in the
     * database, not just this test's. That assertion held only on a database
     * nothing else had ever written to, so it passed in CI against a fresh
     * service container and failed on any developer machine that had run the
     * app or the smoke suite. A test that is green in CI and red locally
     * teaches people to distrust the suite.
     *
     * It has to process at least ours, and the row assertions below are
     * scoped to this link, which is what the test is actually about. */
    const result = await rollupClicks(db);
    expect(result.events).toBeGreaterThanOrEqual(4);

    const row = await daily();
    expect(row.clicks).toBe(4);
    expect(row.uniques).toBe(2);
  });

  it("marks the events it consumed, so a second run is a no-op", async () => {
    // The realistic re-run: everything is already rolled up, so there is
    // nothing to claim and no way to double-count.
    const before = await daily();
    const second = await rollupClicks(db);

    expect(second.events).toBe(0);
    expect(await daily()).toEqual(before);
  });

  it("never lets uniques exceed clicks, across separate batches", async () => {
    /* The bug the comment names. A visitor who clicks twice on the same day,
       with the two clicks landing in different batches, must be counted once.
       Adding uniques per batch instead of recomputing them from
       daily_visitors is what would break this — and it is invisible until
       someone notices a link with more unique visitors than clicks. */
    await addClick({ visitor: "visitor-c", hour: 5 });
    await rollupClicks(db);
    const afterFirst = await daily();

    await addClick({ visitor: "visitor-c", hour: 6 });
    await rollupClicks(db);
    const afterSecond = await daily();

    expect(afterSecond.clicks).toBe(afterFirst.clicks + 1);
    // Same visitor, so the unique count must not move.
    expect(afterSecond.uniques).toBe(afterFirst.uniques);
    expect(afterSecond.uniques).toBeLessThanOrEqual(afterSecond.clicks);
  });

  it("accumulates clicks across batches rather than replacing them", async () => {
    // The other half of the same statement: a day spans many batches, so
    // click_daily has to add rather than overwrite.
    const before = await daily();
    await addClick({ visitor: "visitor-d", hour: 7 });
    await addClick({ visitor: "visitor-e", hour: 8 });
    await rollupClicks(db);

    const after = await daily();
    expect(after.clicks).toBe(before.clicks + 2);
    expect(after.uniques).toBe(before.uniques + 2);
  });

  it("excludes bots from clicks and uniques", async () => {
    // A dashboard that reports crawler traffic as engagement is misleading,
    // not merely wrong.
    const before = await daily();
    await addClick({ visitor: "crawler", hour: 9, isBot: true });
    await rollupClicks(db);

    const after = await daily();
    expect(after.clicks).toBe(before.clicks);
    expect(after.uniques).toBe(before.uniques);
  });

  it("counts a blocked click as blocked, not as a click", async () => {
    const before = await daily();
    await addClick({ visitor: "visitor-f", hour: 10, blockedReason: "expired" });
    await rollupClicks(db);

    const after = await daily();
    expect(after.clicks).toBe(before.clicks);
    expect(after.blocked).toBe(before.blocked + 1);
  });

  it("counts a QR scan as both a click and a scan", async () => {
    const before = await daily();
    await addClick({ visitor: "visitor-g", hour: 11, isQr: true });
    await rollupClicks(db);

    const after = await daily();
    expect(after.clicks).toBe(before.clicks + 1);
    expect(after.scans).toBe(before.scans + 1);
  });

  it("keeps each link's counts separate", async () => {
    await addClick({ link: secondLinkId, visitor: "visitor-h", hour: 13 });
    await rollupClicks(db);

    const other = await daily(secondLinkId);
    expect(other.clicks).toBe(1);
    expect(other.uniques).toBe(1);
  });

  it("holds uniques <= clicks for every row it has written", async () => {
    // The invariant stated as an invariant, over everything the suite created.
    const rows = (await db.execute(sql`
      select clicks, uniques from click_daily where workspace_id = ${workspaceId}::uuid
    `)) as unknown as Array<{ clicks: number; uniques: number }>;

    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.uniques).toBeLessThanOrEqual(row.clicks);
    }
  });

  it("writes the denormalised counters on links from the rollups", async () => {
    // links.clicks is what the click-limit gate reads, so it has to agree
    // with click_daily rather than drift from it.
    const [row] = (await db.execute(sql`
      select clicks, unique_clicks from links where id = ${linkId}::uuid
    `)) as unknown as [{ clicks: number; unique_clicks: number }];
    const rolled = await daily();

    expect(row.clicks).toBe(rolled.clicks);
    expect(row.unique_clicks).toBe(rolled.uniques);
  });
});

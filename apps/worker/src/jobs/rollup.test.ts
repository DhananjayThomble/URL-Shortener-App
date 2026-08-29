import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clickEvents, createDatabase, domains, eq, links, sql, workspaces, type Database } from "@snapurl/database";
import { addHashed, createSketch, estimate, hashForTesting, serialize } from "@snapurl/domain";
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

  /* The real click_events.visitor_hash is always a 32-hex-char HMAC digest
     (see packages/domain/src/visitor.ts), and the HLL sketch validates that
     shape loudly. Tests name visitors with readable labels ("visitor-a") and
     run them through hashForTesting so the stored hash matches the production
     contract while distinct labels stay distinct and a repeated label maps to
     the identical hash, exactly the properties these assertions rely on. */
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
      visitorHash: hashForTesting(opts.visitor),
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
    // click_daily_uniques (the HLL sketch store). CI runs smoke.sh against this
    // same database afterwards.
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

    /* uniques is now a HyperLogLog estimate rather than an exact count, but at
       these tiny cardinalities (two distinct visitors) the estimator falls in
       its linear-counting range, which is exact - so the assertion stays === 2
       rather than a tolerance. The approximation only shows up at thousands of
       distinct visitors, which these DB tests do not reach. */
    const row = await daily();
    expect(row.clicks).toBe(4);
    expect(row.uniques).toBe(2);
  });

  it("does not change uniques when the same events are rolled up again", async () => {
    /* The idempotency guarantee, stated directly. rollupClicks marks events as
       consumed so a re-run claims nothing, but the deeper reason a re-run is
       safe is that the sketch merge is register-wise max: even if the same
       batch were folded in twice, the stored sketch and therefore the derived
       uniques would not move. Assert the observable half: uniques is stable
       across a second pass. */
    const before = await daily();
    await rollupClicks(db);
    const after = await daily();
    expect(after.uniques).toBe(before.uniques);
    expect(after.uniques).toBeLessThanOrEqual(after.clicks);
  });

  it("re-merges against the stored sketch instead of overwriting it", async () => {
    /* The convergence guarantee, stated directly. The rollup used to read the
       stored sketch into Node, merge, and write "on conflict do update set
       sketch = excluded.sketch" - a blind overwrite of a snapshot read that
       would drop another writer's registers if two workers ever processed the
       same (link, day) at once. The fix locks the row (insert-do-nothing then
       select-for-update) and merges against the current committed value.

       Simulate the "another writer already stored a sketch" case on a fresh
       link/day: pre-seed click_daily_uniques with a sketch that already counts
       one visitor, then roll up a batch of different visitors. If the rollup
       overwrote, the pre-seeded visitor would be lost and uniques would equal
       only the batch's distinct count; because it re-merges, the stored sketch
       is the union and uniques covers both. */
    const seededDay = new Date(day);
    seededDay.setUTCDate(seededDay.getUTCDate() - 1);
    const seededDayKey = seededDay.toISOString().slice(0, 10);
    const seededAt = new Date(seededDay);
    seededAt.setUTCHours(12, 0, 0, 0);

    const preSeed = createSketch();
    addHashed(preSeed, hashForTesting("preexisting-visitor"));
    await db.execute(sql`
      insert into click_daily_uniques (link_id, day, sketch)
      values (${linkId}::uuid, ${seededDayKey}::date, ${serialize(preSeed)})
      on conflict (link_id, day) do update set sketch = excluded.sketch
    `);
    // click_daily needs a row for the same key so the derived-uniques update lands.
    await db.execute(sql`
      insert into click_daily (link_id, workspace_id, day, clicks, uniques, scans, blocked)
      values (${linkId}::uuid, ${workspaceId}::uuid, ${seededDayKey}::date, 0, 0, 0, 0)
      on conflict (link_id, day) do nothing
    `);

    await db.insert(clickEvents).values([
      { linkId, workspaceId, occurredAt: seededAt, visitorHash: hashForTesting("batch-visitor-1"), country: "IN", device: "desktop", browser: "Chrome", isQr: false, isBot: false, blockedReason: null },
      { linkId, workspaceId, occurredAt: seededAt, visitorHash: hashForTesting("batch-visitor-2"), country: "IN", device: "desktop", browser: "Chrome", isQr: false, isBot: false, blockedReason: null },
    ]);
    await rollupClicks(db);

    const rows = (await db.execute(sql`
      select uniques from click_daily where link_id = ${linkId}::uuid and day = ${seededDayKey}::date
    `)) as unknown as Array<{ uniques: number }>;
    // Union of the pre-seeded visitor and the two batch visitors is three
    // distinct, exact in HLL's linear-counting range at this tiny N. An
    // overwrite would have dropped the pre-seeded visitor and reported two.
    const expected = createSketch();
    addHashed(expected, hashForTesting("preexisting-visitor"));
    addHashed(expected, hashForTesting("batch-visitor-1"));
    addHashed(expected, hashForTesting("batch-visitor-2"));
    expect(rows[0]?.uniques).toBe(estimate(expected));
    expect(rows[0]?.uniques).toBe(3);
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
       Adding uniques per batch instead of re-deriving them from the merged HLL
       sketch is what would break this - and it is invisible until someone
       notices a link with more unique visitors than clicks. The sketch's
       register-wise-max merge is what keeps the second click a no-op on the
       count. */
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

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  clickEvents,
  createDatabase,
  domains,
  eq,
  links,
  projectionOutbox,
  sql,
  workspaces,
  type Database,
} from "@snapurl/database";
import { hashForTesting } from "@snapurl/domain";
import { drainOutbox, type ProjectionTarget } from "./outbox.js";
import { rollupClicks } from "./rollup.js";

/* ============================================================
   The concurrency properties of the claim, against a real Postgres.

   Issue #282: the old drain claimed rows with SELECT ... FOR UPDATE SKIP
   LOCKED executed via db.execute OUTSIDE a transaction, so postgres.js
   autocommitted the SELECT and released the locks before any row was
   processed — two workers could claim the same rows and double-project.
   The rollup batch claimed with an unlocked `where rolled_up_at is null`
   and relied on a comment for exclusivity, so two rollups could double-count
   the additive click_daily counts.

   These are properties of SQL under real concurrency that no mock can check.
   They run only when DATABASE_URL is set (CI applies the migrations first);
   locally they skip unless you have run `pnpm db:up && pnpm db:migrate`.

   The overlap is created by running two async calls on two SEPARATE pooled
   connections (two createDatabase handles, each max:1) via Promise.all. A
   single shared connection would serialise the two statements and never
   exercise the race, so SKIP LOCKED would have nothing to skip. vitest's
   fileParallelism is off, so the overlap must come from within one test.
   ============================================================ */

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

/** Records each link_id it is asked to project, so double-processing shows up. */
class CountingTarget implements ProjectionTarget {
  readonly seen = new Map<string, number>();
  async upsert(linkId: string): Promise<void> {
    this.seen.set(linkId, (this.seen.get(linkId) ?? 0) + 1);
  }
  async remove(linkId: string): Promise<void> {
    this.seen.set(linkId, (this.seen.get(linkId) ?? 0) + 1);
  }
}

describeDb("drainOutbox under concurrency", () => {
  let handleA: ReturnType<typeof createDatabase>;
  let handleB: ReturnType<typeof createDatabase>;
  let db: Database;
  let workspaceId: string;
  const N = 40;
  const linkIds: string[] = [];

  beforeAll(async () => {
    handleA = createDatabase({ url: DATABASE_URL!, max: 1 });
    handleB = createDatabase({ url: DATABASE_URL!, max: 1 });
    db = handleA.db;

    const stamp = Date.now();
    const [ws] = await db
      .insert(workspaces)
      .values({ name: "outbox test", slug: `outbox-${stamp}` })
      .returning({ id: workspaces.id });
    workspaceId = ws!.id;

    const [dom] = await db
      .insert(domains)
      .values({ workspaceId, domain: `outbox-${stamp}.test` })
      .returning({ id: domains.id });

    for (let i = 0; i < N; i++) {
      const [link] = await db
        .insert(links)
        .values({ workspaceId, domainId: dom!.id, slug: `o${stamp}-${i}`, destination: `https://example.com/${i}` })
        .returning({ id: links.id });
      linkIds.push(link!.id);
      // One outbox row per link, all pending.
      await db.insert(projectionOutbox).values({
        linkId: link!.id,
        operation: "upsert",
        payload: { linkId: link!.id, operation: "upsert" },
      });
    }
  });

  afterAll(async () => {
    if (workspaceId) await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await handleA?.close();
    await handleB?.close();
  });

  it("processes each pending row exactly once across two concurrent drains", async () => {
    const targetA = new CountingTarget();
    const targetB = new CountingTarget();

    /* The whole point: two drains on two connections at the same instant. If
       the claim were not atomic under SKIP LOCKED, both would pick up the same
       rows and some link_id would be projected twice. */
    const [a, b] = await Promise.all([
      drainOutbox(handleA.db, targetA),
      drainOutbox(handleB.db, targetB),
    ]);

    // Every row handled, and the two drains partition the work between them.
    expect(a.processed + b.processed).toBe(N);
    expect(a.failed + b.failed).toBe(0);

    // No link_id appears in both targets, and none appears twice in either.
    const combined = new Map<string, number>();
    for (const target of [targetA, targetB]) {
      for (const [linkId, count] of target.seen) {
        combined.set(linkId, (combined.get(linkId) ?? 0) + count);
      }
    }
    expect(combined.size).toBe(N);
    for (const linkId of linkIds) {
      expect(combined.get(linkId)).toBe(1);
    }

    // Every seeded outbox row is now processed, exactly N of them.
    const [{ n }] = (await db.execute(sql`
      select count(*)::int as n from projection_outbox o
      join links l on l.id = o.link_id
      where l.workspace_id = ${workspaceId}::uuid and o.processed_at is not null
    `)) as unknown as [{ n: number }];
    expect(n).toBe(N);
  });
});

describeDb("rollupClicks under concurrency", () => {
  let handleA: ReturnType<typeof createDatabase>;
  let handleB: ReturnType<typeof createDatabase>;
  let db: Database;
  let workspaceId: string;
  let linkId: string;
  const M = 30;

  /** Yesterday, so the rows sit on one settled UTC day regardless of run time. */
  const day = new Date(Date.now() - 86_400_000);
  const dayKey = day.toISOString().slice(0, 10);
  const at = (hour: number, minute = 0) => {
    const d = new Date(day);
    d.setUTCHours(hour, minute, 0, 0);
    return d;
  };

  beforeAll(async () => {
    handleA = createDatabase({ url: DATABASE_URL!, max: 1 });
    handleB = createDatabase({ url: DATABASE_URL!, max: 1 });
    db = handleA.db;

    const stamp = Date.now();
    const [ws] = await db
      .insert(workspaces)
      .values({ name: "rollup concurrency", slug: `rollupc-${stamp}` })
      .returning({ id: workspaces.id });
    workspaceId = ws!.id;

    const [dom] = await db
      .insert(domains)
      .values({ workspaceId, domain: `rollupc-${stamp}.test` })
      .returning({ id: domains.id });

    const [link] = await db
      .insert(links)
      .values({ workspaceId, domainId: dom!.id, slug: `rc${stamp}`, destination: "https://example.com/rc" })
      .returning({ id: links.id });
    linkId = link!.id;

    /* M distinct, non-bot, non-blocked clicks on one settled UTC day. Distinct
       visitors so uniques is a known set too. */
    await db.insert(clickEvents).values(
      Array.from({ length: M }, (_, i) => ({
        linkId,
        workspaceId,
        occurredAt: at(Math.floor(i / 4), (i % 4) * 15),
        visitorHash: hashForTesting(`visitor-${i}`),
        country: "IN",
        device: "desktop",
        browser: "Chrome",
        isQr: false,
        isBot: false,
        blockedReason: null,
      })),
    );
  });

  afterAll(async () => {
    if (workspaceId) await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await handleA?.close();
    await handleB?.close();
  });

  it("counts each click exactly once across two concurrent rollups", async () => {
    /* Two rollups on two connections at once. rollupClicks drains ALL
       unprocessed events globally, so assertions are scoped to the seeded
       link. If the batch claim were not locked, both rollups would fold the
       same clicks into the additive click_daily.clicks and double-count. */
    await Promise.all([rollupClicks(handleA.db), rollupClicks(handleB.db)]);

    const rows = (await db.execute(sql`
      select clicks, uniques from click_daily
      where link_id = ${linkId}::uuid and day = ${dayKey}::date
    `)) as unknown as Array<{ clicks: number; uniques: number }>;

    expect(rows[0]?.clicks).toBe(M);
    expect(rows[0]?.uniques).toBeLessThanOrEqual(rows[0]!.clicks);
  });
});

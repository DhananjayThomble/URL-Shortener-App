import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, domains, eq, links, sql, workspaces, type Database } from "@snapurl/database";
import { LinksService } from "./links.service.js";
import type { SafeBrowsingService } from "../safe-browsing/safe-browsing.service.js";
import type { ProjectionNudgeService } from "./projection-nudge.service.js";
import { toActor } from "../common/activity.js";

/* ============================================================
   LinksService.remove() racing the click rollup, against a real Postgres.

   The worker's rollupClicks (apps/worker/src/jobs/rollup.ts) takes its locks
   in this order inside one transaction:
     1. click_events rows, FOR UPDATE SKIP LOCKED (the claimed batch)
     2. the parent links row, FOR KEY SHARE — implicitly, through the foreign
        key check on its insert into click_daily

   DELETE FROM links takes the opposite order: the links row first, then — via
   ON DELETE CASCADE — every click_events row of that link. A delete that lands
   while a batch holding that link's clicks is mid-rollup therefore waits on
   the rollup, the rollup's FK check waits on the delete, and Postgres aborts
   one of them with `deadlock detected`. CI's dynamo smoke hit exactly this
   (DELETE /links/:id = 500) on PR #594, whose smoke deletes a link straight
   after clicking it.

   Oracle: the invariant that a delete and a rollup both complete regardless of
   interleaving — neither is allowed to fail because the other was running.
   The rollup side is reproduced here as SQL with the same lock sequence rather
   than by calling rollupClicks, because the race needs the delete to arrive
   between steps 1 and 2 and rollupClicks runs both in one call.

   Runs only when DATABASE_URL is set — see the note in rollup.test.ts.
   ============================================================ */

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

const safeBrowsingStub = {
  check: async () => ({ status: "clean" as const, checkedAt: new Date().toISOString() }),
} as unknown as SafeBrowsingService;
const projectionNudgeStub = { nudge: () => {} } as unknown as ProjectionNudgeService;

describeDb("LinksService.remove — concurrent click rollup", () => {
  // Three connections: the service under test, the simulated rollup holding its
  // transaction open, and an observer that watches pg_stat_activity.
  let serviceHandle: ReturnType<typeof createDatabase>;
  let rollupHandle: ReturnType<typeof createDatabase>;
  let observerHandle: ReturnType<typeof createDatabase>;
  let service: LinksService;
  let db: Database;
  let workspaceId: string;
  let domainId: string;

  const stamp = Date.now();
  const actor = toActor({ userId: null, label: "delete-race-test@example.com" });

  beforeAll(async () => {
    serviceHandle = createDatabase({ url: DATABASE_URL!, max: 1 });
    rollupHandle = createDatabase({ url: DATABASE_URL!, max: 1 });
    observerHandle = createDatabase({ url: DATABASE_URL!, max: 1 });
    db = serviceHandle.db;
    service = new LinksService(db, db, safeBrowsingStub, projectionNudgeStub);

    const [ws] = await db
      .insert(workspaces)
      .values({ name: "delete race", slug: `delete-race-${stamp}` })
      .returning({ id: workspaces.id });
    workspaceId = ws!.id;
    const [dom] = await db
      .insert(domains)
      .values({ workspaceId, domain: `delete-race-${stamp}.test` })
      .returning({ id: domains.id });
    domainId = dom!.id;
  });

  afterAll(async () => {
    if (workspaceId) await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await serviceHandle?.close();
    await rollupHandle?.close();
    await observerHandle?.close();
  });

  /** Resolves once some other backend in this database is waiting on a lock. */
  async function waitForLockWaiter(timeoutMs = 10_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const [row] = (await observerHandle.db.execute(sql`
        select count(*)::int as n from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock'
      `)) as unknown as [{ n: number }];
      if (row!.n > 0) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error("remove() never blocked on the rollup's locks — the race was not set up");
  }

  it("completes a delete that lands mid-rollup, and the rollup completes too", async () => {
    const slug = `race${stamp}`;
    const [link] = await db
      .insert(links)
      .values({ workspaceId, domainId, slug, destination: `https://example.com/${slug}` })
      .returning({ id: links.id });
    const linkId = link!.id;
    await db.execute(sql`
      insert into click_events (link_id, workspace_id, occurred_at, visitor_hash)
      values (${linkId}, ${workspaceId}, now(), 'race-visitor')
    `);

    let removal: Promise<void> | undefined;

    const rollup = rollupHandle.db.transaction(async (tx) => {
      // Step 1 of rollupClicks: claim this link's unrolled clicks, locked.
      await tx.execute(sql`
        select id from click_events
        where link_id = ${linkId} and rolled_up_at is null
        for update skip locked
      `);

      // The delete arrives now, and must block behind the claimed rows.
      removal = service.remove(workspaceId, linkId, actor);
      removal.catch(() => {}); // observed via allSettled below
      await waitForLockWaiter();

      // Step 2: the FK-checked write into a child of links.
      await tx.execute(sql`
        insert into click_daily (link_id, workspace_id, day, clicks, uniques, scans, blocked)
        values (${linkId}, ${workspaceId}, current_date, 1, 0, 0, 0)
        on conflict (link_id, day) do update set clicks = click_daily.clicks + excluded.clicks
      `);
    });

    const [rollupResult] = await Promise.allSettled([rollup]);
    const [removeResult] = await Promise.allSettled([removal!]);

    expect(rollupResult.status, String((rollupResult as PromiseRejectedResult).reason)).toBe("fulfilled");
    expect(removeResult.status, String((removeResult as PromiseRejectedResult).reason)).toBe("fulfilled");

    // The delete won in the end: the link and everything that cascades from it is gone.
    const remaining = await db.select({ id: links.id }).from(links).where(eq(links.id, linkId));
    expect(remaining).toHaveLength(0);
    const [{ n }] = (await db.execute(
      sql`select count(*)::int as n from click_events where link_id = ${linkId}`,
    )) as unknown as [{ n: number }];
    expect(n).toBe(0);
  }, 30_000);
});

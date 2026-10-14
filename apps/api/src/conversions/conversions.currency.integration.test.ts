import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, conversions, createDatabase, eq, workspaces, type Database } from "@snapurl/database";
import { ConversionsReport } from "@snapurl/contract";
import { ConversionsService } from "./conversions.service.js";
import { WorkspacesService } from "../workspaces/workspaces.service.js";
import type { RequestActor } from "../auth/auth.guard.js";

/* ============================================================
   G7 stays: reports count revenue only in the workspace currency and convert
   nothing. #654 is about the exclusion being INVISIBLE — a $49 sale vanished
   from every revenue figure with no signal.

   The oracle is the issue's acceptance criteria:
     - the report carries an `excluded` count, broken down by currency, for
       conversions recorded in a currency other than the workspace's;
     - `totals.revenue` (and revenue by link / the series) still sum ONLY the
       workspace currency — G7's rule is unchanged;
     - changing the workspace currency re-partitions the same rows.

   Runs only when DATABASE_URL is set.
   ============================================================ */

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

describeDb("ConversionsService.report — excluded conversions (#654)", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;
  let service: ConversionsService;
  let workspaceService: WorkspacesService;

  const wid = randomUUID();
  const empty = randomUUID();
  const actor: RequestActor = { userId: randomUUID(), workspaceId: wid, role: "editor", email: "t@e2e.local", label: "t" };

  beforeAll(async () => {
    handle = createDatabase({ url: DATABASE_URL!, max: 1 });
    db = handle.db;
    const stamp = Date.now();
    await db.insert(workspaces).values({ id: wid, name: "Cur", slug: `conv-cur-${stamp}` });
    await db.insert(workspaces).values({ id: empty, name: "Cur empty", slug: `conv-cur-e-${stamp}` });
    service = new ConversionsService(db, db);
    workspaceService = new WorkspacesService(db);

    // INR (the workspace default): counted.
    await service.record(wid, actor, { kind: "sale", name: "inr-1", valueMinor: 10000, currency: "INR", externalId: "a1" } as never);
    await service.record(wid, actor, { kind: "sale", name: "inr-2", valueMinor: 5000, externalId: "a2" } as never); // omitted -> workspace currency
    // Off currency: USD x2 (one lowercase on the wire), EUR x1.
    await service.record(wid, actor, { kind: "sale", name: "usd-1", valueMinor: 4900, currency: "USD", externalId: "b1" } as never);
    await service.record(wid, actor, { kind: "sale", name: "usd-2", valueMinor: 1000, currency: "usd", externalId: "b2" } as never);
    await service.record(wid, actor, { kind: "sale", name: "eur-1", valueMinor: 2500, currency: "EUR", externalId: "b3" } as never);
  });

  afterAll(async () => {
    await db.delete(workspaces).where(eq(workspaces.id, wid));
    await db.delete(workspaces).where(eq(workspaces.id, empty));
    await handle?.close();
  });

  it("reports the off-currency conversions, by currency, and nothing else", async () => {
    const report = await service.report(wid, "30d");
    expect(report.currency).toBe("INR");
    expect(report.excluded.count).toBe(3);
    // Largest count first, then currency code, so the order is deterministic.
    expect(report.excluded.byCurrency).toEqual([
      { currency: "USD", count: 2, valueMinor: 5900 },
      { currency: "EUR", count: 1, valueMinor: 2500 },
    ]);
  });

  it("G7 is unchanged: revenue sums only the workspace currency", async () => {
    const report = await service.report(wid, "30d");
    expect(report.totals.revenue).toBe(150); // (10000 + 5000) / 100, no USD, no EUR
    expect(report.totals.paid).toBe(5); // the sales are still counted as sales
    expect(report.revenueSeries.reduce((a, b) => a + b, 0)).toBe(150);
    expect(report.byLink.reduce((a, r) => a + r.revenue, 0)).toBe(0); // no link on these rows
  });

  it("respects the same date range as the totals", async () => {
    // Everything was recorded just now, so a 24h window sees it all...
    expect((await service.report(wid, "24h")).excluded.count).toBe(3);
    // ...and a window that starts after an old off-currency row does not.
    await db
      .update(conversions)
      .set({ occurredAt: new Date(Date.now() - 60 * 86_400_000) })
      .where(and(eq(conversions.workspaceId, wid), eq(conversions.externalId, "b3")));
    expect((await service.report(wid, "30d")).excluded.count).toBe(2);
    expect((await service.report(wid, "90d")).excluded.count).toBe(3);
  });

  it("is an empty, schema-valid object when nothing is excluded", async () => {
    const report = await service.report(empty, "30d");
    expect(report.excluded).toEqual({ count: 0, byCurrency: [] });
    expect(ConversionsReport.safeParse(report).success).toBe(true);
  });

  it("changing the workspace currency re-partitions the same rows", async () => {
    await workspaceService.update(wid, { currency: "usd" });
    const report = await service.report(wid, "30d");
    expect(report.currency).toBe("USD");
    expect(report.totals.revenue).toBe(59); // 4900 + 1000 (b3 EUR is 60 days old and out of range anyway)
    expect(report.excluded.count).toBe(2); // the two INR rows now count as the odd ones out
    expect(report.excluded.byCurrency).toEqual([{ currency: "INR", count: 2, valueMinor: 15000 }]);
  });
});

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, createDatabase, domains, eq, gte, projectionOutbox, sql, workspaces, type Database } from "@snapurl/database";
import { DomainsService } from "./domains.service.js";
import { PlansService } from "../plans/plans.service.js";
import { EntitlementsService } from "../plans/entitlements.service.js";
import { KillSwitchOffError } from "../admin/kill-switch.service.js";
import { killSwitchStub } from "../test/kill-switch.stub.js";

/* ============================================================
   #1020 — the customDomains.create kill switch + hard caps on DomainsService.add,
   against the real DB.

   Oracles (issue acceptance): with the switch OFF, add refuses with a named 503
   and connects nothing; with the switch ON but the per-day cap at N, the N+1th
   add is refused. Both are the OUTER brake, checked before the plan gate, so a
   paid workspace is still refused.

   The caps are platform-wide, so the test lowers them to tiny values via the
   kill-switch stub and asserts on rows THIS run seeded (unique stamp). The paid
   workspace clears the plan gate, isolating the kill-switch behaviour.

   DB-gated; skips with no DATABASE_URL.
   ============================================================ */

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

describeDb("DomainsService.add kill switch + caps (#1020)", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;

  const stamp = `${Date.now().toString(36)}${Math.random().toString(16).slice(2, 6)}`;
  const paidWs = randomUUID();
  const actor = { userId: null, label: "admin@example.com" };

  /** A DomainsService whose customDomains.create switch/caps are set by the
   *  stub; everything else (plan entitlements) is real. */
  function serviceWith(changes: Parameters<typeof killSwitchStub>[0]["changes"]): DomainsService {
    return new DomainsService(
      db,
      { nudge: vi.fn() } as never,
      new EntitlementsService(new PlansService(db)),
      { DEFAULT_DOMAIN: "snap.example.com" } as never,
      killSwitchStub({ changes }),
    );
  }

  const add = (svc: DomainsService, domain: string) => svc.add(paidWs, { domain }, actor);
  const ownedCount = async () => {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(domains)
      .where(eq(domains.workspaceId, paidWs));
    return row?.n ?? 0;
  };

  beforeAll(async () => {
    handle = createDatabase({ url: DATABASE_URL!, max: 1 });
    db = handle.db;
    await db.insert(workspaces).values({ id: paidWs, name: "paid", slug: `ks-dom-${stamp}`, plan: "Pro" });
  });

  afterAll(async () => {
    if (!db) return;
    const rows = await db.select({ id: domains.id }).from(domains).where(eq(domains.workspaceId, paidWs));
    for (const r of rows) await db.delete(projectionOutbox).where(eq(projectionOutbox.linkId, r.id));
    await db.delete(domains).where(eq(domains.workspaceId, paidWs));
    await db.delete(workspaces).where(eq(workspaces.id, paidWs));
    await handle?.close();
  });

  it("refuses (503) and connects NO domain while customDomains.create is OFF", async () => {
    const off = serviceWith({ "customDomains.create": { on: false } });
    await expect(add(off, `off-${stamp}.test`)).rejects.toBeInstanceOf(KillSwitchOffError);
    expect(await ownedCount()).toBe(0);
  });

  it("refuses the N+1th add when the per-day cap is reached", async () => {
    // Add one domain under a generous cap so the first add is never the one the
    // cap refuses (robust on a shared DB where other non-system domains may
    // exist). Then re-arm with perDay == the current platform-wide new-today
    // count, so the NEXT add is exactly the N+1th and is refused.
    const generous = serviceWith({
      "customDomains.create": { on: true, domainCaps: { totalMax: 10_000, perDay: 10_000 } },
    });
    await add(generous, `cap-a-${stamp}.test`);
    const owned = await ownedCount();
    expect(owned).toBeGreaterThanOrEqual(1);

    const since = new Date(Date.now() - 24 * 60 * 60_000);
    const [newToday] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(domains)
      .where(and(eq(domains.isSystem, false), gte(domains.createdAt, since)));
    const atCap = serviceWith({
      "customDomains.create": { on: true, domainCaps: { totalMax: 10_000, perDay: newToday?.n ?? 1 } },
    });
    await expect(add(atCap, `cap-b-${stamp}.test`)).rejects.toThrow(/cap/i);
    // The refused add connected nothing — the count is unchanged.
    expect(await ownedCount()).toBe(owned);
  });
});

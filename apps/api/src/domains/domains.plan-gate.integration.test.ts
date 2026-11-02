import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ForbiddenException } from "@nestjs/common";
import { createDatabase, domains, eq, projectionOutbox, sql, workspaces, type Database } from "@snapurl/database";
import { DomainsService } from "./domains.service.js";
import { PlansService } from "../plans/plans.service.js";
import { EntitlementsService } from "../plans/entitlements.service.js";

/* ============================================================
   #966 — POST /domains gates custom domains behind plan entitlements.

   A Free workspace cannot connect a custom domain (403); a paid workspace can.
   Existing domains are never touched by the gate — it is on `add` alone.

   Oracle, asserted on the rows this test seeds (shared DB — never on table
   counts): after a refused add the Free workspace has zero custom-domain rows;
   after an accepted add the paid workspace has exactly the one it connected.

   Runs only when DATABASE_URL is set.
   ============================================================ */

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

describeDb("DomainsService.add plan gate (#966)", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;
  let service: DomainsService;

  const stamp = `${Date.now().toString(36)}${Math.random().toString(16).slice(2, 6)}`;
  const freeWs = randomUUID();
  const paidWs = randomUUID();
  const createdDomainIds: string[] = [];

  const actor = { userId: null, label: "admin@example.com" };
  const add = (workspaceId: string, domain: string) =>
    service.add(workspaceId, { domain }, actor);

  const ownedCount = async (workspaceId: string) => {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(domains)
      .where(eq(domains.workspaceId, workspaceId));
    return row?.n ?? 0;
  };

  beforeAll(async () => {
    handle = createDatabase({ url: DATABASE_URL!, max: 1 });
    db = handle.db;
    const entitlements = new EntitlementsService(new PlansService(db));
    service = new DomainsService(
      db,
      { nudge: vi.fn() } as never,
      entitlements,
      { DEFAULT_DOMAIN: "snap.example.com" } as never,
    );

    await db.insert(workspaces).values({ id: freeWs, name: "free", slug: `pg-free-${stamp}`, plan: "Free" });
    await db.insert(workspaces).values({ id: paidWs, name: "paid", slug: `pg-paid-${stamp}`, plan: "Pro" });
  });

  afterAll(async () => {
    await db.execute(sql`delete from projection_outbox where payload->>'host' like ${`%-${stamp}.test`}`);
    // domainProjectionOp stores the domain id in the outbox row's linkId.
    for (const id of createdDomainIds) await db.delete(projectionOutbox).where(eq(projectionOutbox.linkId, id));
    await db.delete(domains).where(eq(domains.workspaceId, freeWs));
    await db.delete(domains).where(eq(domains.workspaceId, paidWs));
    await db.delete(workspaces).where(eq(workspaces.id, freeWs));
    await db.delete(workspaces).where(eq(workspaces.id, paidWs));
    await handle?.close();
  });

  it("refuses a Free workspace with a 403 and connects no domain", async () => {
    await expect(add(freeWs, `free-a-${stamp}.test`)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(add(freeWs, `free-a-${stamp}.test`)).rejects.toThrow(/paid-plan feature/i);
    // The row this test would have created is absent.
    const [row] = await db
      .select({ id: domains.id })
      .from(domains)
      .where(eq(domains.domain, `free-a-${stamp}.test`));
    expect(row).toBeUndefined();
    expect(await ownedCount(freeWs)).toBe(0);
  });

  it("lets a paid workspace connect a custom domain", async () => {
    const created = await add(paidWs, `paid-a-${stamp}.test`);
    createdDomainIds.push(created.id);
    expect(created.domain).toBe(`paid-a-${stamp}.test`);
    // The row this test seeded is present and scoped to the paid workspace.
    const [row] = await db
      .select({ id: domains.id, workspaceId: domains.workspaceId })
      .from(domains)
      .where(eq(domains.id, created.id));
    expect(row?.workspaceId).toBe(paidWs);
    expect(await ownedCount(paidWs)).toBe(1);
  });
});

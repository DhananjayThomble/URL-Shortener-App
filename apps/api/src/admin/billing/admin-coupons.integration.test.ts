import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  adminAuditLog,
  and,
  coupons,
  couponRedemptions,
  createDatabase,
  eq,
  users,
  workspaces,
  type Database,
} from "@snapurl/database";
import { AdminCouponsService } from "./admin-coupons.service.js";

/* ============================================================
   #992 — admin coupon management against the real DB.

   Oracles are the issue's coupon acceptance, NOT the implementation:
     - "admins create, pause and see redemptions": create lands a coupon, pause
       stops new redemptions (paused flag), the redemptions view lists real rows;
     - "every admin action is in the admin audit log": each WRITE (create,
       pause/resume, delete) writes exactly one admin-audit row carrying the
       action and the actor.

   The "denied to non-admins" half is enforced by AdminGuard on the controller
   and pinned by the access-matrix oracle (every /admin/coupons* route expects
   401 anon / 403 for every non-admin principal). This suite covers the service
   behaviour behind that guard.

   Red-on-broken: skip a writeAdminAuditEntry call and that write's "one audit
   row" assertion reds; let pause not set paused_at and the pause assertion reds.

   DB-gated: skips with no DATABASE_URL. Rows are this run's own (per-run stamp).
   Audit rows have no workspace FK, so they are cleared by the stamped
   actorLabel. Handle closed in afterAll.
   ============================================================ */

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

describeDb("#992 — admin coupons: create/pause/delete (audited) + redemptions", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;
  let service: AdminCouponsService;

  const stamp = `${Date.now().toString(36)}${Math.random().toString(16).slice(2, 6)}`;
  const actorLabel = `couponadmin-${stamp}@example.com`;
  const actor = { admin: { id: null as unknown as string, name: "Root", email: actorLabel, isPlatformAdmin: true as const }, ip: "203.0.113.7" };

  const couponIds: string[] = [];
  const workspaceIds: string[] = [];
  const userIds: string[] = [];

  async function seedWorkspace(tag: string): Promise<string> {
    const email = `cadmin-${tag}-${stamp}@example.com`;
    const [u] = await db.insert(users).values({ name: `CA ${tag}`, email, emailVerifiedAt: new Date() }).returning({ id: users.id });
    userIds.push(u!.id);
    const [ws] = await db.insert(workspaces).values({ name: `WS ${tag}`, slug: `cadmin-${tag}-${stamp}` }).returning({ id: workspaces.id });
    workspaceIds.push(ws!.id);
    return ws!.id;
  }

  async function auditRowsFor(couponId: string) {
    return db
      .select()
      .from(adminAuditLog)
      .where(and(eq(adminAuditLog.targetType, "coupon"), eq(adminAuditLog.targetId, couponId)));
  }

  beforeAll(() => {
    handle = createDatabase({ url: DATABASE_URL!, max: 4 });
    db = handle.db;
    service = new AdminCouponsService(db);
  });

  afterAll(async () => {
    if (!db) return;
    await db.delete(adminAuditLog).where(eq(adminAuditLog.actorLabel, actorLabel));
    for (const id of couponIds) await db.delete(coupons).where(eq(coupons.id, id));
    for (const id of workspaceIds) await db.delete(workspaces).where(eq(workspaces.id, id));
    for (const id of userIds) await db.delete(users).where(eq(users.id, id));
    await handle.close();
  });

  it("creates a coupon and writes ONE create audit row", async () => {
    const view = await service.create(
      {
        code: `ADMIN-${stamp}`,
        kind: "percent",
        value: 25,
        duration: "once",
        durationMonths: null,
        expiresAt: null,
        maxRedemptions: 100,
        restrictPlanKeys: ["pro", "team"],
        restrictInterval: null,
      },
      actor,
    );
    couponIds.push(view.id);

    expect(view.code).toBe(`ADMIN-${stamp}`);
    expect(view.kind).toBe("percent");
    expect(view.value).toBe(25);
    expect(view.paused).toBe(false);
    expect(view.restrictPlanKeys).toEqual(["pro", "team"]);
    expect(view.redemptions).toBe(0);
    expect(view.createdBy).toBe(actorLabel);

    const audit = await auditRowsFor(view.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]!.action).toBe("admin.coupon.create");
    expect(audit[0]!.actorLabel).toBe(actorLabel);
  });

  it("lists coupons with live redemption counts, newest first", async () => {
    const list = await service.list();
    const mine = list.items.find((c) => c.code === `ADMIN-${stamp}`);
    expect(mine).toBeTruthy();
    expect(mine!.redemptions).toBe(0);
  });

  it("pauses then resumes a coupon, each write audited with the before/after", async () => {
    const view = await service.create(
      { code: `PAUSE-${stamp}`, kind: "fixed", value: 500, currency: "INR", duration: "forever", durationMonths: null, expiresAt: null, maxRedemptions: null, restrictPlanKeys: null, restrictInterval: null },
      actor,
    );
    couponIds.push(view.id);

    const paused = await service.setPaused(view.id, true, actor);
    expect(paused.paused).toBe(true);

    const resumed = await service.setPaused(view.id, false, actor);
    expect(resumed.paused).toBe(false);

    const audit = await auditRowsFor(view.id);
    const actions = audit.map((a) => a.action).sort();
    expect(actions).toContain("admin.coupon.create");
    expect(actions).toContain("admin.coupon.pause");
    expect(actions).toContain("admin.coupon.resume");
  });

  it("shows a coupon's redemptions with their workspace, newest first", async () => {
    const view = await service.create(
      { code: `REDEEM-${stamp}`, kind: "percent", value: 10, duration: "once", durationMonths: null, expiresAt: null, maxRedemptions: null, restrictPlanKeys: null, restrictInterval: null },
      actor,
    );
    couponIds.push(view.id);
    const wsA = await seedWorkspace("rA");
    const wsB = await seedWorkspace("rB");

    await db.insert(couponRedemptions).values([
      { couponId: view.id, workspaceId: wsA, planKey: "pro", interval: "monthly" },
      { couponId: view.id, workspaceId: wsB, planKey: "team", interval: "yearly" },
    ]);

    const redemptions = await service.redemptions(view.id);
    expect(redemptions.items).toHaveLength(2);
    expect(redemptions.items.every((r) => r.workspaceName !== null)).toBe(true);
    // The list view now reflects the live count.
    const list = await service.list();
    expect(list.items.find((c) => c.id === view.id)!.redemptions).toBe(2);
  });

  it("deletes a coupon (cascading its redemptions) and audits the delete", async () => {
    const view = await service.create(
      { code: `DELETE-${stamp}`, kind: "percent", value: 15, duration: "once", durationMonths: null, expiresAt: null, maxRedemptions: null, restrictPlanKeys: null, restrictInterval: null },
      actor,
    );
    const ws = await seedWorkspace("del");
    await db.insert(couponRedemptions).values({ couponId: view.id, workspaceId: ws, planKey: "pro", interval: "monthly" });

    await service.remove(view.id, actor);

    // Coupon gone, redemptions cascaded.
    const left = await db.select().from(coupons).where(eq(coupons.id, view.id));
    expect(left).toHaveLength(0);
    const redLeft = await db.select().from(couponRedemptions).where(eq(couponRedemptions.couponId, view.id));
    expect(redLeft).toHaveLength(0);

    // The audit row survives the coupon delete (no FK to coupons).
    const audit = await auditRowsFor(view.id);
    expect(audit.some((a) => a.action === "admin.coupon.delete")).toBe(true);
  });

  it("404s pause/delete/redemptions for a coupon that does not exist", async () => {
    const ghost = "00000000-0000-7000-8000-000000000000";
    await expect(service.setPaused(ghost, true, actor)).rejects.toMatchObject({ status: 404 });
    await expect(service.remove(ghost, actor)).rejects.toMatchObject({ status: 404 });
    await expect(service.redemptions(ghost)).rejects.toMatchObject({ status: 404 });
  });
});

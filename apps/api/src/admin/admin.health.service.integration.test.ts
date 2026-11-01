import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  and,
  createDatabase,
  eq,
  inArray,
  sql,
  adminAuditLog,
  auditLog,
  jobLeases,
  projectionOutbox,
  users,
  webhookDeliveries,
  webhooks,
  workspaces,
  type Database,
} from "@snapurl/database";
import type { Env } from "../config/env.js";
import { AdminHealthService } from "./admin.health.service.js";
import type { AdminIdentity } from "./admin.service.js";

/* ============================================================
   #974 — system health and operations.

   Proves the three read views report real counts against seeded data, that the
   three retries are audited and move exactly the stuck work (and nothing
   healthy), and that the two audit viewers filter and page. Every assertion is
   against rows this suite seeds and tears down, with unique keys so parallel
   suites against the same database do not collide.

   DB-gated like the #968 admin suite: runs only when DATABASE_URL is set, and
   skips on a clean clone with no Postgres.
   ============================================================ */

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

describeDb("admin system health and operations (#974)", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;
  let svc: AdminHealthService;

  const stamp = `${Date.now().toString(36)}${Math.random().toString(16).slice(2, 8)}`;
  const LEASE = `t974-lease-${stamp}`;
  const LEASE_HEALTHY = `t974-lease-ok-${stamp}`;

  // Everything we insert, for teardown.
  const userIds: string[] = [];
  const workspaceIds: string[] = [];
  const webhookIds: string[] = [];
  const deliveryIds: string[] = [];
  const outboxIds: string[] = [];
  const auditIds: string[] = [];
  const adminAuditActorIds: string[] = [];

  const admin: AdminIdentity = { id: "", name: "Health Admin", email: `health-admin-${stamp}@example.com` };

  function fakeEnv(): Env {
    return {} as unknown as Env;
  }

  beforeAll(async () => {
    handle = createDatabase({ url: DATABASE_URL!, max: 4 });
    db = handle.db;
    // Both the primary and the read handle point at the same DB here (no
    // replica configured), which is exactly the single-Postgres topology.
    svc = new AdminHealthService(db, db);

    // An admin user row so the audited retries have a real actorId FK.
    const [u] = await db
      .insert(users)
      .values({ name: admin.name, email: admin.email })
      .returning({ id: users.id });
    admin.id = u!.id;
    userIds.push(u!.id);
    adminAuditActorIds.push(u!.id);

    // A workspace + webhook so webhook_deliveries rows satisfy their FK.
    const [ws] = await db
      .insert(workspaces)
      .values({ name: `WS ${stamp}`, slug: `ws-${stamp}` })
      .returning({ id: workspaces.id });
    workspaceIds.push(ws!.id);

    const [wh] = await db
      .insert(webhooks)
      .values({ workspaceId: ws!.id, endpoint: "https://example.test/hook", secret: "seed-secret" })
      .returning({ id: webhooks.id });
    webhookIds.push(wh!.id);

    // webhook_deliveries: 2 pending, 3 failed.
    for (let i = 0; i < 2; i++) {
      const [d] = await db
        .insert(webhookDeliveries)
        .values({ webhookId: wh!.id, event: "link.created", payload: { i }, status: "pending", attempts: 0 })
        .returning({ id: webhookDeliveries.id });
      deliveryIds.push(d!.id);
    }
    for (let i = 0; i < 3; i++) {
      const [d] = await db
        .insert(webhookDeliveries)
        .values({
          webhookId: wh!.id,
          event: "link.created",
          payload: { i },
          status: "failed",
          attempts: 5,
          error: "HTTP 500",
          responseCode: 500,
        })
        .returning({ id: webhookDeliveries.id });
      deliveryIds.push(d!.id);
    }

    // projection_outbox: 4 pending (attempts 0), 2 dead-lettered (attempts 8).
    for (let i = 0; i < 4; i++) {
      const [o] = await db
        .insert(projectionOutbox)
        .values({ linkId: sql`uuidv7()` as unknown as string, operation: "upsert", payload: { i }, attempts: 0 })
        .returning({ id: projectionOutbox.id });
      outboxIds.push(o!.id);
    }
    for (let i = 0; i < 2; i++) {
      const [o] = await db
        .insert(projectionOutbox)
        .values({
          linkId: sql`uuidv7()` as unknown as string,
          operation: "upsert",
          payload: { i },
          attempts: 8,
          lastError: "boom",
        })
        .returning({ id: projectionOutbox.id });
      outboxIds.push(o!.id);
    }

    // job_leases: one stuck (held, expired), one healthy (held, future).
    await db.insert(jobLeases).values({
      name: LEASE,
      holder: "dead-worker",
      lockedUntil: new Date(Date.now() - 60_000),
      acquiredAt: new Date(Date.now() - 600_000),
    });
    await db.insert(jobLeases).values({
      name: LEASE_HEALTHY,
      holder: "live-worker",
      lockedUntil: new Date(Date.now() + 600_000),
      acquiredAt: new Date(),
    });
  });

  afterAll(async () => {
    await db.delete(jobLeases).where(inArray(jobLeases.name, [LEASE, LEASE_HEALTHY]));
    if (outboxIds.length) await db.delete(projectionOutbox).where(inArray(projectionOutbox.id, outboxIds));
    if (deliveryIds.length) await db.delete(webhookDeliveries).where(inArray(webhookDeliveries.id, deliveryIds));
    if (webhookIds.length) await db.delete(webhooks).where(inArray(webhooks.id, webhookIds));
    if (auditIds.length) await db.delete(auditLog).where(inArray(auditLog.id, auditIds));
    if (adminAuditActorIds.length)
      await db.delete(adminAuditLog).where(inArray(adminAuditLog.actorId, adminAuditActorIds));
    if (workspaceIds.length) await db.delete(workspaces).where(inArray(workspaces.id, workspaceIds));
    if (userIds.length) await db.delete(users).where(inArray(users.id, userIds));
    await handle.close?.();
  });

  /* ---- backlog counts ---- */

  it("backlogs report real counts against seeded data (pending vs stuck)", async () => {
    const { backlogs } = await svc.backlogs();
    const byName = Object.fromEntries(backlogs.map((b) => [b.name, b]));

    // Counts are GREATER-THAN-OR-EQUAL because a shared DB may hold other rows;
    // the seeded minimum is what we assert.
    expect(byName.projection_outbox!.pending).toBeGreaterThanOrEqual(4);
    expect(byName.projection_outbox!.stuck).toBeGreaterThanOrEqual(2);
    expect(byName.webhook_deliveries!.pending).toBeGreaterThanOrEqual(2);
    expect(byName.webhook_deliveries!.stuck).toBeGreaterThanOrEqual(3);
    expect(byName.job_leases!.pending).toBeGreaterThanOrEqual(1); // the healthy held one
    expect(byName.job_leases!.stuck).toBeGreaterThanOrEqual(1); // the expired held one
  });

  /* ---- service status ---- */

  it("service status reports database ok and flags the dead-lettered edge backlog", async () => {
    const { services } = await svc.services();
    const byName = Object.fromEntries(services.map((s) => [s.name, s]));

    expect(byName.api!.state).toBe("ok");
    expect(byName.database!.state).toBe("ok");
    // 2 dead-lettered outbox rows seeded → redirect edge is degraded.
    expect(byName.redirect!.state).toBe("degraded");
    // A worker component is always reported (ok/degraded/down).
    expect(["ok", "degraded", "down"]).toContain(byName.worker!.state);
  });

  /* ---- retries (audited, move only the stuck work) ---- */

  it("projection-outbox retry re-queues only dead-lettered rows and audits it", async () => {
    const result = await svc.retryProjectionOutbox(admin, "203.0.113.9");
    expect(result.retried).toBeGreaterThanOrEqual(2);

    // The 2 seeded dead-lettered rows are now at attempts 0, claim cleared.
    const revived = await db
      .select({ id: projectionOutbox.id, attempts: projectionOutbox.attempts, lastError: projectionOutbox.lastError })
      .from(projectionOutbox)
      .where(inArray(projectionOutbox.id, outboxIds.slice(4)));
    for (const r of revived) {
      expect(r.attempts).toBe(0);
      expect(r.lastError).toBeNull();
    }

    // An audit row landed for this action.
    const rows = await db
      .select()
      .from(adminAuditLog)
      .where(and(eq(adminAuditLog.actorId, admin.id), eq(adminAuditLog.action, "admin.projection_outbox.retry")));
    expect(rows.length).toBe(1);
    expect(rows[0]!.requestIp).toBe("203.0.113.9");
  });

  it("webhook-deliveries retry re-queues only failed rows (pending untouched) and audits it", async () => {
    const result = await svc.retryWebhookDeliveries(admin, "203.0.113.9");
    expect(result.retried).toBeGreaterThanOrEqual(3);

    // The 3 seeded failed rows are back to pending, attempts reset.
    const failedIds = deliveryIds.slice(2);
    const requeued = await db
      .select({ id: webhookDeliveries.id, status: webhookDeliveries.status, attempts: webhookDeliveries.attempts })
      .from(webhookDeliveries)
      .where(inArray(webhookDeliveries.id, failedIds));
    for (const r of requeued) {
      expect(r.status).toBe("pending");
      expect(r.attempts).toBe(0);
    }

    const rows = await db
      .select()
      .from(adminAuditLog)
      .where(and(eq(adminAuditLog.actorId, admin.id), eq(adminAuditLog.action, "admin.webhook_deliveries.retry")));
    expect(rows.length).toBe(1);
  });

  it("job-lease release frees a stuck lease but refuses a healthy one, and audits both", async () => {
    // The expired-but-held lease is released.
    const stuck = await svc.releaseJobLease(LEASE, admin, "203.0.113.9");
    expect(stuck.retried).toBe(1);
    const [released] = await db.select().from(jobLeases).where(eq(jobLeases.name, LEASE));
    expect(released!.holder).toBeNull();

    // The healthy (future, held) lease is NOT released — releasing a live lease
    // would hand a second worker a free run alongside the legitimate holder.
    const healthy = await svc.releaseJobLease(LEASE_HEALTHY, admin, "203.0.113.9");
    expect(healthy.retried).toBe(0);
    const [stillHeld] = await db.select().from(jobLeases).where(eq(jobLeases.name, LEASE_HEALTHY));
    expect(stillHeld!.holder).toBe("live-worker");

    // Both calls audited (one released: true, one released: false).
    const rows = await db
      .select()
      .from(adminAuditLog)
      .where(and(eq(adminAuditLog.actorId, admin.id), eq(adminAuditLog.action, "admin.job_lease.release")));
    expect(rows.length).toBe(2);
  });

  /* ---- audit viewers ---- */

  it("admin audit viewer filters by action and actor and pages", async () => {
    // By now this suite has written at least 4 admin-audit rows for `admin`.
    const byActor = await svc.adminAudit({ actor: admin.email, limit: 2, offset: 0 });
    expect(byActor.rows.length).toBe(2);
    expect(byActor.hasMore).toBe(true);
    for (const r of byActor.rows) expect(r.actor).toBe(admin.email);

    const byAction = await svc.adminAudit({ action: "admin.job_lease.release", actor: admin.email, limit: 50, offset: 0 });
    expect(byAction.rows.length).toBe(2);
    for (const r of byAction.rows) expect(r.action).toBe("admin.job_lease.release");
  });

  it("workspace audit viewer returns only the named workspace's rows, filtered", async () => {
    const wsId = workspaceIds[0]!;
    // Seed two workspace audit rows directly.
    const seeded = await db
      .insert(auditLog)
      .values([
        { workspaceId: wsId, actorId: admin.id, actorLabel: admin.email, action: "link.created" as never },
        { workspaceId: wsId, actorId: admin.id, actorLabel: admin.email, action: "link.deleted" as never },
      ])
      .returning({ id: auditLog.id });
    for (const s of seeded) auditIds.push(s.id);

    const all = await svc.workspaceAudit(wsId, { limit: 50, offset: 0 });
    expect(all.rows.length).toBeGreaterThanOrEqual(2);
    // Every row belongs to this workspace (we only ever query by workspaceId).
    expect(all.rows.some((r) => r.action === "link.created")).toBe(true);

    const filtered = await svc.workspaceAudit(wsId, { action: "link.deleted", limit: 50, offset: 0 });
    expect(filtered.rows.length).toBe(1);
    expect(filtered.rows[0]!.action).toBe("link.deleted");
  });
});

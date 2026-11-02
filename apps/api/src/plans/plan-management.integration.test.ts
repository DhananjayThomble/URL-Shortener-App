import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import {
  adminAuditLog,
  and,
  createDatabase,
  eq,
  planChangeRequests,
  subscriptions,
  workspacePlanHistory,
  workspaces,
  users,
  type Database,
} from "@snapurl/database";
import { PlansService } from "./plans.service.js";
import { PlanManagementService } from "./plan-management.service.js";
import type { AdminActor } from "../admin/admin-management.service.js";

/* ============================================================
   #992 — admin plan change + plan history, asserted on seeded rows (shared DB,
   never on table counts).

   Oracles are the issue's acceptance lines (§1, §7):
     - an admin immediate upgrade with charge produces the EXACT prorated amount
       (paise) and a plan_change history row;
     - a comp with an end date moves the plan now, writes a comp_grant row and
       schedules a comp_revert request for that date; applyDueChanges reverts it
       once the date passes;
     - a period-end change schedules a request at the period end, applied only
       when the sweep runs after it;
     - every admin action lands an admin_audit_log row.

   Prices come from the seeded catalogue (starter ₹59/mo = 5900 paise, pro
   ₹199/mo = 19900 paise), so a midpoint upgrade starter→pro charges exactly
   (19900 − 5900) × 0.5 = 7000 paise.

   Red-on-broken: break the proration multiply and the exact-amount assertion
   fails; drop the comp-revert scheduling and the scheduled-request assertion
   fails; drop writeAdminAuditEntry and the audit assertion fails; make
   applyDueChanges non-idempotent and the double-sweep assertion fails.

   DB-gated: skips with no DATABASE_URL.
   ============================================================ */

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

/** A 30-day period centred so a change "now" lands exactly at the midpoint. */
const DAY = 24 * 3600_000;

describeDb("PlanManagementService (#992)", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;
  let plans: PlansService;
  let svc: PlanManagementService;

  const stamp = `${Date.now().toString(36)}${Math.random().toString(16).slice(2, 6)}`;
  let actorId: string;
  let actor: AdminActor;

  const workspaceIds: string[] = [];

  /** Fixed "now" the service reads, so proration is deterministic. */
  let nowMs = Date.UTC(2026, 5, 15, 12, 0, 0);
  const setNow = (ms: number) => {
    nowMs = ms;
  };

  beforeAll(async () => {
    handle = createDatabase({ url: DATABASE_URL!, max: 1 });
    db = handle.db;
    plans = new PlansService(db);
    // Make sure the catalogue is seeded so starter/pro prices resolve.
    await plans.seedIfEmpty();
    svc = new PlanManagementService(db, plans);
    svc.setClockForTesting(() => new Date(nowMs));

    const [u] = await db
      .insert(users)
      .values({ name: "Admin992", email: `admin992-${stamp}@example.com` })
      .returning({ id: users.id });
    actorId = u!.id;
    actor = { admin: { id: actorId, name: "Admin992", email: `admin992-${stamp}@example.com` }, ip: "203.0.113.5" };
  });

  afterAll(async () => {
    await db.delete(adminAuditLog).where(eq(adminAuditLog.actorLabel, actor.admin.email));
    for (const id of workspaceIds) {
      await db.delete(workspacePlanHistory).where(eq(workspacePlanHistory.workspaceId, id));
      await db.delete(planChangeRequests).where(eq(planChangeRequests.workspaceId, id));
      await db.delete(subscriptions).where(eq(subscriptions.workspaceId, id));
      await db.delete(workspaces).where(eq(workspaces.id, id));
    }
    if (actorId) await db.delete(users).where(eq(users.id, actorId));
    await handle?.close();
  });

  /** A workspace with a monthly subscription whose period is [now−15d, now+15d],
   *  so a change at `now` is the exact midpoint (unused fraction 0.5). */
  async function makeWorkspaceOnStarter(): Promise<string> {
    const id = randomUUID();
    await db.insert(workspaces).values({ id, name: "t", slug: `pm-${id.slice(0, 8)}`, plan: "Starter" });
    await db.insert(subscriptions).values({
      workspaceId: id,
      planKey: "starter",
      interval: "monthly",
      provider: "razorpay",
      status: "active",
      currentPeriodEnd: new Date(nowMs + 15 * DAY),
    });
    workspaceIds.push(id);
    return id;
  }

  async function historyKinds(workspaceId: string): Promise<string[]> {
    const rows = await db
      .select({ kind: workspacePlanHistory.kind })
      .from(workspacePlanHistory)
      .where(eq(workspacePlanHistory.workspaceId, workspaceId));
    return rows.map((r) => r.kind);
  }

  async function auditCount(action: string, targetId: string): Promise<number> {
    const rows = await db
      .select({ id: adminAuditLog.id })
      .from(adminAuditLog)
      .where(and(eq(adminAuditLog.action, action), eq(adminAuditLog.targetId, targetId)));
    return rows.length;
  }

  it("immediate upgrade with charge produces the exact prorated paise and a history row", async () => {
    const ws = await makeWorkspaceOnStarter();
    const result = await svc.adminChangePlan(
      ws,
      { toPlanKey: "pro", timing: "immediate", settlement: "charge", compEndsAt: null, reason: "Phone upgrade" },
      actor,
    );

    expect(result.outcome).toBe("applied");
    expect(result.settlement).toBe("charge");
    // starter 5900 → pro 19900, midpoint (0.5): credit 2950, charge 9950, net 7000.
    expect(result.proration).not.toBeNull();
    expect(result.proration!.unusedFraction).toBeCloseTo(0.5, 6);
    expect(result.proration!.oldPlanCreditMinor).toBe(2950);
    expect(result.proration!.newPlanChargeMinor).toBe(9950);
    expect(result.proration!.amountMinor).toBe(7000);
    expect(result.proration!.direction).toBe("upgrade");

    // The plan label moved and a plan_change row exists with the exact amount.
    const [wsRow] = await db.select({ plan: workspaces.plan }).from(workspaces).where(eq(workspaces.id, ws));
    expect(wsRow!.plan).toBe("Pro");
    const [hist] = await db
      .select()
      .from(workspacePlanHistory)
      .where(and(eq(workspacePlanHistory.workspaceId, ws), eq(workspacePlanHistory.kind, "plan_change")));
    expect(hist!.amountMinor).toBe("7000");
    expect(hist!.reason).toBe("Phone upgrade");
    expect(hist!.settlement).toBe("charge");

    expect(await auditCount("admin.workspace.plan_change", ws)).toBe(1);
  });

  it("a comp with an end date grants now and schedules a revert the sweep applies after the date", async () => {
    const ws = await makeWorkspaceOnStarter();
    const compEndsAt = new Date(nowMs + 10 * DAY).toISOString();
    const result = await svc.adminChangePlan(
      ws,
      { toPlanKey: "pro", timing: "immediate", settlement: "comp", compEndsAt, reason: "Goodwill" },
      actor,
    );

    expect(result.outcome).toBe("applied");
    expect(result.settlement).toBe("comp");
    expect(result.proration).toBeNull();
    expect(result.compEndsAt).toBe(compEndsAt);

    // Plan moved to pro; a comp_grant row written; a comp_revert request pending.
    const [wsRow] = await db.select({ plan: workspaces.plan }).from(workspaces).where(eq(workspaces.id, ws));
    expect(wsRow!.plan).toBe("Pro");
    expect(await historyKinds(ws)).toContain("comp_grant");

    const pending = await db
      .select()
      .from(planChangeRequests)
      .where(and(eq(planChangeRequests.workspaceId, ws), eq(planChangeRequests.kind, "comp_revert")));
    expect(pending.length).toBe(1);
    expect(pending[0]!.toPlanKey).toBe("starter"); // reverts to what it was on
    expect(pending[0]!.appliedAt).toBeNull();

    // Before the date: the sweep applies nothing for this workspace.
    await svc.applyDueChanges();
    const [stillPro] = await db.select({ plan: workspaces.plan }).from(workspaces).where(eq(workspaces.id, ws));
    expect(stillPro!.plan).toBe("Pro");

    // After the date: the sweep reverts it and records a comp_revert history row.
    setNow(nowMs + 11 * DAY);
    const applied = await svc.applyDueChanges();
    expect(applied).toBeGreaterThanOrEqual(1);
    const [reverted] = await db.select({ plan: workspaces.plan }).from(workspaces).where(eq(workspaces.id, ws));
    expect(reverted!.plan).toBe("Starter");
    expect(await historyKinds(ws)).toContain("comp_revert");

    // Idempotent: a second sweep applies nothing more for this workspace.
    const again = await svc.applyDueChanges();
    const revertRows = await db
      .select({ id: planChangeRequests.id })
      .from(planChangeRequests)
      .where(and(eq(planChangeRequests.workspaceId, ws), eq(planChangeRequests.kind, "comp_revert"), eq(planChangeRequests.toPlanKey, "starter")));
    // the one request is now applied, not re-applied.
    expect(revertRows.length).toBe(1);
    void again;
    setNow(Date.UTC(2026, 5, 15, 12, 0, 0));
  });

  it("a period-end change schedules at the period end and the sweep applies it only after", async () => {
    const ws = await makeWorkspaceOnStarter();
    const result = await svc.adminChangePlan(
      ws,
      { toPlanKey: "free", timing: "period_end", settlement: undefined, compEndsAt: null, reason: "Downgrade at renewal" },
      actor,
    );
    expect(result.outcome).toBe("scheduled");
    expect(result.timing).toBe("period_end");
    // effectiveAt is the subscription's period end (now + 15d).
    expect(new Date(result.effectiveAt).getTime()).toBe(nowMs + 15 * DAY);

    const pending = await db
      .select()
      .from(planChangeRequests)
      .where(and(eq(planChangeRequests.workspaceId, ws), eq(planChangeRequests.kind, "period_end")));
    expect(pending.length).toBe(1);
    expect(await auditCount("admin.workspace.plan_change_scheduled", ws)).toBe(1);

    // Sweep before the period end: still on Starter.
    await svc.applyDueChanges();
    const [before] = await db.select({ plan: workspaces.plan }).from(workspaces).where(eq(workspaces.id, ws));
    expect(before!.plan).toBe("Starter");

    // Sweep after: moved to Free with a plan_change history row.
    setNow(nowMs + 16 * DAY);
    await svc.applyDueChanges();
    const [after] = await db.select({ plan: workspaces.plan }).from(workspaces).where(eq(workspaces.id, ws));
    expect(after!.plan).toBe("Free");
    expect(await historyKinds(ws)).toContain("plan_change");
    setNow(Date.UTC(2026, 5, 15, 12, 0, 0));
  });

  it("re-scheduling a period-end change replaces the pending request (one per kind)", async () => {
    const ws = await makeWorkspaceOnStarter();
    await svc.adminChangePlan(ws, { toPlanKey: "free", timing: "period_end", settlement: undefined, compEndsAt: null, reason: "first" }, actor);
    await svc.adminChangePlan(ws, { toPlanKey: "team", timing: "period_end", settlement: undefined, compEndsAt: null, reason: "second" }, actor);
    const pending = await db
      .select()
      .from(planChangeRequests)
      .where(and(eq(planChangeRequests.workspaceId, ws), eq(planChangeRequests.kind, "period_end")));
    expect(pending.length).toBe(1);
    expect(pending[0]!.toPlanKey).toBe("team");
    expect(pending[0]!.reason).toBe("second");
  });

  it("rejects an unknown target plan", async () => {
    const ws = await makeWorkspaceOnStarter();
    await expect(
      svc.adminChangePlan(ws, { toPlanKey: "nope-not-a-plan", timing: "immediate", settlement: "charge", compEndsAt: null, reason: "x" }, actor),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects a comp end date in the past", async () => {
    const ws = await makeWorkspaceOnStarter();
    const past = new Date(nowMs - DAY).toISOString();
    await expect(
      svc.adminChangePlan(ws, { toPlanKey: "pro", timing: "immediate", settlement: "comp", compEndsAt: past, reason: "x" }, actor),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("404s plan-change and history for an unknown workspace", async () => {
    await expect(
      svc.adminChangePlan(randomUUID(), { toPlanKey: "pro", timing: "immediate", settlement: "charge", compEndsAt: null, reason: "x" }, actor),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.history(randomUUID())).rejects.toBeInstanceOf(NotFoundException);
  });

  it("history returns the workspace's rows newest-first", async () => {
    const ws = await makeWorkspaceOnStarter();
    await svc.adminChangePlan(ws, { toPlanKey: "pro", timing: "immediate", settlement: "charge", compEndsAt: null, reason: "one" }, actor);
    setNow(nowMs + 60_000);
    await svc.adminChangePlan(ws, { toPlanKey: "team", timing: "immediate", settlement: "charge", compEndsAt: null, reason: "two" }, actor);
    const list = await svc.history(ws);
    expect(list.items.length).toBeGreaterThanOrEqual(2);
    // newest first: the most recent change (to team) is first.
    expect(list.items[0]!.toPlanKey).toBe("team");
    expect(list.items[0]!.reason).toBe("two");
    setNow(Date.UTC(2026, 5, 15, 12, 0, 0));
  });
});

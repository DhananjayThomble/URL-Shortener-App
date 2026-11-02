import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
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
import { NoneBillingProvider } from "../billing/none-billing.provider.js";
import type { AdminActor } from "../admin/admin-management.service.js";

/* ============================================================
   #992 — admin plan change + plan history (PR-A slice), asserted on seeded rows
   (shared DB, never on table counts).

   Oracles (issue §1, §7, plus the PR-A review constraints):
     - an immediate COMP moves the plan now, writes a comp_grant row, and (with
       an end date) schedules a comp_revert the sweep applies after the date;
     - a period-end change schedules a request applied only when the sweep runs
       after the period end;
     - an admin move on a workspace with an ACTIVE or TRIALING provider
       subscription is REFUSED with a 409 (a webhook would overwrite the label);
     - the sweep SKIPS (and records why) a scheduled change whose workspace
       gained a live subscription after scheduling;
     - every admin action lands an admin_audit_log row.

   Red-on-broken: drop the live-subscription refusal and the 409 test fails;
   drop the sweep re-check and the skip test applies the move anyway; drop the
   comp-revert scheduling and that assertion fails; make applyDueChanges
   non-idempotent and the double-sweep assertion fails; drop writeAdminAuditEntry
   and the audit assertion fails.

   DB-gated: skips with no DATABASE_URL.
   ============================================================ */

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;
const DAY = 24 * 3600_000;

describeDb("PlanManagementService (#992 PR-A)", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;
  let plans: PlansService;
  let svc: PlanManagementService;

  const stamp = `${Date.now().toString(36)}${Math.random().toString(16).slice(2, 6)}`;
  let actorId: string;
  let actor: AdminActor;

  const workspaceIds: string[] = [];

  /** Fixed "now" the service reads, so scheduling is deterministic. */
  let nowMs = Date.UTC(2026, 5, 15, 12, 0, 0);
  const setNow = (ms: number) => {
    nowMs = ms;
  };
  const resetNow = () => setNow(Date.UTC(2026, 5, 15, 12, 0, 0));

  beforeAll(async () => {
    handle = createDatabase({ url: DATABASE_URL!, max: 1 });
    db = handle.db;
    plans = new PlansService(db);
    await plans.seedIfEmpty(); // starter/pro/team present for the key checks
    // #992 PR-C — the service now takes a billing provider (for the charge path,
    // which these PR-A tests never exercise). A disabled none-provider stands in:
    // these tests cover comp/period-end/sweep only, never a provider-backed
    // charge, so the provider is never called here.
    svc = new PlanManagementService(db, plans, new NoneBillingProvider());
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

  /** A plain workspace with NO provider subscription — an admin move is allowed.
   *  Starts on Free. */
  async function makeFreeWorkspace(): Promise<string> {
    const id = randomUUID();
    await db.insert(workspaces).values({ id, name: "t", slug: `pm-${id.slice(0, 8)}`, plan: "Free" });
    workspaceIds.push(id);
    return id;
  }

  /** Give a workspace a provider subscription in the given status. */
  async function giveSubscription(workspaceId: string, status: string, planKey = "starter"): Promise<void> {
    await db.insert(subscriptions).values({
      workspaceId,
      planKey,
      interval: "monthly",
      provider: "razorpay",
      status,
      currentPeriodEnd: new Date(nowMs + 15 * DAY),
    });
  }

  async function plan(workspaceId: string): Promise<string> {
    const [row] = await db.select({ plan: workspaces.plan }).from(workspaces).where(eq(workspaces.id, workspaceId));
    return row!.plan;
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

  it("an immediate comp with an end date grants now and schedules a revert the sweep applies after the date", async () => {
    const ws = await makeFreeWorkspace();
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

    expect(await plan(ws)).toBe("Pro");
    expect(await historyKinds(ws)).toContain("comp_grant");
    expect(await auditCount("admin.workspace.plan_comp", ws)).toBe(1);

    const pending = await db
      .select()
      .from(planChangeRequests)
      .where(and(eq(planChangeRequests.workspaceId, ws), eq(planChangeRequests.kind, "comp_revert")));
    expect(pending.length).toBe(1);
    expect(pending[0]!.toPlanKey).toBe("free"); // reverts to what it was on
    expect(pending[0]!.appliedAt).toBeNull();

    // Before the date: the sweep reverts nothing for this workspace.
    await svc.applyDueChanges();
    expect(await plan(ws)).toBe("Pro");

    // After the date: reverted, and a comp_revert history row written.
    setNow(nowMs + 11 * DAY);
    const applied = await svc.applyDueChanges();
    expect(applied).toBeGreaterThanOrEqual(1);
    expect(await plan(ws)).toBe("Free");
    expect(await historyKinds(ws)).toContain("comp_revert");

    // Idempotent: the request is applied, a second sweep does not re-run it.
    const revertRows = await db
      .select({ appliedAt: planChangeRequests.appliedAt })
      .from(planChangeRequests)
      .where(and(eq(planChangeRequests.workspaceId, ws), eq(planChangeRequests.kind, "comp_revert")));
    expect(revertRows.length).toBe(1);
    expect(revertRows[0]!.appliedAt).not.toBeNull();
    resetNow();
  });

  it("an immediate comp with no settlement field defaults to a comp", async () => {
    const ws = await makeFreeWorkspace();
    const result = await svc.adminChangePlan(
      ws,
      { toPlanKey: "pro", timing: "immediate", settlement: undefined, compEndsAt: null, reason: "default comp" },
      actor,
    );
    expect(result.outcome).toBe("applied");
    expect(result.settlement).toBe("comp");
    expect(await plan(ws)).toBe("Pro");
    expect(await historyKinds(ws)).toContain("comp_grant");
  });

  it("a period-end change schedules at the period end and the sweep applies it only after", async () => {
    const ws = await makeFreeWorkspace();
    const result = await svc.adminChangePlan(
      ws,
      { toPlanKey: "team", timing: "period_end", settlement: undefined, compEndsAt: null, reason: "Scheduled upgrade" },
      actor,
    );
    expect(result.outcome).toBe("scheduled");
    expect(result.timing).toBe("period_end");
    expect(await auditCount("admin.workspace.plan_change_scheduled", ws)).toBe(1);

    const pending = await db
      .select()
      .from(planChangeRequests)
      .where(and(eq(planChangeRequests.workspaceId, ws), eq(planChangeRequests.kind, "period_end")));
    expect(pending.length).toBe(1);
    const effectiveMs = pending[0]!.effectiveAt.getTime();

    // Sweep before the effective instant: still on Free.
    await svc.applyDueChanges();
    expect(await plan(ws)).toBe("Free");

    // Sweep after: moved to Team with a plan_change history row.
    setNow(effectiveMs + DAY);
    await svc.applyDueChanges();
    expect(await plan(ws)).toBe("Team");
    expect(await historyKinds(ws)).toContain("plan_change");
    resetNow();
  });

  it("re-scheduling a period-end change replaces the pending request (one per kind)", async () => {
    const ws = await makeFreeWorkspace();
    await svc.adminChangePlan(ws, { toPlanKey: "starter", timing: "period_end", settlement: undefined, compEndsAt: null, reason: "first" }, actor);
    await svc.adminChangePlan(ws, { toPlanKey: "team", timing: "period_end", settlement: undefined, compEndsAt: null, reason: "second" }, actor);
    const pending = await db
      .select()
      .from(planChangeRequests)
      .where(and(eq(planChangeRequests.workspaceId, ws), eq(planChangeRequests.kind, "period_end")));
    expect(pending.length).toBe(1);
    expect(pending[0]!.toPlanKey).toBe("team");
    expect(pending[0]!.reason).toBe("second");
  });

  it("refuses an admin move (comp, immediate, period-end) on an active provider subscription with a 409", async () => {
    const ws = await makeFreeWorkspace();
    await giveSubscription(ws, "active");
    await expect(
      svc.adminChangePlan(ws, { toPlanKey: "pro", timing: "immediate", settlement: "comp", compEndsAt: null, reason: "x" }, actor),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      svc.adminChangePlan(ws, { toPlanKey: "pro", timing: "period_end", settlement: undefined, compEndsAt: null, reason: "x" }, actor),
    ).rejects.toBeInstanceOf(ConflictException);
    // The plan was not moved and no request was written.
    expect(await plan(ws)).toBe("Free");
    const reqs = await db.select({ id: planChangeRequests.id }).from(planChangeRequests).where(eq(planChangeRequests.workspaceId, ws));
    expect(reqs.length).toBe(0);
  });

  it("refuses a move on a TRIALING subscription too", async () => {
    const ws = await makeFreeWorkspace();
    await giveSubscription(ws, "trialing");
    await expect(
      svc.adminChangePlan(ws, { toPlanKey: "pro", timing: "immediate", settlement: "comp", compEndsAt: null, reason: "x" }, actor),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("ALLOWS a move on a non-live subscription (e.g. cancelled) — it does not own the plan", async () => {
    const ws = await makeFreeWorkspace();
    await giveSubscription(ws, "cancelled");
    const result = await svc.adminChangePlan(
      ws,
      { toPlanKey: "pro", timing: "immediate", settlement: "comp", compEndsAt: null, reason: "comp over cancelled" },
      actor,
    );
    expect(result.outcome).toBe("applied");
    expect(await plan(ws)).toBe("Pro");
  });

  it("the sweep SKIPS a scheduled change whose workspace gained a live subscription after scheduling, recording why", async () => {
    const ws = await makeFreeWorkspace();
    // Schedule a period-end change while unsubscribed (allowed).
    await svc.adminChangePlan(ws, { toPlanKey: "team", timing: "period_end", settlement: undefined, compEndsAt: null, reason: "sched" }, actor);
    const [req] = await db
      .select()
      .from(planChangeRequests)
      .where(and(eq(planChangeRequests.workspaceId, ws), eq(planChangeRequests.kind, "period_end")));
    const effectiveMs = req!.effectiveAt.getTime();

    // A provider subscription appears before the change is due.
    await giveSubscription(ws, "active", "pro");

    // Sweep after the due instant: must NOT move the plan; records a skip row.
    setNow(effectiveMs + DAY);
    await svc.applyDueChanges();
    expect(await plan(ws)).toBe("Free"); // NOT moved to Team
    const [after] = await db
      .select({ appliedAt: planChangeRequests.appliedAt })
      .from(planChangeRequests)
      .where(eq(planChangeRequests.id, req!.id));
    expect(after!.appliedAt).not.toBeNull(); // claimed so it does not re-fire
    const skip = await db
      .select({ reason: workspacePlanHistory.reason })
      .from(workspacePlanHistory)
      .where(eq(workspacePlanHistory.workspaceId, ws));
    expect(skip.some((r) => (r.reason ?? "").toLowerCase().includes("skipped"))).toBe(true);
    resetNow();
  });

  it("rejects an unknown target plan", async () => {
    const ws = await makeFreeWorkspace();
    await expect(
      svc.adminChangePlan(ws, { toPlanKey: "nope-not-a-plan", timing: "immediate", settlement: "comp", compEndsAt: null, reason: "x" }, actor),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects a comp end date in the past", async () => {
    const ws = await makeFreeWorkspace();
    const past = new Date(nowMs - DAY).toISOString();
    await expect(
      svc.adminChangePlan(ws, { toPlanKey: "pro", timing: "immediate", settlement: "comp", compEndsAt: past, reason: "x" }, actor),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("404s plan-change and history for an unknown workspace", async () => {
    await expect(
      svc.adminChangePlan(randomUUID(), { toPlanKey: "pro", timing: "immediate", settlement: "comp", compEndsAt: null, reason: "x" }, actor),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(svc.history(randomUUID())).rejects.toBeInstanceOf(NotFoundException);
  });

  it("history returns the workspace's rows newest-first", async () => {
    const ws = await makeFreeWorkspace();
    await svc.adminChangePlan(ws, { toPlanKey: "pro", timing: "immediate", settlement: "comp", compEndsAt: null, reason: "one" }, actor);
    setNow(nowMs + 60_000);
    await svc.adminChangePlan(ws, { toPlanKey: "team", timing: "immediate", settlement: "comp", compEndsAt: null, reason: "two" }, actor);
    const list = await svc.history(ws);
    expect(list.items.length).toBeGreaterThanOrEqual(2);
    expect(list.items[0]!.toPlanKey).toBe("team");
    expect(list.items[0]!.reason).toBe("two");
    resetNow();
  });
});

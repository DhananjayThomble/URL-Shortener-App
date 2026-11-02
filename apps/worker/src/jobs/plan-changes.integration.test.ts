import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  and,
  createDatabase,
  eq,
  planChangeRequests,
  subscriptions,
  workspacePlanHistory,
  workspaces,
  type Database,
} from "@snapurl/database";
import { applyDuePlanChanges } from "./plan-changes.js";

/* ============================================================
   #992 — the worker sweep that applies due scheduled plan changes, against a
   real Postgres (the move + history write + applied-claim are all relational).

   Oracles:
     - a request due in the past is applied: the workspace plan moves and a
       history row is written, and the request is marked applied;
     - a request due in the future is NOT applied;
     - a second sweep applies nothing more (idempotent via the appliedAt claim);
     - a comp_revert writes a comp_revert history row, a period_end writes a
       plan_change row.

   Red-on-broken: drop the appliedAt claim and the idempotency assertion fails
   (the second sweep re-applies); drop the lte(effectiveAt, now) filter and the
   future-request assertion fails.

   DB-gated: skips with no DATABASE_URL.
   ============================================================ */

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;
const DAY = 24 * 3600_000;

describeDb("applyDuePlanChanges (#992 worker sweep)", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;
  const workspaceIds: string[] = [];

  beforeAll(() => {
    handle = createDatabase({ url: DATABASE_URL!, max: 1 });
    db = handle.db;
  });

  afterAll(async () => {
    for (const id of workspaceIds) {
      await db.delete(workspacePlanHistory).where(eq(workspacePlanHistory.workspaceId, id));
      await db.delete(planChangeRequests).where(eq(planChangeRequests.workspaceId, id));
      await db.delete(subscriptions).where(eq(subscriptions.workspaceId, id));
      await db.delete(workspaces).where(eq(workspaces.id, id));
    }
    await handle?.close();
  });

  async function makeWorkspace(plan: string): Promise<string> {
    const id = randomUUID();
    await db.insert(workspaces).values({ id, name: "t", slug: `pcw-${id.slice(0, 8)}`, plan });
    workspaceIds.push(id);
    return id;
  }

  async function scheduleRequest(
    workspaceId: string,
    kind: "period_end" | "comp_revert",
    toPlanKey: string,
    effectiveAt: Date,
  ): Promise<void> {
    await db.insert(planChangeRequests).values({
      workspaceId,
      fromPlanKey: "pro",
      toPlanKey,
      kind,
      reason: `${kind} test`,
      actorId: null,
      actorLabel: "system",
      effectiveAt,
      updatedAt: new Date(),
    });
  }

  async function giveSubscription(workspaceId: string, status: string): Promise<void> {
    await db.insert(subscriptions).values({
      workspaceId,
      planKey: "pro",
      interval: "monthly",
      provider: "razorpay",
      status,
    });
  }

  it("applies a due period-end request: moves the plan and writes a plan_change row", async () => {
    const ws = await makeWorkspace("Pro");
    await scheduleRequest(ws, "period_end", "starter", new Date(Date.now() - DAY));

    const applied = await applyDuePlanChanges(db);
    expect(applied).toBeGreaterThanOrEqual(1);

    const [wsRow] = await db.select({ plan: workspaces.plan }).from(workspaces).where(eq(workspaces.id, ws));
    expect(wsRow!.plan).toBe("Starter");

    const hist = await db
      .select({ kind: workspacePlanHistory.kind, timing: workspacePlanHistory.timing })
      .from(workspacePlanHistory)
      .where(eq(workspacePlanHistory.workspaceId, ws));
    expect(hist.some((h) => h.kind === "plan_change" && h.timing === "period_end")).toBe(true);

    // The request is now applied, and a second sweep does not re-apply it.
    const [req] = await db
      .select({ appliedAt: planChangeRequests.appliedAt })
      .from(planChangeRequests)
      .where(eq(planChangeRequests.workspaceId, ws));
    expect(req!.appliedAt).not.toBeNull();

    const histBefore = (await historyCount(ws));
    await applyDuePlanChanges(db);
    expect(await historyCount(ws)).toBe(histBefore);
  });

  it("does not apply a request due in the future", async () => {
    const ws = await makeWorkspace("Pro");
    await scheduleRequest(ws, "period_end", "free", new Date(Date.now() + 7 * DAY));
    await applyDuePlanChanges(db);
    const [wsRow] = await db.select({ plan: workspaces.plan }).from(workspaces).where(eq(workspaces.id, ws));
    expect(wsRow!.plan).toBe("Pro"); // unchanged
  });

  it("SKIPS a due request when the workspace gained an active subscription, recording why", async () => {
    const ws = await makeWorkspace("Pro");
    await scheduleRequest(ws, "period_end", "starter", new Date(Date.now() - DAY));
    await giveSubscription(ws, "active"); // a live subscription now owns the plan

    await applyDuePlanChanges(db);
    // The plan was NOT moved to Starter (the webhook owns it).
    const [wsRow] = await db.select({ plan: workspaces.plan }).from(workspaces).where(eq(workspaces.id, ws));
    expect(wsRow!.plan).toBe("Pro");
    // The request was claimed (so it does not re-fire) and a skip row recorded.
    const [req] = await db
      .select({ appliedAt: planChangeRequests.appliedAt })
      .from(planChangeRequests)
      .where(eq(planChangeRequests.workspaceId, ws));
    expect(req!.appliedAt).not.toBeNull();
    const hist = await db
      .select({ reason: workspacePlanHistory.reason })
      .from(workspacePlanHistory)
      .where(eq(workspacePlanHistory.workspaceId, ws));
    expect(hist.some((h) => (h.reason ?? "").toLowerCase().includes("skipped"))).toBe(true);
  });

  it("writes a comp_revert history row for a comp_revert request", async () => {
    const ws = await makeWorkspace("Pro");
    await scheduleRequest(ws, "comp_revert", "free", new Date(Date.now() - DAY));
    await applyDuePlanChanges(db);
    const hist = await db
      .select({ kind: workspacePlanHistory.kind })
      .from(workspacePlanHistory)
      .where(and(eq(workspacePlanHistory.workspaceId, ws), eq(workspacePlanHistory.kind, "comp_revert")));
    expect(hist.length).toBe(1);
    const [wsRow] = await db.select({ plan: workspaces.plan }).from(workspaces).where(eq(workspaces.id, ws));
    expect(wsRow!.plan).toBe("Free");
  });

  async function historyCount(workspaceId: string): Promise<number> {
    const rows = await db
      .select({ id: workspacePlanHistory.id })
      .from(workspacePlanHistory)
      .where(eq(workspacePlanHistory.workspaceId, workspaceId));
    return rows.length;
  }
});

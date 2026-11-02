import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { BadRequestException, ConflictException } from "@nestjs/common";
import {
  adminAuditLog,
  and,
  createDatabase,
  eq,
  memberships,
  subscriptions,
  users,
  workspacePlanHistory,
  workspaces,
  type Database,
} from "@snapurl/database";
import type { MailService } from "../mail/mail.service.js";
import { PlansService } from "./plans.service.js";
import { PlanManagementService } from "./plan-management.service.js";
import { BillingService } from "../billing/billing.service.js";
import { RazorpayBillingProvider, type RazorpayClient } from "../billing/razorpay.provider.js";
import { parsePlanIds } from "../billing/billing-plans.js";
import type { AdminActor } from "../admin/admin-management.service.js";

/* ============================================================
   #992 PR-C — an ADMIN provider-backed plan change on a SUBSCRIBED workspace.

   Oracles are the conductor's acceptance lines, not the implementation:
     - an admin "charge" on a subscribed workspace asks the provider and records
       the target, but DOES NOT move the plan — exactly like #988's owner path;
     - the confirming webhook (a charge reporting the target's provider plan id)
       applies it and clears the pending request;
     - a PERIOD-END charge is scheduled at the provider (cycle_end) and is not
       applied before the provider actually switches (no early move);
     - the admin action is audited and lands in the plan history, with the
       prorated amount recorded;
     - a comp on a subscribed workspace is still a 409; a charge on an
       UNSUBSCRIBED workspace is a 400 (nothing to bill).

   Red-on-broken: if adminChangePlan wrote planKey/workspaces.plan itself, the
   "not moved until the webhook" assertions red; if it skipped
   provider.updateSubscription, the provider-call assertion reds; if a comp were
   allowed on a live sub, the 409 test reds.

   Non-admin denial (the access matrix) is proven by the stack access-matrix
   guard, not here — this exercises the service logic against the real DB.

   DB-gated: skips with no DATABASE_URL. Razorpay is MOCKED (a fake client); no
   key, no network. Low-entropy fixture secrets only.
   ============================================================ */

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

const FAKE_WEBHOOK_SECRET = "whsec_test_fake_0000";
const FAKE_KEY_ID = "rzp_test_fake_0000";
const FAKE_KEY_SECRET = "keysec_test_fake_0000";

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

class FakeMail {
  async sendPaymentFailed(): Promise<void> {}
}

describeDb("PlanManagementService provider-backed charge (#992 PR-C)", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;
  let svc: PlanManagementService;
  let billing: BillingService;
  let fakeClient: RazorpayClient;

  const stamp = `${Date.now().toString(36)}${Math.random().toString(16).slice(2, 6)}`;
  const workspaceIds: string[] = [];
  const userIds: string[] = [];
  let actor: AdminActor;
  let actorId: string;

  function chargedEvent(eventId: string, subId: string, planId: string, currentEnd = 1_800_000_000) {
    return JSON.stringify({
      id: eventId,
      event: "subscription.charged",
      payload: { subscription: { entity: { id: subId, current_end: currentEnd, plan_id: planId } } },
    });
  }

  async function deliver(body: string) {
    const event = billing.verifyWebhook(body, sign(body, FAKE_WEBHOOK_SECRET));
    expect(event).not.toBeNull();
    return billing.handleWebhook(event!);
  }

  /** Seed a workspace and put it on an ACTIVE pro(monthly) subscription via a
   *  verified charge — the subscribed starting point for a PR-C admin change. */
  async function activePro(tag: string): Promise<{ workspaceId: string; subscriptionId: string }> {
    const email = `pm-charge-${tag}-${stamp}@example.com`;
    const [u] = await db.insert(users).values({ name: `U ${tag}`, email, emailVerifiedAt: new Date() }).returning({ id: users.id });
    userIds.push(u!.id);
    const [ws] = await db.insert(workspaces).values({ name: `WS ${tag}`, slug: `pm-charge-${tag}-${stamp}` }).returning({ id: workspaces.id });
    workspaceIds.push(ws!.id);
    await db.insert(memberships).values({ workspaceId: ws!.id, userId: u!.id, email, role: "owner", status: "active" });

    const session = await billing.startCheckout(ws!.id, email, "pro", "monthly");
    await deliver(chargedEvent(`evt_${stamp}_${tag}_activate`, session.subscriptionId, "plan_fake_pro_m"));
    return { workspaceId: ws!.id, subscriptionId: session.subscriptionId };
  }

  async function freeWorkspace(tag: string): Promise<string> {
    const id = randomUUID();
    await db.insert(workspaces).values({ id, name: "t", slug: `pm-charge-free-${tag}-${stamp}`, plan: "Free" });
    workspaceIds.push(id);
    return id;
  }

  async function planLabel(workspaceId: string): Promise<string> {
    const [row] = await db.select({ plan: workspaces.plan }).from(workspaces).where(eq(workspaces.id, workspaceId));
    return row!.plan;
  }

  beforeAll(async () => {
    handle = createDatabase({ url: DATABASE_URL!, max: 4 });
    db = handle.db;
    const plans = new PlansService(db);
    await plans.seedIfEmpty();

    let subSeq = 0;
    fakeClient = {
      createSubscription: vi.fn(async () => ({ id: `sub_${stamp}_${subSeq++}` })),
      cancelSubscription: vi.fn(async () => {}),
      updateSubscription: vi.fn(async () => {}),
      listInvoices: vi.fn(async () => []),
      refundPayment: vi.fn(async () => {}),
    };
    const provider = new RazorpayBillingProvider(
      {
        keyId: FAKE_KEY_ID,
        keySecret: FAKE_KEY_SECRET,
        webhookSecret: FAKE_WEBHOOK_SECRET,
        planIds: parsePlanIds(
          "pro:monthly=plan_fake_pro_m,pro:yearly=plan_fake_pro_y,team:monthly=plan_fake_team_m,starter:monthly=plan_fake_starter_m",
        ),
      },
      fakeClient,
    );
    billing = new BillingService(db, provider, plans, new FakeMail() as unknown as MailService, {
      validate: vi.fn(),
      recordRedemption: vi.fn(),
    } as never);
    svc = new PlanManagementService(db, plans, provider);

    const [u] = await db.insert(users).values({ name: "AdminC", email: `adminc-${stamp}@example.com` }).returning({ id: users.id });
    actorId = u!.id;
    userIds.push(u!.id);
    actor = { admin: { id: actorId, name: "AdminC", email: `adminc-${stamp}@example.com` }, ip: "203.0.113.9" };
  });

  afterAll(async () => {
    if (!db) return;
    await db.delete(adminAuditLog).where(eq(adminAuditLog.actorLabel, actor.admin.email));
    for (const id of workspaceIds) {
      await db.delete(workspacePlanHistory).where(eq(workspacePlanHistory.workspaceId, id));
      await db.delete(workspaces).where(eq(workspaces.id, id));
    }
    for (const id of userIds) await db.delete(users).where(eq(users.id, id));
    await handle?.close();
  });

  it("an immediate CHARGE on a subscribed workspace asks the provider and records the target, but does NOT move the plan", async () => {
    const { workspaceId, subscriptionId } = await activePro("immediate");
    const before = (fakeClient.updateSubscription as ReturnType<typeof vi.fn>).mock.calls.length;

    const result = await svc.adminChangePlan(
      workspaceId,
      { toPlanKey: "team", timing: "immediate", settlement: "charge", compEndsAt: null, reason: "Admin upgrade, charge the difference" },
      actor,
    );

    // The provider was asked to switch NOW; the plan is NOT moved locally.
    expect((fakeClient.updateSubscription as ReturnType<typeof vi.fn>).mock.calls.length).toBe(before + 1);
    const call = (fakeClient.updateSubscription as ReturnType<typeof vi.fn>).mock.calls.at(-1);
    expect(call![0]).toBe(subscriptionId);
    expect(call![1]).toEqual({ planId: "plan_fake_team_m", scheduleChangeAt: "now" });

    expect(result.outcome).toBe("requested");
    expect(result.settlement).toBe("charge");
    expect(result.proration).not.toBeNull();

    const [row] = await db.select().from(subscriptions).where(eq(subscriptions.workspaceId, workspaceId)).limit(1);
    expect(row!.planKey).toBe("pro"); // NOT team yet
    expect(row!.pendingPlanKey).toBe("team");
    expect(row!.pendingInterval).toBe("monthly");
    expect(await planLabel(workspaceId)).toBe("Pro"); // workspaces.plan unchanged

    // The admin action is audited and in the history (as the request).
    const audit = await db
      .select({ id: adminAuditLog.id })
      .from(adminAuditLog)
      .where(and(eq(adminAuditLog.action, "admin.workspace.plan_charge_requested"), eq(adminAuditLog.targetId, workspaceId)));
    expect(audit.length).toBe(1);
    const hist = await db
      .select()
      .from(workspacePlanHistory)
      .where(eq(workspacePlanHistory.workspaceId, workspaceId));
    const chargeRow = hist.find((h) => h.settlement === "charge");
    expect(chargeRow).toBeDefined();
    expect(chargeRow!.toPlanKey).toBe("team");
    expect(chargeRow!.amountMinor).not.toBeNull(); // prorated amount recorded
  });

  it("the confirming webhook (charge on the target plan id) applies the admin change and clears the pending request", async () => {
    const { workspaceId, subscriptionId } = await activePro("confirm");
    await svc.adminChangePlan(
      workspaceId,
      { toPlanKey: "team", timing: "immediate", settlement: "charge", compEndsAt: null, reason: "upgrade" },
      actor,
    );

    // The provider switched; the next charge reports the TARGET plan id.
    await deliver(chargedEvent(`evt_${stamp}_confirm_b`, subscriptionId, "plan_fake_team_m", 1_830_000_000));

    const [row] = await db.select().from(subscriptions).where(eq(subscriptions.workspaceId, workspaceId)).limit(1);
    expect(row!.planKey).toBe("team"); // applied
    expect(row!.pendingPlanKey).toBeNull();
    expect(await planLabel(workspaceId)).toBe("Team");
  });

  it("a PERIOD-END charge schedules at the provider (cycle_end) and is NOT applied while the provider still reports the old plan", async () => {
    const { workspaceId, subscriptionId } = await activePro("periodend");

    const result = await svc.adminChangePlan(
      workspaceId,
      { toPlanKey: "starter", timing: "period_end", settlement: "charge", compEndsAt: null, reason: "scheduled downgrade with charge" },
      actor,
    );
    expect(result.outcome).toBe("requested");
    expect(result.timing).toBe("period_end");
    // Period-end change is informational on proration (no immediate charge).
    expect(result.proration).toBeNull();
    const call = (fakeClient.updateSubscription as ReturnType<typeof vi.fn>).mock.calls.at(-1);
    expect(call![1]).toEqual({ planId: "plan_fake_starter_m", scheduleChangeAt: "cycle_end" });

    // A mid-cycle charge still on the OLD plan must NOT apply the downgrade.
    await deliver(chargedEvent(`evt_${stamp}_pe_mid`, subscriptionId, "plan_fake_pro_m", 1_820_000_000));
    const [mid] = await db.select().from(subscriptions).where(eq(subscriptions.workspaceId, workspaceId)).limit(1);
    expect(mid!.planKey).toBe("pro"); // NOT starter yet
    expect(mid!.pendingPlanKey).toBe("starter");

    // At the cycle end the provider switches; the charge now reports starter.
    await deliver(chargedEvent(`evt_${stamp}_pe_end`, subscriptionId, "plan_fake_starter_m", 1_850_000_000));
    const [after] = await db.select().from(subscriptions).where(eq(subscriptions.workspaceId, workspaceId)).limit(1);
    expect(after!.planKey).toBe("starter"); // applied at cycle end
    expect(after!.pendingPlanKey).toBeNull();
  });

  it("a COMP on a subscribed workspace is still refused with a 409 (a charge is required)", async () => {
    const { workspaceId } = await activePro("comp409");
    await expect(
      svc.adminChangePlan(
        workspaceId,
        { toPlanKey: "team", timing: "immediate", settlement: "comp", compEndsAt: null, reason: "comp" },
        actor,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    // Also the default (no settlement) immediate change is a comp → 409.
    await expect(
      svc.adminChangePlan(
        workspaceId,
        { toPlanKey: "team", timing: "immediate", settlement: undefined, compEndsAt: null, reason: "comp" },
        actor,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("a CHARGE on an UNSUBSCRIBED workspace is a 400 (nothing to bill)", async () => {
    const ws = await freeWorkspace("nocharge");
    await expect(
      svc.adminChangePlan(
        ws,
        { toPlanKey: "pro", timing: "immediate", settlement: "charge", compEndsAt: null, reason: "x" },
        actor,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("a CHARGE to the plan already in force, or to free, is a 400", async () => {
    const { workspaceId } = await activePro("samecharge");
    await expect(
      svc.adminChangePlan(workspaceId, { toPlanKey: "pro", timing: "immediate", settlement: "charge", compEndsAt: null, reason: "same" }, actor),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      svc.adminChangePlan(workspaceId, { toPlanKey: "free", timing: "immediate", settlement: "charge", compEndsAt: null, reason: "to free" }, actor),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

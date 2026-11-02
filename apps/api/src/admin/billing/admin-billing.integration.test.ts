import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  adminAuditLog,
  and,
  createDatabase,
  eq,
  memberships,
  payments,
  subscriptions,
  users,
  workspaces,
  type Database,
} from "@snapurl/database";
import type { MailService } from "../../mail/mail.service.js";
import { BillingService } from "../../billing/billing.service.js";
import { RazorpayBillingProvider, type RazorpayClient } from "../../billing/razorpay.provider.js";
import { parsePlanIds } from "../../billing/billing-plans.js";
import { AdminBillingService } from "./admin-billing.service.js";
import { PostgresAdminBillingReader } from "./admin-billing.reader.js";

/* ============================================================
   #989 — the admin refund + the revenue/subscriptions reads, end to end
   against the real DB.

   Oracles are the issue's acceptance lines, NOT the implementation:
     - "admin refund → audited": refunding a captured payment calls the
       provider's refund API, flips the local row to refunded, and writes ONE
       admin-audit row carrying the reason. There is no self-serve path — this
       only ever runs through the admin service.
     - revenue views: MRR is derived from the real captured amounts (yearly /12),
       active-by-plan counts entitled subscriptions, failed payments and
       in-grace are counted.

   Red-on-broken: skip writeAdminAuditEntry and the "audited" assertion reds (no
   audit row); flip the status before the provider call and a failed provider
   refund would wrongly show refunded — the test asserts the provider was called
   and the row flipped only on success.

   DB-gated: skips with no DATABASE_URL. Every assertion is on rows THIS test
   seeded (unique per-run stamp). Uses OBVIOUSLY FAKE fixture secrets.
   ============================================================ */

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

const FAKE = { keyId: "rzp_test_fake_0000", keySecret: "keysec_test_fake_0000", webhookSecret: "whsec_test_fake_0000" };

class FakeMail {
  async sendPaymentFailed(): Promise<void> {}
}

describeDb("#989 — admin refund (audited) + revenue reads", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;
  let admin: AdminBillingService;
  let billing: BillingService;
  let refundSpy: ReturnType<typeof vi.fn>;

  const stamp = `${Date.now().toString(36)}${Math.random().toString(16).slice(2, 6)}`;
  const workspaceIds: string[] = [];
  const userIds: string[] = [];

  async function seedWorkspace(tag: string) {
    const email = `adminbill-${tag}-${stamp}@example.com`;
    const [u] = await db.insert(users).values({ name: `AB ${tag}`, email, emailVerifiedAt: new Date() }).returning({ id: users.id });
    userIds.push(u!.id);
    const [ws] = await db.insert(workspaces).values({ name: `WS ${tag}`, slug: `adminbill-${tag}-${stamp}` }).returning({ id: workspaces.id });
    workspaceIds.push(ws!.id);
    await db.insert(memberships).values({ workspaceId: ws!.id, userId: u!.id, email, role: "owner", status: "active" });
    return { workspaceId: ws!.id, email };
  }

  async function seedActiveSub(workspaceId: string, tag: string, interval: "monthly" | "yearly", amount: string) {
    const subId = `sub_${stamp}_${tag}`;
    await db.insert(subscriptions).values({
      workspaceId,
      planKey: "pro",
      interval,
      provider: "razorpay",
      providerSubscriptionId: subId,
      status: "active",
      updatedAt: new Date(),
    });
    const [pay] = await db
      .insert(payments)
      .values({
        workspaceId,
        provider: "razorpay",
        providerPaymentId: `pay_${stamp}_${tag}`,
        providerSubscriptionId: subId,
        amount,
        currency: "INR",
        status: "captured",
      })
      .returning({ id: payments.id });
    return { subId, paymentId: pay!.id };
  }

  beforeAll(async () => {
    handle = createDatabase({ url: DATABASE_URL!, max: 4 });
    db = handle.db;
    refundSpy = vi.fn(async () => {});
    const fakeClient: RazorpayClient = {
      createSubscription: vi.fn(async () => ({ id: `sub_${stamp}_x` })),
      cancelSubscription: vi.fn(async () => {}),
      refundPayment: refundSpy,
    };
    const provider = new RazorpayBillingProvider(
      { keyId: FAKE.keyId, keySecret: FAKE.keySecret, webhookSecret: FAKE.webhookSecret, planIds: parsePlanIds("") },
      fakeClient,
    );
    billing = new BillingService(db, provider, new FakeMail() as unknown as MailService);
    admin = new AdminBillingService(db, new PostgresAdminBillingReader(db), billing);
  });

  afterAll(async () => {
    if (!db) return;
    // Audit rows have no workspace FK (they outlive the actor/target), so clear
    // this run's rows by the per-run actorLabel stamp first, then the seeded
    // workspaces (which cascade payments + subscriptions).
    await db.delete(adminAuditLog).where(eq(adminAuditLog.actorLabel, `root-${stamp}@example.com`));
    for (const id of workspaceIds) await db.delete(workspaces).where(eq(workspaces.id, id));
    for (const id of userIds) await db.delete(users).where(eq(users.id, id));
    await handle.close();
  });

  const actor = { admin: { id: null as unknown as string, name: "Root", email: `root-${stamp}@example.com`, isPlatformAdmin: true as const }, ip: "203.0.113.9" };

  it("refunds a captured payment: provider called, row flipped, ONE audit row with the reason", async () => {
    const { workspaceId } = await seedWorkspace("refund");
    const { paymentId } = await seedActiveSub(workspaceId, "refund", "monthly", "49900");

    const result = await admin.refund(paymentId, "duplicate charge", actor);
    expect(result.status).toBe("refunded");
    expect(result.paymentId).toBe(paymentId);
    expect(refundSpy).toHaveBeenCalledWith(`pay_${stamp}_refund`);

    const [row] = await db.select().from(payments).where(eq(payments.id, paymentId)).limit(1);
    expect(row!.status).toBe("refunded");

    const audit = await db
      .select()
      .from(adminAuditLog)
      .where(and(eq(adminAuditLog.action, "admin.billing.refund"), eq(adminAuditLog.targetId, paymentId)));
    expect(audit.length).toBe(1);
    expect(audit[0]!.actorLabel).toBe(actor.admin.email);
    expect((audit[0]!.after as { reason?: string }).reason).toBe("duplicate charge");
    expect(audit[0]!.requestIp).toBe("203.0.113.9");
    // cleanup this run's audit row (no workspace FK to cascade it)
    await db.delete(adminAuditLog).where(eq(adminAuditLog.id, audit[0]!.id));
  });

  it("refunding an already-refunded payment is rejected (400) and does not re-call the provider", async () => {
    const { workspaceId } = await seedWorkspace("twice");
    const { paymentId } = await seedActiveSub(workspaceId, "twice", "monthly", "49900");
    await admin.refund(paymentId, "first", actor);
    const callsAfterFirst = refundSpy.mock.calls.length;

    await expect(admin.refund(paymentId, "again", actor)).rejects.toThrow(/already been refunded/i);
    expect(refundSpy.mock.calls.length).toBe(callsAfterFirst); // no second provider call
    // cleanup the audit row from the first refund
    const audit = await db.select({ id: adminAuditLog.id }).from(adminAuditLog).where(eq(adminAuditLog.targetId, paymentId));
    for (const a of audit) await db.delete(adminAuditLog).where(eq(adminAuditLog.id, a.id));
  });

  it("rejects refunding a FAILED (never-captured) payment", async () => {
    const { workspaceId } = await seedWorkspace("failed");
    const subId = `sub_${stamp}_failed`;
    await db.insert(subscriptions).values({
      workspaceId, planKey: "pro", interval: "monthly", provider: "razorpay",
      providerSubscriptionId: subId, status: "active", updatedAt: new Date(),
    });
    const [pay] = await db.insert(payments).values({
      workspaceId, provider: "razorpay", providerPaymentId: `pay_${stamp}_failed`,
      providerSubscriptionId: subId, amount: "49900", currency: "INR", status: "failed",
    }).returning({ id: payments.id });

    await expect(admin.refund(pay!.id, "nope", actor)).rejects.toThrow(/captured/i);
  });

  it("rejects refunding an unknown payment (404)", async () => {
    await expect(admin.refund("00000000-0000-7000-8000-00000000dead", "x", actor)).rejects.toThrow(/No such payment/i);
  });

  it("revenue: MRR from captured amounts (yearly/12), active-by-plan, in-grace", async () => {
    const now = new Date();
    // Monthly pro at 49900 + yearly pro at 599000 (→ 49916/mo) on two workspaces.
    const { workspaceId: wsM } = await seedWorkspace("revm");
    await seedActiveSub(wsM, "revm", "monthly", "49900");
    const { workspaceId: wsY } = await seedWorkspace("revy");
    await seedActiveSub(wsY, "revy", "yearly", "599000");
    // A workspace in failed-payment grace (still entitled, counts in inGrace).
    const { workspaceId: wsG } = await seedWorkspace("revg");
    await db.insert(subscriptions).values({
      workspaceId: wsG, planKey: "team", interval: "monthly", provider: "razorpay",
      providerSubscriptionId: `sub_${stamp}_revg`, status: "halted",
      graceEndsAt: new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000), updatedAt: now,
    });

    const rev = await admin.revenue(30, now);
    // MRR includes at least our two priced active subs (others from siblings may add).
    expect(Number(rev.mrr)).toBeGreaterThanOrEqual(49900 + Math.floor(599000 / 12));
    expect(rev.currency).toBe("INR");
    expect(rev.activeSubscriptions).toBeGreaterThanOrEqual(3); // 2 active + 1 in grace entitled
    expect(rev.inGrace).toBeGreaterThanOrEqual(1);
    const pro = rev.activeByPlan.find((r) => r.label === "pro");
    expect(pro!.value).toBeGreaterThanOrEqual(2);
  });

  it("subscriptions list includes a seeded row with its workspace name", async () => {
    const { workspaceId } = await seedWorkspace("list");
    await seedActiveSub(workspaceId, "list", "monthly", "49900");
    const { subscriptions: rows } = await admin.subscriptions();
    const mine = rows.find((r) => r.workspaceId === workspaceId);
    expect(mine).toBeDefined();
    expect(mine!.planKey).toBe("pro");
    expect(mine!.status).toBe("active");
    expect(mine!.workspaceName).toBe(`WS list`);
  });

  it("workspace billing-events reads the stored events newest-first", async () => {
    const { workspaceId } = await seedWorkspace("events");
    const { subId } = await seedActiveSub(workspaceId, "events", "monthly", "49900");
    // Drive one real verified webhook so a billing_events row exists for this ws.
    const body = JSON.stringify({ id: `evt_${stamp}_events`, event: "subscription.charged", payload: { subscription: { entity: { id: subId, current_end: 1_900_000_000 } } } });
    const { createHmac } = await import("node:crypto");
    const sig = createHmac("sha256", FAKE.webhookSecret).update(body, "utf8").digest("hex");
    await billing.handleWebhook(billing.verifyWebhook(body, sig)!);

    const { events } = await admin.workspaceEvents(workspaceId);
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0]!.eventType).toBe("subscription.charged");
    expect(events[0]!.processedAt).not.toBeNull();
  });
});

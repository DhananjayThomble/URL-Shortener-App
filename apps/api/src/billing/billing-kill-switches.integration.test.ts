import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createDatabase,
  eq,
  memberships,
  payments,
  subscriptions,
  users,
  workspaces,
  type Database,
} from "@snapurl/database";
import type { MailService } from "../mail/mail.service.js";
import { BillingService } from "./billing.service.js";
import { RazorpayBillingProvider, type RazorpayClient } from "./razorpay.provider.js";
import { PlansService } from "../plans/plans.service.js";
import { KillSwitchOffError } from "../admin/kill-switch.service.js";
import { killSwitchStub } from "../test/kill-switch.stub.js";

/* ============================================================
   #1020 — kill switches, against the real DB, through BillingService.

   The invariants the issue turns on, proved end to end:

     1. VERIFIED WEBHOOK INGEST IS NEVER SWITCHED OFF. With EVERY billing switch
        OFF, a verified subscription.charged webhook STILL moves the workspace to
        its paid plan and records the payment — a payment the provider already
        took must land. handleWebhook reads no switch, so this holds by
        construction; the test proves the wiring.

     2. A SWITCHED-OFF FEATURE REFUSES AND CHANGES NOTHING. With billing.checkout
        OFF, startCheckout throws KillSwitchOffError (503) and writes no
        subscription row. Likewise refunds OFF => refundPayment refuses before
        any provider call or status flip.

   Oracles are those two acceptance lines, not the implementation. Red-on-broken:
   let handleWebhook consult the switch and test 1 reds; drop the assertOn in
   startCheckout/refundPayment and test 2 reds.

   DB-gated (skips with no DATABASE_URL); every assertion is on rows THIS run
   seeded (unique stamp). Obviously-fake low-entropy fixture secrets only.
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

describeDb("#1020 — billing kill switches (webhook never off; off refuses + changes nothing)", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;
  let fakeClient: RazorpayClient;

  const stamp = `${Date.now().toString(36)}${Math.random().toString(16).slice(2, 6)}`;
  const workspaceIds: string[] = [];
  const userIds: string[] = [];

  /** A BillingService with a chosen kill-switch set (default: all billing
   *  switches OFF, to prove the webhook still works and new actions refuse). */
  function serviceWith(changes: Parameters<typeof killSwitchStub>[0]["changes"]): BillingService {
    const provider = new RazorpayBillingProvider(
      { keyId: FAKE_KEY_ID, keySecret: FAKE_KEY_SECRET, webhookSecret: FAKE_WEBHOOK_SECRET, planIds: {} },
      fakeClient,
    );
    return new BillingService(
      db,
      provider,
      new PlansService(db),
      new FakeMail() as unknown as MailService,
      undefined as never, // CouponsService — unused on these paths
      killSwitchStub({ changes }),
    );
  }

  async function seedWorkspace(tag: string) {
    const email = `ks-${tag}-${stamp}@example.com`;
    const [u] = await db.insert(users).values({ name: `K ${tag}`, email, emailVerifiedAt: new Date() }).returning({ id: users.id });
    userIds.push(u!.id);
    const [ws] = await db.insert(workspaces).values({ name: `WS ${tag}`, slug: `ks-${tag}-${stamp}` }).returning({ id: workspaces.id });
    workspaceIds.push(ws!.id);
    await db.insert(memberships).values({ workspaceId: ws!.id, userId: u!.id, email, role: "owner", status: "active" });
    return { userId: u!.id, email, workspaceId: ws!.id };
  }

  function chargedEvent(eventId: string, subId: string) {
    return JSON.stringify({
      id: eventId,
      event: "subscription.charged",
      payload: { subscription: { entity: { id: subId, current_end: 1_800_000_000 } }, payment: { entity: { id: `pay_${eventId}`, amount: 49900, currency: "INR", status: "captured" } } },
    });
  }

  beforeAll(async () => {
    handle = createDatabase({ url: DATABASE_URL!, max: 4 });
    db = handle.db;
    fakeClient = {
      createSubscription: async () => ({ id: `sub_${stamp}_${Math.random().toString(16).slice(2, 6)}` }),
      cancelSubscription: async () => {},
      refundPayment: async () => {},
    } as unknown as RazorpayClient;
  });

  afterAll(async () => {
    if (!db) return;
    for (const id of workspaceIds) await db.delete(workspaces).where(eq(workspaces.id, id));
    for (const id of userIds) await db.delete(users).where(eq(users.id, id));
    await handle.close();
  });

  it("a verified webhook STILL moves the plan while every billing switch is OFF", async () => {
    const { workspaceId, email } = await seedWorkspace("webhook-off");
    // Turn the whole billing surface off.
    const off = serviceWith({
      "billing.checkout": { on: false },
      "billing.planChanges": { on: false },
      "billing.coupons": { on: false },
      "billing.trials": { on: false },
      "billing.refunds": { on: false },
    });

    // Seed a pending subscription directly (checkout is off, so we cannot use
    // startCheckout — that is exactly the point): a payment the provider took
    // for an existing sub must still be recorded.
    const subId = `sub_${stamp}_wh`;
    await db.insert(subscriptions).values({
      workspaceId,
      planKey: "pro",
      interval: "monthly",
      provider: "razorpay",
      providerSubscriptionId: subId,
      status: "created",
      updatedAt: new Date(),
    });

    const body = chargedEvent(`evt_${stamp}_wh`, subId);
    const event = off.verifyWebhook(body, sign(body, FAKE_WEBHOOK_SECRET));
    expect(event).not.toBeNull();
    const outcome = await off.handleWebhook(event!);
    expect(outcome).toBe("processed");

    // The plan moved and the payment was recorded, despite every billing switch
    // being off — the webhook path reads no switch.
    const sub = await off.currentSubscription(workspaceId);
    expect(sub.planKey).toBe("pro");
    expect(sub.status).toBe("active");
    const [pay] = await db.select().from(payments).where(eq(payments.workspaceId, workspaceId)).limit(1);
    expect(pay?.status).toBe("captured");
    void email;
  });

  it("startCheckout refuses (503) and writes NO subscription row while billing.checkout is OFF", async () => {
    const { workspaceId, email } = await seedWorkspace("checkout-off");
    const off = serviceWith({ "billing.checkout": { on: false } });

    await expect(off.startCheckout(workspaceId, email, "pro", "monthly")).rejects.toBeInstanceOf(KillSwitchOffError);

    const rows = await db.select().from(subscriptions).where(eq(subscriptions.workspaceId, workspaceId));
    expect(rows).toHaveLength(0); // nothing was created
  });

  it("refundPayment refuses (503) before any provider call while billing.refunds is OFF", async () => {
    const { workspaceId } = await seedWorkspace("refund-off");
    // Seed a captured payment to refund.
    const [pay] = await db
      .insert(payments)
      .values({
        workspaceId,
        provider: "razorpay",
        providerPaymentId: `pay_${stamp}_refund`,
        providerSubscriptionId: `sub_${stamp}_refund`,
        amount: 49900,
        currency: "INR",
        status: "captured",
      })
      .returning({ id: payments.id });

    let refundCalled = false;
    fakeClient.refundPayment = async () => {
      refundCalled = true;
    };
    const off = serviceWith({ "billing.refunds": { on: false } });

    await expect(off.refundPayment(pay!.id)).rejects.toBeInstanceOf(KillSwitchOffError);
    expect(refundCalled).toBe(false); // no provider call

    const [after] = await db.select().from(payments).where(eq(payments.id, pay!.id)).limit(1);
    expect(after!.status).toBe("captured"); // unchanged
  });
});

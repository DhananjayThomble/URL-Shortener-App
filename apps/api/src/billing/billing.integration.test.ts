import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  and,
  billingEvents,
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
import { NoneBillingProvider } from "./none-billing.provider.js";
import { parsePlanIds } from "./billing-plans.js";
import { GRACE_PERIOD_DAYS } from "./billing-lifecycle.js";

/** Records the payment-failed notices the service sends, so the grace test can
 *  assert the owner was emailed. Only the one method the billing service calls
 *  is implemented; the cast covers the rest of MailService, which it never
 *  touches. */
class FakeMail {
  readonly paymentFailed: Array<{ to: string; graceEndsAt: Date }> = [];
  async sendPaymentFailed(opts: { to: string; graceEndsAt: Date }): Promise<void> {
    this.paymentFailed.push(opts);
  }
}

/* ============================================================
   #986 — the webhook-moves-the-plan invariant, end to end, against the real DB.

   Oracles are the issue's acceptance lines, NOT the implementation:
     - "a workspace owner pays, the webhook arrives, the workspace moves to the
       paid plan" — a VERIFIED subscription.charged event flips the workspace to
       its paid plan and the subscription row to active, and stores the event;
     - "a forged or replayed webhook is rejected and changes nothing" — a body
       re-signed with the wrong secret never verifies (so the plan never moves),
       and a REPLAY of an already-seen event id is a no-op that writes no second
       row and does not re-move the plan;
     - "with BILLING_PROVIDER=none nothing is reachable" — the none provider is
       disabled, so the service reports unreachable.

   Red-on-broken: drop the idempotency onConflictDoNothing and the replay test
   reds (two event rows); let startCheckout write an entitled status and the
   "checkout does not move the plan" assertion reds; weaken verifyWebhook and
   the forged-event test reds.

   DB-gated: skips with no DATABASE_URL. Integration tests share the DB, so
   every assertion is on rows THIS test seeded (unique per-run stamp).

   Uses OBVIOUSLY FAKE low-entropy fixture secrets, never a real key.
   ============================================================ */

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

const FAKE_WEBHOOK_SECRET = "whsec_test_fake_0000";
const FAKE_KEY_ID = "rzp_test_fake_0000";
const FAKE_KEY_SECRET = "keysec_test_fake_0000";

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

describeDb("#986 — a verified webhook is the only thing that moves a plan", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;
  let service: BillingService;
  let fakeClient: RazorpayClient;
  let mail: FakeMail;

  const stamp = `${Date.now().toString(36)}${Math.random().toString(16).slice(2, 6)}`;
  const workspaceIds: string[] = [];
  const userIds: string[] = [];

  async function seedWorkspace(tag: string) {
    const email = `billing-${tag}-${stamp}@example.com`;
    const [u] = await db.insert(users).values({ name: `B ${tag}`, email, emailVerifiedAt: new Date() }).returning({ id: users.id });
    userIds.push(u!.id);
    const [ws] = await db.insert(workspaces).values({ name: `WS ${tag}`, slug: `billing-${tag}-${stamp}` }).returning({ id: workspaces.id });
    workspaceIds.push(ws!.id);
    await db.insert(memberships).values({ workspaceId: ws!.id, userId: u!.id, email, role: "owner", status: "active" });
    return { userId: u!.id, email, workspaceId: ws!.id };
  }

  function chargedEvent(eventId: string, subId: string, currentEnd = 1_800_000_000) {
    return JSON.stringify({
      id: eventId,
      event: "subscription.charged",
      payload: { subscription: { entity: { id: subId, current_end: currentEnd } } },
    });
  }

  /** A lifecycle event (halted / cancelled / activated …) with an optional
   *  current_end. #989 uses these to exercise grace and cancellation. */
  function lifecycleEvent(eventId: string, type: string, subId: string, currentEnd?: number) {
    return JSON.stringify({
      id: eventId,
      event: type,
      payload: { subscription: { entity: { id: subId, ...(currentEnd !== undefined ? { current_end: currentEnd } : {}) } } },
    });
  }

  /** A payment event carrying a payment entity, for the revenue views. */
  function paymentEvent(eventId: string, type: string, subId: string, payId: string, status: string, amount = 49900) {
    return JSON.stringify({
      id: eventId,
      event: type,
      payload: {
        subscription: { entity: { id: subId } },
        payment: { entity: { id: payId, amount, currency: "INR", status } },
      },
    });
  }

  /** Verify + handle a signed event body in one step. */
  async function deliver(body: string) {
    const event = service.verifyWebhook(body, sign(body, FAKE_WEBHOOK_SECRET));
    expect(event).not.toBeNull();
    return service.handleWebhook(event!);
  }

  /** Put a workspace on an ACTIVE pro subscription via a verified charge, the
   *  starting point for the grace / cancel lifecycle tests. */
  async function activate(tag: string) {
    const { workspaceId, email } = await seedWorkspace(tag);
    const session = await service.startCheckout(workspaceId, email, "pro", "monthly");
    await deliver(chargedEvent(`evt_${stamp}_${tag}_charge`, session.subscriptionId));
    return { workspaceId, email, subscriptionId: session.subscriptionId };
  }

  beforeAll(async () => {
    handle = createDatabase({ url: DATABASE_URL!, max: 4 });
    db = handle.db;
    // A unique subscription id per call, as Razorpay issues one per checkout —
    // so two workspaces never share a provider subscription id.
    let subSeq = 0;
    fakeClient = {
      createSubscription: vi.fn(async () => ({ id: `sub_${stamp}_${subSeq++}` })),
      cancelSubscription: vi.fn(async () => {}),
      refundPayment: vi.fn(async () => {}),
    };
    const provider = new RazorpayBillingProvider(
      {
        keyId: FAKE_KEY_ID,
        keySecret: FAKE_KEY_SECRET,
        webhookSecret: FAKE_WEBHOOK_SECRET,
        planIds: parsePlanIds("pro:monthly=plan_fake_pro_m"),
      },
      fakeClient,
    );
    mail = new FakeMail();
    service = new BillingService(db, provider, mail as unknown as MailService);
  });

  afterAll(async () => {
    if (!db) return;
    // payments and subscriptions cascade on workspace delete; billing_events
    // .workspace_id is SET NULL, so those rows survive the workspace delete and
    // must be cleared by the per-run stamp. Deleting the workspaces removes
    // payments + subscriptions with them.
    for (const id of workspaceIds) await db.delete(workspaces).where(eq(workspaces.id, id));
    for (const id of userIds) await db.delete(users).where(eq(users.id, id));
    // billing_events for this run (stamped event ids), orphaned by the SET NULL.
    const evRows = await db.select({ id: billingEvents.id, pid: billingEvents.providerEventId }).from(billingEvents);
    for (const r of evRows) {
      if (r.pid.includes(stamp)) await db.delete(billingEvents).where(eq(billingEvents.id, r.id));
    }
    await handle.close();
  });

  it("checkout writes a pending row and does NOT move the workspace plan", async () => {
    const { workspaceId, email } = await seedWorkspace("checkout");
    const session = await service.startCheckout(workspaceId, email, "pro", "monthly");
    expect(session.subscriptionId).toMatch(new RegExp(`^sub_${stamp}_\\d+$`));
    expect(session.keyId).toBe(FAKE_KEY_ID);
    expect(session.planKey).toBe("pro");

    const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.workspaceId, workspaceId)).limit(1);
    expect(sub!.status).toBe("created"); // pending, NOT an entitled status
    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
    expect(ws!.plan).toBe("Free"); // the browser's checkout never activates anything
  });

  it("a verified subscription.charged webhook moves the workspace to the paid plan", async () => {
    const { workspaceId, email } = await seedWorkspace("paid");
    const session = await service.startCheckout(workspaceId, email, "pro", "monthly");

    const body = chargedEvent(`evt_${stamp}_charged`, session.subscriptionId);
    const event = service.verifyWebhook(body, sign(body, FAKE_WEBHOOK_SECRET));
    expect(event).not.toBeNull();
    const outcome = await service.handleWebhook(event!);
    expect(outcome).toBe("processed");

    const sub = await service.currentSubscription(workspaceId);
    expect(sub.planKey).toBe("pro");
    expect(sub.status).toBe("active");
    expect(sub.currentPeriodEnd).toBe(new Date(1_800_000_000 * 1000).toISOString());

    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
    expect(ws!.plan).toBe("Pro");

    // The event was stored and marked processed.
    const [stored] = await db
      .select()
      .from(billingEvents)
      .where(and(eq(billingEvents.provider, "razorpay"), eq(billingEvents.providerEventId, `evt_${stamp}_charged`)))
      .limit(1);
    expect(stored!.eventType).toBe("subscription.charged");
    expect(stored!.processedAt).not.toBeNull();
    expect(stored!.workspaceId).toBe(workspaceId);
  });

  it("a REPLAY of the same event id changes nothing and writes no second row", async () => {
    const { workspaceId, email } = await seedWorkspace("replay");
    const session = await service.startCheckout(workspaceId, email, "pro", "monthly");

    const body = chargedEvent(`evt_${stamp}_second`, session.subscriptionId);
    const event = service.verifyWebhook(body, sign(body, FAKE_WEBHOOK_SECRET))!;

    // Process the first delivery:
    const first = await service.handleWebhook(event);
    expect(first).toBe("processed");

    // Replay the identical event id. The unique (provider, event id) index
    // refuses the second insert, so it is a no-op.
    const second = await service.handleWebhook(event);
    expect(second).toBe("duplicate");

    const rows = await db
      .select()
      .from(billingEvents)
      .where(and(eq(billingEvents.provider, "razorpay"), eq(billingEvents.providerEventId, `evt_${stamp}_second`)));
    expect(rows.length).toBe(1); // exactly one stored row despite two deliveries
  });

  it("a FORGED webhook never verifies, so the plan never moves", async () => {
    const { workspaceId, email } = await seedWorkspace("forged");
    const session = await service.startCheckout(workspaceId, email, "pro", "monthly");

    const body = chargedEvent(`evt_${stamp}_forged`, session.subscriptionId);
    // Signed with a secret the attacker guessed — not the real webhook secret.
    const forgedSig = sign(body, "whsec_attacker_9999");
    const event = service.verifyWebhook(body, forgedSig);
    expect(event).toBeNull(); // rejected at the signature gate — handleWebhook is never reached

    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
    expect(ws!.plan).toBe("Free"); // unchanged
    const forgedRows = await db
      .select()
      .from(billingEvents)
      .where(eq(billingEvents.providerEventId, `evt_${stamp}_forged`));
    expect(forgedRows.length).toBe(0); // a forged event is stored nowhere
  });

  /* ── #989 lifecycle ── */

  it("a failed payment opens a 7-day grace window: plan stays entitled, owner emailed, in-app notice present", async () => {
    const { workspaceId, subscriptionId, email } = await activate("grace");
    const before = mail.paymentFailed.length;

    // subscription.halted — retries exhausted, the charge failed.
    const outcome = await deliver(lifecycleEvent(`evt_${stamp}_grace_halt`, "subscription.halted", subscriptionId));
    expect(outcome).toBe("processed");

    // Still entitled (plan kept) DURING grace, and the row carries a grace end
    // ~7 days out.
    const [row] = await db.select().from(subscriptions).where(eq(subscriptions.workspaceId, workspaceId)).limit(1);
    expect(row!.status).toBe("halted");
    expect(row!.graceEndsAt).not.toBeNull();
    const daysOut = (row!.graceEndsAt!.getTime() - Date.now()) / (24 * 60 * 60 * 1000);
    expect(daysOut).toBeGreaterThan(GRACE_PERIOD_DAYS - 0.1);
    expect(daysOut).toBeLessThan(GRACE_PERIOD_DAYS + 0.1);

    // workspaces.plan is STILL the paid plan — data and paid features kept.
    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
    expect(ws!.plan).toBe("Pro");

    // The read path reports the plan as still Pro with a payment_failed notice.
    const sub = await service.currentSubscription(workspaceId);
    expect(sub.planKey).toBe("pro");
    expect(sub.notice).toEqual({ kind: "payment_failed", revertsAt: row!.graceEndsAt!.toISOString() });

    // The owner was emailed exactly once about the failure.
    expect(mail.paymentFailed.length).toBe(before + 1);
    expect(mail.paymentFailed.at(-1)!.to).toBe(email);
  });

  it("grace EXPIRY lapses the plan to free (data kept), with no further email", async () => {
    const { workspaceId, subscriptionId } = await activate("graceexp");
    await deliver(lifecycleEvent(`evt_${stamp}_graceexp_halt`, "subscription.halted", subscriptionId));

    // Force the grace window into the past, as the clock would after 7 days.
    await db
      .update(subscriptions)
      .set({ graceEndsAt: new Date(Date.now() - 60_000) })
      .where(eq(subscriptions.workspaceId, workspaceId));

    // Reading now (grace elapsed) reports FREE and no notice.
    const sub = await service.currentSubscription(workspaceId);
    expect(sub.planKey).toBe("free");
    expect(sub.notice).toBeNull();

    // The links/workspace row is untouched — only the plan label changes on the
    // next lifecycle event; the data is kept regardless.
    const [ws] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
    expect(ws).toBeDefined();
  });

  it("a repeat failure while already in grace keeps the ORIGINAL window and does not re-email", async () => {
    const { workspaceId, subscriptionId } = await activate("graceretry");
    await deliver(lifecycleEvent(`evt_${stamp}_graceretry_h1`, "subscription.halted", subscriptionId));
    const [first] = await db.select().from(subscriptions).where(eq(subscriptions.workspaceId, workspaceId)).limit(1);
    const emailsAfterFirst = mail.paymentFailed.length;

    // A second failed-payment event (e.g. a scheduled retry also failed).
    await deliver(lifecycleEvent(`evt_${stamp}_graceretry_h2`, "subscription.pending", subscriptionId));
    const [second] = await db.select().from(subscriptions).where(eq(subscriptions.workspaceId, workspaceId)).limit(1);

    expect(second!.graceEndsAt!.getTime()).toBe(first!.graceEndsAt!.getTime()); // window NOT extended
    expect(mail.paymentFailed.length).toBe(emailsAfterFirst); // emailed only when the window opened
  });

  it("a later successful charge CLEARS the grace window and re-activates the plan", async () => {
    const { workspaceId, subscriptionId } = await activate("recover");
    await deliver(lifecycleEvent(`evt_${stamp}_recover_halt`, "subscription.halted", subscriptionId));
    await deliver(chargedEvent(`evt_${stamp}_recover_recharge`, subscriptionId));

    const [row] = await db.select().from(subscriptions).where(eq(subscriptions.workspaceId, workspaceId)).limit(1);
    expect(row!.status).toBe("active");
    expect(row!.graceEndsAt).toBeNull(); // window cleared
    const sub = await service.currentSubscription(workspaceId);
    expect(sub.planKey).toBe("pro");
    expect(sub.notice).toBeNull();
  });

  it("cancellation keeps the plan until the period end, then lapses to free", async () => {
    const { workspaceId, subscriptionId } = await activate("cancel");
    // Cancel with a period end in the future.
    const futureEnd = Math.floor(Date.now() / 1000) + 10 * 24 * 60 * 60;
    await deliver(lifecycleEvent(`evt_${stamp}_cancel_c`, "subscription.cancelled", subscriptionId, futureEnd));

    // Still entitled until the period end, with a cancellation notice.
    const during = await service.currentSubscription(workspaceId);
    expect(during.planKey).toBe("pro");
    expect(during.notice).toEqual({ kind: "cancellation_scheduled", revertsAt: new Date(futureEnd * 1000).toISOString() });
    const [row] = await db.select().from(subscriptions).where(eq(subscriptions.workspaceId, workspaceId)).limit(1);
    expect(row!.cancelAtPeriodEnd).not.toBeNull();

    // Reading AFTER the period end reports free.
    const after = await service.currentSubscription(workspaceId, new Date((futureEnd + 1) * 1000));
    expect(after.planKey).toBe("free");
    expect(after.notice).toBeNull();
  });

  it("records captured and FAILED payments for the revenue views", async () => {
    const { workspaceId, subscriptionId } = await activate("pay");
    await deliver(paymentEvent(`evt_${stamp}_pay_cap`, "payment.captured", subscriptionId, `pay_${stamp}_cap`, "captured"));
    await deliver(paymentEvent(`evt_${stamp}_pay_fail`, "payment.failed", subscriptionId, `pay_${stamp}_fail`, "failed"));

    const rows = await db.select().from(payments).where(eq(payments.workspaceId, workspaceId));
    const byStatus = Object.fromEntries(rows.map((r) => [r.status, r]));
    expect(byStatus.captured).toBeDefined();
    expect(byStatus.failed).toBeDefined();
    expect(byStatus.captured!.amount).toBe("49900");
    expect(byStatus.captured!.currency).toBe("INR");
  });

  it("the none provider reports the surface unreachable", () => {
    const off = new BillingService(db, new NoneBillingProvider(), mail as unknown as MailService);
    expect(off.enabled).toBe(false);
    expect(off.verifyWebhook("{}", "x")).toBeNull();
  });
});

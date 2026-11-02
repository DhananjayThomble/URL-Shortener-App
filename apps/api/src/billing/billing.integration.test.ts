import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  and,
  billingEvents,
  createDatabase,
  eq,
  memberships,
  subscriptions,
  users,
  workspaces,
  type Database,
} from "@snapurl/database";
import { BillingService } from "./billing.service.js";
import { RazorpayBillingProvider, type RazorpayClient } from "./razorpay.provider.js";
import { NoneBillingProvider } from "./none-billing.provider.js";
import { parsePlanIds } from "./billing-plans.js";

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
    service = new BillingService(db, provider);
  });

  afterAll(async () => {
    if (!db) return;
    // billing_events and subscriptions cascade on workspace delete; delete the
    // seeded workspaces and users explicitly (billing_events.workspace_id is
    // SET NULL, so clear those rows by the per-run stamp first).
    await db.delete(billingEvents).where(eq(billingEvents.providerEventId, `evt_${stamp}_charged`));
    await db.delete(billingEvents).where(eq(billingEvents.providerEventId, `evt_${stamp}_second`));
    for (const id of workspaceIds) await db.delete(workspaces).where(eq(workspaces.id, id));
    for (const id of userIds) await db.delete(users).where(eq(users.id, id));
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

  it("the none provider reports the surface unreachable", () => {
    const off = new BillingService(db, new NoneBillingProvider());
    expect(off.enabled).toBe(false);
    expect(off.verifyWebhook("{}", "x")).toBeNull();
  });
});

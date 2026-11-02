import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createDatabase,
  eq,
  memberships,
  subscriptions,
  users,
  workspaces,
  type Database,
} from "@snapurl/database";
import { BillingService } from "./billing.service.js";
import { CouponsService } from "./coupons.service.js";
import { RazorpayBillingProvider, type RazorpayClient } from "./razorpay.provider.js";
import { parsePlanIds } from "./billing-plans.js";
import { PlansService } from "../plans/plans.service.js";

/* ============================================================
   #992 — the per-plan TRIAL, end to end against the real DB.

   Oracles are the issue's trial acceptance, NOT the implementation:
     - a trial grants the plan ONLY via the provider's trialing status: checkout
       of a trial plan writes a NON-entitled "created" row (no local grant), and
       the workspace is NOT on the plan until a verified `trialing` webbook lands;
     - the provider is asked to defer the first charge (start_at), and the local
       trial_ends_at is recorded;
     - convert: a later verified `active` webhook keeps the plan entitled;
     - revert: a verified `expired` webhook lapses the workspace back to Free.

   Red-on-broken: let startCheckout write an entitled status and "created, not
   entitled" reds; map the trial webhook to a non-entitled status and the
   "trialing entitles" assertion reds; drop the expired handling and revert reds.

   The trial window is modelled exactly as Razorpay reports it: the subscription
   entity is `authenticated` with a FUTURE charge_at, which the provider maps to
   our entitled `trialing` (see trialStatusFromEntity). The convert event is a
   charge whose entity is `active`; revert is `subscription.expired`.

   DB-gated: skips with no DATABASE_URL. Rows are this run's own. Handle closed
   in afterAll. Uses obviously-fake fixture secrets.
   ============================================================ */

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

const FAKE_WEBHOOK_SECRET = "whsec_test_fake_0000";
const FAKE_KEY_ID = "rzp_test_fake_0000";
const FAKE_KEY_SECRET = "keysec_test_fake_0000";
const PRO_MONTHLY_PLAN_ID = "plan_fake_pro_m";

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

class FakeMail {
  async sendPaymentFailed(): Promise<void> {}
}

/** A Razorpay subscription client whose createSubscription echoes a fixed id
 *  and records the params it was called with (so the test can assert start_at). */
function makeFakeClient(): RazorpayClient & { lastCreate?: Record<string, unknown> } {
  const client = {
    lastCreate: undefined as Record<string, unknown> | undefined,
    async createSubscription(params: Record<string, unknown>) {
      client.lastCreate = params;
      return { id: `sub_trial_${params.notes && (params.notes as Record<string, string>).workspaceId}` };
    },
    cancelSubscription: vi.fn(),
    refundPayment: vi.fn(),
    updateSubscription: vi.fn(),
    async listInvoices() {
      return [];
    },
  } as unknown as RazorpayClient & { lastCreate?: Record<string, unknown> };
  return client;
}

describeDb("#992 — trial lifecycle: trialing grants, convert keeps, revert lapses", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;
  let service: BillingService;
  let plans: PlansService;
  let fakeClient: RazorpayClient & { lastCreate?: Record<string, unknown> };

  const stamp = `${Date.now().toString(36)}${Math.random().toString(16).slice(2, 6)}`;
  const workspaceIds: string[] = [];
  const userIds: string[] = [];

  async function seedWorkspace(tag: string) {
    const email = `trial-${tag}-${stamp}@example.com`;
    const [u] = await db.insert(users).values({ name: `T ${tag}`, email, emailVerifiedAt: new Date() }).returning({ id: users.id });
    userIds.push(u!.id);
    const [ws] = await db.insert(workspaces).values({ name: `WS ${tag}`, slug: `trial-${tag}-${stamp}` }).returning({ id: workspaces.id });
    workspaceIds.push(ws!.id);
    await db.insert(memberships).values({ workspaceId: ws!.id, userId: u!.id, email, role: "owner", status: "active" });
    return { workspaceId: ws!.id, email };
  }

  /** A subscription event whose entity carries an explicit `status` and
   *  (optionally) a future/past charge_at, so the provider derives trialing vs
   *  active exactly as it would from a real Razorpay body. */
  function subEvent(
    eventId: string,
    type: string,
    subId: string,
    entity: Record<string, unknown>,
  ): string {
    return JSON.stringify({
      id: eventId,
      event: type,
      payload: { subscription: { entity: { id: subId, plan_id: PRO_MONTHLY_PLAN_ID, ...entity } } },
    });
  }

  async function deliver(body: string) {
    const event = service.verifyWebhook(body, sign(body, FAKE_WEBHOOK_SECRET));
    expect(event).not.toBeNull();
    return service.handleWebhook(event!);
  }

  async function subRow(workspaceId: string) {
    const [row] = await db.select().from(subscriptions).where(eq(subscriptions.workspaceId, workspaceId)).limit(1);
    return row;
  }

  async function wsPlan(workspaceId: string) {
    const [row] = await db.select({ plan: workspaces.plan }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
    return row?.plan;
  }

  beforeAll(() => {
    handle = createDatabase({ url: DATABASE_URL!, max: 4 });
    db = handle.db;
    fakeClient = makeFakeClient();
    const provider = new RazorpayBillingProvider(
      {
        keyId: FAKE_KEY_ID,
        keySecret: FAKE_KEY_SECRET,
        webhookSecret: FAKE_WEBHOOK_SECRET,
        planIds: parsePlanIds(`pro:monthly=${PRO_MONTHLY_PLAN_ID}`),
      },
      fakeClient,
    );
    plans = new PlansService(db);
    service = new BillingService(db, provider, plans, new FakeMail() as unknown as never, new CouponsService(db));
  });

  afterAll(async () => {
    if (!db) return;
    for (const id of workspaceIds) await db.delete(workspaces).where(eq(workspaces.id, id));
    for (const id of userIds) await db.delete(users).where(eq(users.id, id));
    await handle.close();
  });

  it("checkout of a trial plan defers the first charge and does NOT grant the plan locally", async () => {
    const { workspaceId, email } = await seedWorkspace("start");

    // The seed `pro` plan has trialDays 0, so override the resolved plan to
    // carry a 14-day trial — the plan catalogue is the source of truth and this
    // mirrors an admin having set trialDays on the plan.
    vi.spyOn(plans, "getByKey").mockResolvedValue({
      id: "p", key: "pro", displayName: "Pro", description: "", highlightBadge: null,
      sortOrder: 2, visibility: "public", currentVersionId: null, currentVersion: 1,
      features: {}, limits: {}, prices: { primaryCurrency: "INR", amounts: {} },
      trialDays: 14, trialRequiresCard: false,
    } as never);
    vi.spyOn(plans, "livePriceMinor").mockResolvedValue(49900);

    const session = await service.startCheckout(workspaceId, email, "pro", "monthly");

    // The provider was asked to defer the first charge (start_at ~14 days out).
    expect(fakeClient.lastCreate?.startAt).toBeTypeOf("number");
    // The confirmation carries the trial end.
    expect(session.trialEndsAt).not.toBeNull();

    // Local row is written "created" — NOT an entitled status — and the
    // workspace is NOT moved onto the plan. No local grant.
    const row = await subRow(workspaceId);
    expect(row?.status).toBe("created");
    expect(row?.trialEndsAt).not.toBeNull();
    expect(await wsPlan(workspaceId)).not.toBe("Pro");

    vi.restoreAllMocks();
  });

  it("a verified trialing webhook grants the plan (entitlement from the provider only)", async () => {
    const { workspaceId, email } = await seedWorkspace("grant");
    vi.spyOn(plans, "getByKey").mockResolvedValue({
      id: "p", key: "pro", displayName: "Pro", description: "", highlightBadge: null,
      sortOrder: 2, visibility: "public", currentVersionId: null, currentVersion: 1,
      features: {}, limits: {}, prices: { primaryCurrency: "INR", amounts: {} },
      trialDays: 14, trialRequiresCard: true,
    } as never);
    vi.spyOn(plans, "livePriceMinor").mockResolvedValue(49900);
    const session = await service.startCheckout(workspaceId, email, "pro", "monthly");
    vi.restoreAllMocks();

    // Before the webhook: still not entitled.
    expect(await wsPlan(workspaceId)).not.toBe("Pro");

    // Razorpay reports the trial as entity status "authenticated" with a FUTURE
    // charge_at — the provider maps that to our entitled `trialing`.
    const futureChargeAt = Math.floor((Date.now() + 14 * 24 * 60 * 60 * 1000) / 1000);
    await deliver(
      subEvent(`evt_${stamp}_grant_trial`, "subscription.authenticated", session.subscriptionId, {
        status: "authenticated",
        charge_at: futureChargeAt,
      }),
    );

    const row = await subRow(workspaceId);
    expect(row?.status).toBe("trialing");
    // Entitled: the workspace plan is now Pro, granted by the webhook.
    expect(await wsPlan(workspaceId)).toBe("Pro");
  });

  it("CONVERT: a verified charge (entity active) keeps the workspace on the plan", async () => {
    const { workspaceId, email } = await seedWorkspace("convert");
    vi.spyOn(plans, "getByKey").mockResolvedValue({
      id: "p", key: "pro", displayName: "Pro", description: "", highlightBadge: null,
      sortOrder: 2, visibility: "public", currentVersionId: null, currentVersion: 1,
      features: {}, limits: {}, prices: { primaryCurrency: "INR", amounts: {} },
      trialDays: 7, trialRequiresCard: true,
    } as never);
    vi.spyOn(plans, "livePriceMinor").mockResolvedValue(49900);
    const session = await service.startCheckout(workspaceId, email, "pro", "monthly");
    vi.restoreAllMocks();

    const futureChargeAt = Math.floor((Date.now() + 7 * 24 * 60 * 60 * 1000) / 1000);
    await deliver(
      subEvent(`evt_${stamp}_conv_trial`, "subscription.authenticated", session.subscriptionId, {
        status: "authenticated",
        charge_at: futureChargeAt,
      }),
    );
    expect((await subRow(workspaceId))?.status).toBe("trialing");

    // Trial ends: the first charge succeeds, entity is now active.
    await deliver(
      subEvent(`evt_${stamp}_conv_charge`, "subscription.charged", session.subscriptionId, {
        status: "active",
        current_end: Math.floor((Date.now() + 37 * 24 * 60 * 60 * 1000) / 1000),
      }),
    );

    expect((await subRow(workspaceId))?.status).toBe("active");
    expect(await wsPlan(workspaceId)).toBe("Pro");
  });

  it("REVERT: a verified expired webhook lapses the workspace back to Free", async () => {
    const { workspaceId, email } = await seedWorkspace("revert");
    vi.spyOn(plans, "getByKey").mockResolvedValue({
      id: "p", key: "pro", displayName: "Pro", description: "", highlightBadge: null,
      sortOrder: 2, visibility: "public", currentVersionId: null, currentVersion: 1,
      features: {}, limits: {}, prices: { primaryCurrency: "INR", amounts: {} },
      trialDays: 7, trialRequiresCard: false,
    } as never);
    vi.spyOn(plans, "livePriceMinor").mockResolvedValue(49900);
    const session = await service.startCheckout(workspaceId, email, "pro", "monthly");
    vi.restoreAllMocks();

    const futureChargeAt = Math.floor((Date.now() + 7 * 24 * 60 * 60 * 1000) / 1000);
    await deliver(
      subEvent(`evt_${stamp}_rev_trial`, "subscription.authenticated", session.subscriptionId, {
        status: "authenticated",
        charge_at: futureChargeAt,
      }),
    );
    expect(await wsPlan(workspaceId)).toBe("Pro");

    // The trial ends with no conversion (no card / card declined) → expired.
    await deliver(
      subEvent(`evt_${stamp}_rev_expire`, "subscription.expired", session.subscriptionId, {
        status: "expired",
      }),
    );

    expect((await subRow(workspaceId))?.status).toBe("expired");
    // Lapsed back to Free — the entitlement is gone.
    expect(await wsPlan(workspaceId)).toBe("Free");
  });
});

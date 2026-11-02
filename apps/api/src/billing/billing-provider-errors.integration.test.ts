import { HttpException } from "@nestjs/common";
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
import { parsePlanIds as parsePlanIdsLocal } from "./billing-plans.js";
import { killSwitchStub } from "../test/kill-switch.stub.js";
import { rethrowIfProviderError } from "./billing-provider-error.http.js";
import { PlanManagementService } from "../plans/plan-management.service.js";
import { AdminBillingService } from "../admin/billing/admin-billing.service.js";
import type { AdminBillingReader } from "../admin/billing/admin-billing.reader.js";
import type { AdminActor } from "../admin/admin-management.service.js";

/* ============================================================
   #1023 — a provider failure on a billing WRITE surfaces as a meaningful 4xx
   (or a 503 for an outage), NEVER the generic 500 "try again", and NEVER writes
   local state. Against the real DB, end to end, for the FOUR write endpoints
   each crossed with the THREE provider-failure modes (4xx / 5xx / timeout).

   Oracles are the issue's acceptance lines, not the implementation:
     - a provider 4xx  → a 409 (rejected) with a stable reason code + honest
                         message, and NO local write;
     - a provider 5xx  → a 503 (unavailable), NO local write;
     - a provider timeout/network error → a 503 (unavailable), NO local write;
     - no provider body / id / secret appears in the thrown response.

   The four endpoints map ONE error shape via rethrowIfProviderError, so each
   case drives the real service (which throws BillingProviderError from the
   adapter) and then maps it exactly as the controller/admin-service does.

   Red-on-broken: drop the callProvider wrap in the adapter and the service
   throws the raw provider error → rethrowIfProviderError does not catch it →
   the "is an HttpException with a 4xx/503 + reason" assertion reds; write the
   pending change before the provider call and the "no state change" assertion
   reds.

   DB-gated: skips with no DATABASE_URL. Obviously-fake low-entropy secrets.
   Pools closed in afterAll.
   ============================================================ */

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

const FAKE_WEBHOOK_SECRET = "whsec_test_fake_0000";
const FAKE_KEY_ID = "rzp_test_fake_0000";
const FAKE_KEY_SECRET = "keysec_test_fake_0000";
// A test (plan key, interval) → provider plan id mapping, so updateSubscription
// resolves a plan id and reaches the provider call (where the failure is).
const FAKE_PLAN_IDS = "pro:monthly=plan_fake_pro_m,pro:yearly=plan_fake_pro_y,team:monthly=plan_fake_team_m";

class FakeMail {
  async sendPaymentFailed(): Promise<void> {}
}

/** The three provider-failure modes, each with the kind it must classify to and
 *  the HTTP status it must surface as. The 4xx error body deliberately carries a
 *  description that echoes request-ish text — it must NEVER reach the client. */
const FAILURE_MODES = [
  {
    label: "provider 4xx",
    error: () =>
      Object.assign(new Error("Request failed"), {
        statusCode: 400,
        error: { code: "BAD_REQUEST_ERROR", description: "Can't update subscription when subscription is not in Authenticated or Active state", field: "status" },
      }),
    expectStatus: 409,
    expectReason: "provider_rejected",
  },
  {
    label: "provider 5xx",
    error: () => Object.assign(new Error("Server error"), { statusCode: 502 }),
    expectStatus: 503,
    expectReason: "provider_unavailable",
  },
  {
    label: "provider timeout",
    error: () => Object.assign(new Error("timed out"), { code: "ETIMEDOUT" }),
    expectStatus: 503,
    expectReason: "provider_unavailable",
  },
] as const;

/** Map a thrown error through the SAME chokepoint every write endpoint uses,
 *  then return the resulting HttpException (or rethrow a non-provider error). */
function mapAsEndpoint(err: unknown): HttpException {
  try {
    rethrowIfProviderError(err);
  } catch (mapped) {
    return mapped as HttpException;
  }
  throw new Error(`expected a provider error to be mapped, got: ${String(err)}`);
}

function assertProviderHttp(ex: HttpException, status: number, reason: string): void {
  expect(ex).toBeInstanceOf(HttpException);
  expect(ex.getStatus()).toBe(status);
  const body = ex.getResponse() as Record<string, unknown>;
  expect(body.statusCode).toBe(status);
  expect(body.reason).toBe(reason);
  expect(body.statusCode).not.toBe(500);
  // No provider internals in the message.
  expect(JSON.stringify(body)).not.toMatch(/BAD_REQUEST_ERROR|Authenticated or Active|field/);
}

describeDb("#1023 — provider failures on billing writes map to 4xx/503 with no state change", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;
  const stamp = `${Date.now().toString(36)}${Math.random().toString(16).slice(2, 6)}`;
  const workspaceIds: string[] = [];
  const userIds: string[] = [];

  /** A fake Razorpay client whose write methods throw a chosen error. */
  function throwingClient(makeError: () => unknown): RazorpayClient {
    return {
      createSubscription: async () => ({ id: `sub_${stamp}` }),
      cancelSubscription: async () => { throw makeError(); },
      updateSubscription: async () => { throw makeError(); },
      refundPayment: async () => { throw makeError(); },
      listInvoices: async () => [],
    } as unknown as RazorpayClient;
  }

  function providerWith(client: RazorpayClient): RazorpayBillingProvider {
    return new RazorpayBillingProvider(
      { keyId: FAKE_KEY_ID, keySecret: FAKE_KEY_SECRET, webhookSecret: FAKE_WEBHOOK_SECRET, planIds: parsePlanIdsLocal(FAKE_PLAN_IDS) },
      client,
    );
  }

  function billingServiceWith(provider: RazorpayBillingProvider): BillingService {
    return new BillingService(
      db,
      provider,
      new PlansService(db),
      new FakeMail() as unknown as MailService,
      undefined as never,
      killSwitchStub({}),
    );
  }

  async function seedWorkspace(tag: string) {
    const email = `pe-${tag}-${stamp}@example.com`;
    const [u] = await db.insert(users).values({ name: `P ${tag}`, email, emailVerifiedAt: new Date() }).returning({ id: users.id });
    userIds.push(u!.id);
    const [ws] = await db.insert(workspaces).values({ name: `WS ${tag}`, slug: `pe-${tag}-${stamp}` }).returning({ id: workspaces.id });
    workspaceIds.push(ws!.id);
    await db.insert(memberships).values({ workspaceId: ws!.id, userId: u!.id, email, role: "owner", status: "active" });
    return { userId: u!.id, email, workspaceId: ws!.id };
  }

  /** Seed an ACTIVE paid subscription with a provider id, so change/cancel/charge
   *  reach the provider call. */
  async function seedActiveSub(workspaceId: string, tag: string, planKey = "pro", interval = "monthly") {
    const subId = `sub_${stamp}_${tag}`;
    await db.insert(subscriptions).values({
      workspaceId,
      planKey,
      interval,
      provider: "razorpay",
      providerSubscriptionId: subId,
      status: "active",
      currentPeriodEnd: new Date(Date.now() + 20 * 24 * 3600_000),
      updatedAt: new Date(),
    });
    return subId;
  }

  beforeAll(async () => {
    handle = createDatabase({ url: DATABASE_URL!, max: 4 });
    db = handle.db;
  });

  afterAll(async () => {
    if (!db) return;
    for (const id of workspaceIds) await db.delete(workspaces).where(eq(workspaces.id, id));
    for (const id of userIds) await db.delete(users).where(eq(users.id, id));
    await handle.close();
  });

  /* ── /billing/change (owner) ── */
  for (const mode of FAILURE_MODES) {
    it(`/billing/change: ${mode.label} → ${mode.expectStatus} ${mode.expectReason}, pendingPlanKey NOT written`, async () => {
      const { workspaceId } = await seedWorkspace(`change-${mode.label.replace(/\W+/g, "")}`);
      await seedActiveSub(workspaceId, "change");
      const service = billingServiceWith(providerWith(throwingClient(mode.error)));

      const err = await service.changePlan(workspaceId, "team", "monthly").catch((e) => e);
      assertProviderHttp(mapAsEndpoint(err), mode.expectStatus, mode.expectReason);

      // No pending change was recorded — the provider was asked first and failed.
      const [row] = await db.select().from(subscriptions).where(eq(subscriptions.workspaceId, workspaceId)).limit(1);
      expect(row!.pendingPlanKey).toBeNull();
      expect(row!.pendingInterval).toBeNull();
      expect(row!.planKey).toBe("pro"); // entitlement untouched
    });
  }

  /* ── /billing/cancel (owner) ── */
  for (const mode of FAILURE_MODES) {
    it(`/billing/cancel: ${mode.label} → ${mode.expectStatus} ${mode.expectReason}, cancelAtPeriodEnd NOT written`, async () => {
      const { workspaceId } = await seedWorkspace(`cancel-${mode.label.replace(/\W+/g, "")}`);
      await seedActiveSub(workspaceId, "cancel");
      const service = billingServiceWith(providerWith(throwingClient(mode.error)));

      const err = await service.cancelSubscription(workspaceId, true, { reason: null, comment: null }).catch((e) => e);
      assertProviderHttp(mapAsEndpoint(err), mode.expectStatus, mode.expectReason);

      const [row] = await db.select().from(subscriptions).where(eq(subscriptions.workspaceId, workspaceId)).limit(1);
      expect(row!.cancelAtPeriodEnd).toBeNull(); // cancellation not scheduled
      expect(row!.status).toBe("active"); // untouched
    });
  }

  /* ── admin refund ── */
  for (const mode of FAILURE_MODES) {
    it(`admin refund: ${mode.label} → ${mode.expectStatus} ${mode.expectReason}, payment stays captured`, async () => {
      const { workspaceId } = await seedWorkspace(`refund-${mode.label.replace(/\W+/g, "")}`);
      const [pay] = await db
        .insert(payments)
        .values({
          workspaceId,
          provider: "razorpay",
          providerPaymentId: `pay_${stamp}_${mode.label.replace(/\W+/g, "")}`,
          providerSubscriptionId: `sub_${stamp}_refund`,
          amount: 49900,
          currency: "INR",
          status: "captured",
        })
        .returning({ id: payments.id });

      const billing = billingServiceWith(providerWith(throwingClient(mode.error)));
      const adminBilling = new AdminBillingService(db, {} as unknown as AdminBillingReader, billing);
      const actor = { admin: { id: "00000000-0000-0000-0000-000000000000", email: "admin@x.com" }, ip: null } as unknown as AdminActor;

      const err = await adminBilling.refund(pay!.id, "customer asked", actor).catch((e) => e);
      assertProviderHttp(err as HttpException, mode.expectStatus, mode.expectReason);

      const [after] = await db.select().from(payments).where(eq(payments.id, pay!.id)).limit(1);
      expect(after!.status).toBe("captured"); // no money marked returned
    });
  }

  /* ── admin plan-change charge ── */
  for (const mode of FAILURE_MODES) {
    it(`admin plan-charge: ${mode.label} → ${mode.expectStatus} ${mode.expectReason}, nothing written`, async () => {
      const { workspaceId } = await seedWorkspace(`charge-${mode.label.replace(/\W+/g, "")}`);
      await seedActiveSub(workspaceId, "charge");
      const provider = providerWith(throwingClient(mode.error));
      const planManagement = new PlanManagementService(db, new PlansService(db), provider, killSwitchStub({}));

      const actor = { admin: { id: "00000000-0000-0000-0000-000000000000", email: "admin@x.com" }, ip: null } as unknown as AdminActor;
      const err = await planManagement
        .adminChangePlan(workspaceId, { toPlanKey: "team", settlement: "charge", timing: "immediate", reason: "upsell" }, actor)
        .catch((e) => e);
      assertProviderHttp(err as HttpException, mode.expectStatus, mode.expectReason);

      const [row] = await db.select().from(subscriptions).where(eq(subscriptions.workspaceId, workspaceId)).limit(1);
      expect(row!.pendingPlanKey).toBeNull(); // no pending change recorded
      expect(row!.planKey).toBe("pro"); // untouched
    });
  }
});

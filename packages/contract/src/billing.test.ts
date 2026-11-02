import { describe, expect, it } from "vitest";
import {
  BILLING_INTERVALS,
  CheckoutSession,
  PAID_PLAN_KEYS,
  PLAN_KEYS,
  StartCheckoutInput,
  SUBSCRIPTION_STATUSES,
  WorkspaceSubscription,
} from "./billing.js";

/* #986 — billing.ts carries the paid-plan wire shapes. These tests pin the
   load-bearing logic: the closed key/interval/status enumerations (so a typo'd
   plan key on the wire is rejected, not silently accepted), the literal
   provider tag on CheckoutSession, and the nullable-but-present fields of
   WorkspaceSubscription that tell "no paid plan" apart from "field missing".
   They are also the mutation-coverage guard for this contract file (the
   required domain+contract mutation job breaks below 95%). */

describe("plan key and interval tuples", () => {
  it("PLAN_KEYS is exactly free + the three paid keys, in order", () => {
    expect(PLAN_KEYS).toEqual(["free", "starter", "pro", "team"]);
  });

  it("PAID_PLAN_KEYS is PLAN_KEYS without free", () => {
    expect(PAID_PLAN_KEYS).toEqual(["starter", "pro", "team"]);
    expect([...PAID_PLAN_KEYS]).not.toContain("free");
  });

  it("BILLING_INTERVALS is monthly and yearly only", () => {
    expect(BILLING_INTERVALS).toEqual(["monthly", "yearly"]);
  });

  it("SUBSCRIPTION_STATUSES covers every Razorpay state we map", () => {
    expect(SUBSCRIPTION_STATUSES).toEqual([
      "created",
      "authenticated",
      "active",
      "trialing",
      "past_due",
      "halted",
      "cancelled",
      "completed",
      "expired",
    ]);
  });
});

describe("StartCheckoutInput", () => {
  it("accepts each paid plan key with each interval", () => {
    for (const planKey of PAID_PLAN_KEYS) {
      for (const interval of BILLING_INTERVALS) {
        expect(StartCheckoutInput.safeParse({ planKey, interval }).success).toBe(true);
      }
    }
  });

  it("rejects the free plan as a checkout target", () => {
    expect(StartCheckoutInput.safeParse({ planKey: "free", interval: "monthly" }).success).toBe(false);
  });

  it("rejects an unknown plan key", () => {
    expect(StartCheckoutInput.safeParse({ planKey: "enterprise", interval: "monthly" }).success).toBe(false);
  });

  it("rejects an unknown interval", () => {
    expect(StartCheckoutInput.safeParse({ planKey: "pro", interval: "weekly" }).success).toBe(false);
  });

  it("requires both planKey and interval", () => {
    expect(StartCheckoutInput.safeParse({ planKey: "pro" }).success).toBe(false);
    expect(StartCheckoutInput.safeParse({ interval: "monthly" }).success).toBe(false);
  });
});

describe("CheckoutSession", () => {
  const valid = {
    provider: "razorpay" as const,
    subscriptionId: "sub_test_000",
    keyId: "rzp_test_000",
    planKey: "pro" as const,
    interval: "yearly" as const,
    amountMinor: 199000,
    currency: "INR",
  };

  it("accepts a well-formed session", () => {
    expect(CheckoutSession.safeParse(valid).success).toBe(true);
  });

  it("#987 — carries the live amount (minor units) and currency; amountMinor may be null", () => {
    expect(CheckoutSession.safeParse({ ...valid, amountMinor: null }).success).toBe(true);
    expect(CheckoutSession.safeParse({ ...valid, amountMinor: -1 }).success).toBe(false);
    expect(CheckoutSession.safeParse({ ...valid, amountMinor: 1.5 }).success).toBe(false);
    const { amountMinor, ...noAmount } = valid;
    void amountMinor;
    expect(CheckoutSession.safeParse(noAmount).success).toBe(false);
    const { currency, ...noCurrency } = valid;
    void currency;
    expect(CheckoutSession.safeParse(noCurrency).success).toBe(false);
  });

  it("requires provider to be the literal razorpay", () => {
    expect(CheckoutSession.safeParse({ ...valid, provider: "stripe" }).success).toBe(false);
    expect(CheckoutSession.safeParse({ ...valid, provider: undefined }).success).toBe(false);
  });

  it("requires a subscriptionId and keyId", () => {
    expect(CheckoutSession.safeParse({ ...valid, subscriptionId: undefined }).success).toBe(false);
    expect(CheckoutSession.safeParse({ ...valid, keyId: undefined }).success).toBe(false);
  });

  it("rejects the free plan on a checkout session", () => {
    expect(CheckoutSession.safeParse({ ...valid, planKey: "free" }).success).toBe(false);
  });
});

describe("WorkspaceSubscription", () => {
  const free = {
    planKey: "free" as const,
    interval: null,
    status: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    notice: null,
  };

  it("accepts the unsubscribed (free) shape with null interval/status/period", () => {
    expect(WorkspaceSubscription.safeParse(free).success).toBe(true);
  });

  it("accepts an active paid subscription", () => {
    const active = {
      planKey: "team" as const,
      interval: "monthly" as const,
      status: "active" as const,
      currentPeriodEnd: "2026-12-01T00:00:00.000Z",
      cancelAtPeriodEnd: true,
      notice: null,
    };
    expect(WorkspaceSubscription.safeParse(active).success).toBe(true);
  });

  it("requires interval/status/currentPeriodEnd to be PRESENT (nullable, not optional)", () => {
    expect(WorkspaceSubscription.safeParse({ ...free, interval: undefined }).success).toBe(false);
    expect(WorkspaceSubscription.safeParse({ ...free, status: undefined }).success).toBe(false);
    expect(WorkspaceSubscription.safeParse({ ...free, currentPeriodEnd: undefined }).success).toBe(false);
  });

  it("requires cancelAtPeriodEnd to be a boolean", () => {
    expect(WorkspaceSubscription.safeParse({ ...free, cancelAtPeriodEnd: undefined }).success).toBe(false);
    expect(WorkspaceSubscription.safeParse({ ...free, cancelAtPeriodEnd: "no" }).success).toBe(false);
  });

  it("rejects an unknown status and an unknown plan key", () => {
    expect(WorkspaceSubscription.safeParse({ ...free, status: "paused" }).success).toBe(false);
    expect(WorkspaceSubscription.safeParse({ ...free, planKey: "enterprise" }).success).toBe(false);
  });

  it("allows the free key to carry a non-null status (plan key is independent of status presence)", () => {
    expect(WorkspaceSubscription.safeParse({ ...free, planKey: "free", status: "expired", interval: "monthly", currentPeriodEnd: "2026-01-01T00:00:00.000Z" }).success).toBe(true);
  });

  /* #989 — the in-app notice block. Present (non-null) when the subscription
     needs the owner's attention, null otherwise. */
  it("requires the notice field to be PRESENT (nullable, not optional)", () => {
    const { notice: _drop, ...withoutNotice } = free as typeof free & { notice: unknown };
    expect(WorkspaceSubscription.safeParse(withoutNotice).success).toBe(false);
  });

  it("accepts a null notice (nothing wrong)", () => {
    expect(WorkspaceSubscription.safeParse({ ...free, notice: null }).success).toBe(true);
  });

  it("accepts a payment_failed notice with a revertsAt instant", () => {
    const parsed = WorkspaceSubscription.safeParse({
      ...free,
      planKey: "pro",
      status: "halted",
      interval: "monthly",
      currentPeriodEnd: "2026-02-01T00:00:00.000Z",
      notice: { kind: "payment_failed", revertsAt: "2026-02-08T00:00:00.000Z" },
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts a cancellation_scheduled notice", () => {
    expect(
      WorkspaceSubscription.safeParse({
        ...free,
        planKey: "team",
        status: "active",
        interval: "yearly",
        currentPeriodEnd: "2026-06-01T00:00:00.000Z",
        cancelAtPeriodEnd: true,
        notice: { kind: "cancellation_scheduled", revertsAt: "2026-06-01T00:00:00.000Z" },
      }).success,
    ).toBe(true);
  });

  it("allows a null revertsAt inside a notice but requires the kind", () => {
    expect(WorkspaceSubscription.safeParse({ ...free, notice: { kind: "payment_failed", revertsAt: null } }).success).toBe(true);
    expect(WorkspaceSubscription.safeParse({ ...free, notice: { revertsAt: null } }).success).toBe(false);
  });

  it("rejects an unknown notice kind", () => {
    expect(WorkspaceSubscription.safeParse({ ...free, notice: { kind: "upgraded", revertsAt: null } }).success).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import {
  BILLING_INTERVALS,
  BillingInvoice,
  BillingInvoiceList,
  CancelSubscriptionInput,
  ChangePlanInput,
  CheckoutSession,
  INVOICE_STATUSES,
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
  };

  it("accepts a well-formed session", () => {
    expect(CheckoutSession.safeParse(valid).success).toBe(true);
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
});

/* #988 — the owner billing surface shapes. */

describe("INVOICE_STATUSES", () => {
  it("is the five provider states we show, in order", () => {
    expect(INVOICE_STATUSES).toEqual(["paid", "issued", "partially_paid", "cancelled", "expired"]);
  });
});

describe("BillingInvoice", () => {
  const valid = {
    id: "inv_000",
    number: "INV-0001",
    status: "paid" as const,
    amount: 99900,
    currency: "INR",
    createdAt: "2026-11-01T00:00:00.000Z",
    pdfUrl: "https://rzp.example/invoices/inv_000.pdf",
  };

  it("accepts a well-formed invoice", () => {
    expect(BillingInvoice.safeParse(valid).success).toBe(true);
  });

  it("accepts a null number and a null pdfUrl (not yet attached)", () => {
    expect(BillingInvoice.safeParse({ ...valid, number: null, pdfUrl: null }).success).toBe(true);
  });

  it("requires number and pdfUrl to be PRESENT (nullable, not optional)", () => {
    expect(BillingInvoice.safeParse({ ...valid, number: undefined }).success).toBe(false);
    expect(BillingInvoice.safeParse({ ...valid, pdfUrl: undefined }).success).toBe(false);
  });

  it("rejects an unknown status", () => {
    expect(BillingInvoice.safeParse({ ...valid, status: "refunded" }).success).toBe(false);
  });

  it("rejects a negative or fractional amount", () => {
    expect(BillingInvoice.safeParse({ ...valid, amount: -1 }).success).toBe(false);
    expect(BillingInvoice.safeParse({ ...valid, amount: 99.5 }).success).toBe(false);
  });

  it("accepts a zero amount (a fully-discounted invoice)", () => {
    expect(BillingInvoice.safeParse({ ...valid, amount: 0 }).success).toBe(true);
  });

  it("requires currency to be exactly three characters", () => {
    expect(BillingInvoice.safeParse({ ...valid, currency: "INRR" }).success).toBe(false);
    expect(BillingInvoice.safeParse({ ...valid, currency: "IN" }).success).toBe(false);
  });

  it("rejects a non-URL pdfUrl", () => {
    expect(BillingInvoice.safeParse({ ...valid, pdfUrl: "not-a-url" }).success).toBe(false);
  });

  it("BillingInvoiceList accepts an array and rejects a bad element", () => {
    expect(BillingInvoiceList.safeParse([valid, { ...valid, id: "inv_001" }]).success).toBe(true);
    expect(BillingInvoiceList.safeParse([valid, { ...valid, amount: -5 }]).success).toBe(false);
    expect(BillingInvoiceList.safeParse([]).success).toBe(true);
  });
});

describe("ChangePlanInput", () => {
  it("accepts each paid plan key with each interval", () => {
    for (const planKey of PAID_PLAN_KEYS) {
      for (const interval of BILLING_INTERVALS) {
        expect(ChangePlanInput.safeParse({ planKey, interval }).success).toBe(true);
      }
    }
  });

  it("rejects the free plan and an unknown interval", () => {
    expect(ChangePlanInput.safeParse({ planKey: "free", interval: "monthly" }).success).toBe(false);
    expect(ChangePlanInput.safeParse({ planKey: "pro", interval: "weekly" }).success).toBe(false);
  });

  it("requires both fields", () => {
    expect(ChangePlanInput.safeParse({ planKey: "pro" }).success).toBe(false);
    expect(ChangePlanInput.safeParse({ interval: "monthly" }).success).toBe(false);
  });
});

describe("CancelSubscriptionInput", () => {
  it("defaults atPeriodEnd to true when omitted", () => {
    const parsed = CancelSubscriptionInput.safeParse({});
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.atPeriodEnd).toBe(true);
  });

  it("accepts an explicit false", () => {
    const parsed = CancelSubscriptionInput.safeParse({ atPeriodEnd: false });
    expect(parsed.success && parsed.data.atPeriodEnd).toBe(false);
  });

  it("rejects a non-boolean atPeriodEnd", () => {
    expect(CancelSubscriptionInput.safeParse({ atPeriodEnd: "yes" }).success).toBe(false);
  });
});

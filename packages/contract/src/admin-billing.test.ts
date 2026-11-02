import { describe, expect, it } from "vitest";
import {
  AdminBillingEventRow,
  AdminRefundInput,
  AdminRefundResult,
  AdminRevenue,
  AdminSubscriptionList,
  AdminSubscriptionRow,
  AdminWorkspaceBillingEvents,
} from "./admin-billing.js";

/* #989 — admin-billing.ts carries the admin billing-view wire shapes and the
   one admin write (refund). These tests pin the load-bearing logic: the closed
   enums re-used from billing.ts, the nullable-but-present period fields, the
   required+trimmed refund reason, and the literal refund-result status. They
   are also the mutation-coverage guard for this contract file (the required
   domain+contract mutation job breaks below 95%). */

const uuid = "00000000-0000-7000-8000-000000000001";

describe("AdminSubscriptionRow", () => {
  const row = {
    workspaceId: uuid,
    workspaceName: "Acme",
    planKey: "pro" as const,
    interval: "monthly" as const,
    status: "active" as const,
    currentPeriodEnd: "2026-02-01T00:00:00.000Z",
    cancelAtPeriodEnd: null,
    graceEndsAt: null,
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  it("accepts a well-formed active row", () => {
    expect(AdminSubscriptionRow.safeParse(row).success).toBe(true);
  });

  it("requires workspaceId to be a uuid", () => {
    expect(AdminSubscriptionRow.safeParse({ ...row, workspaceId: "nope" }).success).toBe(false);
  });

  it("rejects an unknown plan key and an unknown status", () => {
    expect(AdminSubscriptionRow.safeParse({ ...row, planKey: "enterprise" }).success).toBe(false);
    expect(AdminSubscriptionRow.safeParse({ ...row, status: "paused" }).success).toBe(false);
  });

  it("requires status to be present (a row always has a lifecycle)", () => {
    expect(AdminSubscriptionRow.safeParse({ ...row, status: null }).success).toBe(false);
    expect(AdminSubscriptionRow.safeParse({ ...row, status: undefined }).success).toBe(false);
  });

  it("allows null interval/currentPeriodEnd/cancelAtPeriodEnd/graceEndsAt but requires them present", () => {
    expect(AdminSubscriptionRow.safeParse({ ...row, interval: null, currentPeriodEnd: null }).success).toBe(true);
    expect(AdminSubscriptionRow.safeParse({ ...row, graceEndsAt: "2026-02-08T00:00:00.000Z" }).success).toBe(true);
    const { graceEndsAt: _g, ...withoutGrace } = row;
    expect(AdminSubscriptionRow.safeParse(withoutGrace).success).toBe(false);
  });
});

describe("AdminSubscriptionList", () => {
  it("accepts an empty list and a populated one", () => {
    expect(AdminSubscriptionList.safeParse({ subscriptions: [] }).success).toBe(true);
  });

  it("rejects a row that is not a valid subscription", () => {
    expect(AdminSubscriptionList.safeParse({ subscriptions: [{ workspaceId: "x" }] }).success).toBe(false);
  });
});

describe("AdminRevenue", () => {
  const rev = {
    mrr: "120000",
    currency: "INR",
    mrrUnpricedSubscriptions: 0,
    activeSubscriptions: 3,
    activeByPlan: [{ label: "pro", value: 2 }, { label: "team", value: 1 }],
    churnedInWindow: 1,
    churnRate: 0.25,
    failedPaymentsInWindow: 2,
    inGrace: 1,
  };

  it("accepts a well-formed revenue headline", () => {
    expect(AdminRevenue.safeParse(rev).success).toBe(true);
  });

  it("keeps mrr as a string (minor units, never a float)", () => {
    expect(AdminRevenue.safeParse({ ...rev, mrr: 120000 }).success).toBe(false);
  });

  it("allows a null currency and a null churnRate", () => {
    expect(AdminRevenue.safeParse({ ...rev, currency: null, churnRate: null }).success).toBe(true);
  });

  it("requires the integer counts to be integers", () => {
    expect(AdminRevenue.safeParse({ ...rev, activeSubscriptions: 3.5 }).success).toBe(false);
    expect(AdminRevenue.safeParse({ ...rev, failedPaymentsInWindow: "2" }).success).toBe(false);
    expect(AdminRevenue.safeParse({ ...rev, inGrace: -0.5 }).success).toBe(false);
  });

  it("requires churnRate to be present (nullable, not optional)", () => {
    const { churnRate: _c, ...withoutRate } = rev;
    expect(AdminRevenue.safeParse(withoutRate).success).toBe(false);
  });
});

describe("AdminBillingEventRow and AdminWorkspaceBillingEvents", () => {
  const ev = {
    id: uuid,
    provider: "razorpay",
    providerEventId: "evt_1",
    eventType: "subscription.charged",
    receivedAt: "2026-01-01T00:00:00.000Z",
    processedAt: "2026-01-01T00:00:01.000Z",
  };

  it("accepts a well-formed event row", () => {
    expect(AdminBillingEventRow.safeParse(ev).success).toBe(true);
  });

  it("allows a null processedAt (unprocessed) but requires it present", () => {
    expect(AdminBillingEventRow.safeParse({ ...ev, processedAt: null }).success).toBe(true);
    const { processedAt: _p, ...withoutProcessed } = ev;
    expect(AdminBillingEventRow.safeParse(withoutProcessed).success).toBe(false);
  });

  it("wraps rows under a workspaceId", () => {
    expect(AdminWorkspaceBillingEvents.safeParse({ workspaceId: uuid, events: [ev] }).success).toBe(true);
    expect(AdminWorkspaceBillingEvents.safeParse({ workspaceId: "x", events: [] }).success).toBe(false);
  });
});

describe("AdminRefundInput", () => {
  it("accepts a refund with a reason", () => {
    expect(AdminRefundInput.safeParse({ reason: "duplicate charge" }).success).toBe(true);
  });

  it("rejects an empty or whitespace-only reason", () => {
    expect(AdminRefundInput.safeParse({ reason: "" }).success).toBe(false);
    expect(AdminRefundInput.safeParse({ reason: "   " }).success).toBe(false);
  });

  it("requires the reason field", () => {
    expect(AdminRefundInput.safeParse({}).success).toBe(false);
  });

  it("trims the reason", () => {
    const parsed = AdminRefundInput.parse({ reason: "  oops  " });
    expect(parsed.reason).toBe("oops");
  });

  it("rejects a reason over 500 chars", () => {
    expect(AdminRefundInput.safeParse({ reason: "x".repeat(501) }).success).toBe(false);
  });

  it("is strict — an unknown key is rejected, not ignored", () => {
    expect(AdminRefundInput.safeParse({ reason: "ok", amount: 100 }).success).toBe(false);
  });
});

describe("AdminRefundResult", () => {
  it("accepts a refunded result", () => {
    expect(
      AdminRefundResult.safeParse({ paymentId: uuid, providerPaymentId: "pay_1", status: "refunded" }).success,
    ).toBe(true);
  });

  it("requires status to be the literal refunded", () => {
    expect(AdminRefundResult.safeParse({ paymentId: uuid, providerPaymentId: "pay_1", status: "captured" }).success).toBe(false);
  });
});

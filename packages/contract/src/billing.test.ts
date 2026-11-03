import { describe, expect, it } from "vitest";
import {
  BILLING_INTERVALS,
  BILLING_PROVIDER_ERROR_KINDS,
  BILLING_PROVIDER_ERROR_REASONS,
  BillingInvoice,
  BillingInvoiceList,
  BillingProviderErrorBody,
  CancelSubscriptionInput,
  ChangePlanInput,
  CheckoutSession,
  defaultMessageForProviderErrorKind,
  httpStatusForProviderError,
  INVOICE_STATUSES,
  PAID_PLAN_KEYS,
  PLAN_KEYS,
  reasonForProviderErrorKind,
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

  it("#992 — accepts an optional coupon code, trimmed and length-capped", () => {
    expect(StartCheckoutInput.safeParse({ planKey: "pro", interval: "monthly", couponCode: "WELCOME10" }).success).toBe(true);
    // Trimmed to a non-empty value.
    const r = StartCheckoutInput.safeParse({ planKey: "pro", interval: "monthly", couponCode: "  SAVE  " });
    expect(r.success && r.data.couponCode).toBe("SAVE");
    // An all-whitespace code trims to empty and is rejected (min 1).
    expect(StartCheckoutInput.safeParse({ planKey: "pro", interval: "monthly", couponCode: "   " }).success).toBe(false);
    // Over the 40-char cap.
    expect(StartCheckoutInput.safeParse({ planKey: "pro", interval: "monthly", couponCode: "x".repeat(41) }).success).toBe(false);
    // Absent is fine (optional).
    expect(StartCheckoutInput.safeParse({ planKey: "pro", interval: "monthly" }).success).toBe(true);
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

  it("#992 — coupon defaults to null and, when present, needs a code + non-negative discount", () => {
    // Absent coupon defaults to null.
    const r = CheckoutSession.safeParse(valid);
    expect(r.success && r.data.coupon).toBe(null);
    // A well-formed applied coupon.
    expect(CheckoutSession.safeParse({ ...valid, coupon: { code: "SAVE", discountMinor: 5000 } }).success).toBe(true);
    // Explicit null is accepted.
    expect(CheckoutSession.safeParse({ ...valid, coupon: null }).success).toBe(true);
    // A negative discount is rejected.
    expect(CheckoutSession.safeParse({ ...valid, coupon: { code: "SAVE", discountMinor: -1 } }).success).toBe(false);
    // A coupon missing its code is rejected.
    expect(CheckoutSession.safeParse({ ...valid, coupon: { discountMinor: 1 } }).success).toBe(false);
  });

  it("#992 — trialEndsAt defaults to null and, when present, must be an ISO datetime", () => {
    const r = CheckoutSession.safeParse(valid);
    expect(r.success && r.data.trialEndsAt).toBe(null);
    expect(CheckoutSession.safeParse({ ...valid, trialEndsAt: "2026-12-01T00:00:00.000Z" }).success).toBe(true);
    expect(CheckoutSession.safeParse({ ...valid, trialEndsAt: null }).success).toBe(true);
    expect(CheckoutSession.safeParse({ ...valid, trialEndsAt: "not-a-date" }).success).toBe(false);
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
    pendingChange: null,
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
      pendingChange: null,
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

  /* #988 — pendingChange: a requested-but-unconfirmed paid-plan change. */
  it("requires pendingChange to be PRESENT (nullable, not optional)", () => {
    const { pendingChange: _drop, ...withoutPending } = free as typeof free & { pendingChange: unknown };
    expect(WorkspaceSubscription.safeParse(withoutPending).success).toBe(false);
  });

  it("accepts a null pendingChange (no change in flight)", () => {
    expect(WorkspaceSubscription.safeParse({ ...free, pendingChange: null }).success).toBe(true);
  });

  it("accepts a pendingChange naming a paid plan + interval", () => {
    expect(
      WorkspaceSubscription.safeParse({ ...free, pendingChange: { planKey: "team", interval: "yearly" } }).success,
    ).toBe(true);
  });

  it("rejects a pendingChange to the free plan or with a missing/unknown field", () => {
    expect(WorkspaceSubscription.safeParse({ ...free, pendingChange: { planKey: "free", interval: "monthly" } }).success).toBe(false);
    expect(WorkspaceSubscription.safeParse({ ...free, pendingChange: { planKey: "pro" } }).success).toBe(false);
    expect(WorkspaceSubscription.safeParse({ ...free, pendingChange: { planKey: "pro", interval: "weekly" } }).success).toBe(false);
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


/* #1023 — the provider-error kind → (reason code, HTTP status, message) mapping.
   This is the single place the "provider 4xx vs 5xx/timeout" decision becomes a
   wire status, shared by the API and its tests, so these pin every branch:
   the two kinds, both reason codes, the 409/422 choice for `rejected`, the
   always-503 for `unavailable`, and that no body/message leaks provider text.
   These are also the mutation-coverage guard for the new contract code. */
describe("#1023 billing provider-error mapping", () => {
  it("BILLING_PROVIDER_ERROR_KINDS is exactly rejected + unavailable, in order", () => {
    expect(BILLING_PROVIDER_ERROR_KINDS).toEqual(["rejected", "unavailable"]);
  });

  it("BILLING_PROVIDER_ERROR_REASONS is exactly the two stable codes, in order", () => {
    expect(BILLING_PROVIDER_ERROR_REASONS).toEqual(["provider_rejected", "provider_unavailable"]);
  });

  describe("reasonForProviderErrorKind", () => {
    it("maps rejected -> provider_rejected", () => {
      expect(reasonForProviderErrorKind("rejected")).toBe("provider_rejected");
    });
    it("maps unavailable -> provider_unavailable", () => {
      expect(reasonForProviderErrorKind("unavailable")).toBe("provider_unavailable");
    });
    it("covers every kind with a distinct reason", () => {
      const reasons = BILLING_PROVIDER_ERROR_KINDS.map(reasonForProviderErrorKind);
      expect(new Set(reasons).size).toBe(BILLING_PROVIDER_ERROR_KINDS.length);
      expect(reasons).toEqual(["provider_rejected", "provider_unavailable"]);
    });
  });

  describe("httpStatusForProviderError", () => {
    it("rejected defaults to 409", () => {
      expect(httpStatusForProviderError("rejected")).toBe(409);
    });
    it("rejected becomes 422 when that is chosen", () => {
      expect(httpStatusForProviderError("rejected", 422)).toBe(422);
    });
    it("rejected stays 409 when 409 is passed explicitly", () => {
      expect(httpStatusForProviderError("rejected", 409)).toBe(409);
    });
    it("unavailable is always 503, regardless of the rejected-status arg", () => {
      expect(httpStatusForProviderError("unavailable")).toBe(503);
      expect(httpStatusForProviderError("unavailable", 422)).toBe(503);
      expect(httpStatusForProviderError("unavailable", 409)).toBe(503);
    });
    it("never returns 500 for any kind", () => {
      for (const kind of BILLING_PROVIDER_ERROR_KINDS) {
        for (const rejected of [409, 422] as const) {
          expect(httpStatusForProviderError(kind, rejected)).not.toBe(500);
        }
      }
    });
  });

  describe("defaultMessageForProviderErrorKind", () => {
    it("rejected explains a subscription-state problem, not a transient fault", () => {
      const msg = defaultMessageForProviderErrorKind("rejected");
      expect(msg).toMatch(/current state/i);
      expect(msg).not.toMatch(/try again/i);
    });
    it("unavailable says nothing was changed", () => {
      const msg = defaultMessageForProviderErrorKind("unavailable");
      expect(msg).toMatch(/unavailable/i);
      expect(msg).toMatch(/nothing was changed/i);
    });
    it("the two kinds give different messages", () => {
      expect(defaultMessageForProviderErrorKind("rejected")).not.toBe(
        defaultMessageForProviderErrorKind("unavailable"),
      );
    });
  });

  describe("BillingProviderErrorBody", () => {
    it("accepts a well-formed rejected body (409 + provider_rejected)", () => {
      const body = {
        statusCode: 409,
        error: "Conflict",
        message: defaultMessageForProviderErrorKind("rejected"),
        reason: "provider_rejected" as const,
      };
      expect(BillingProviderErrorBody.parse(body)).toEqual(body);
    });

    it("accepts a 422 rejected body and a 503 unavailable body", () => {
      expect(
        BillingProviderErrorBody.safeParse({
          statusCode: 422,
          error: "Unprocessable Entity",
          message: "nope",
          reason: "provider_rejected",
        }).success,
      ).toBe(true);
      expect(
        BillingProviderErrorBody.safeParse({
          statusCode: 503,
          error: "Service Unavailable",
          message: defaultMessageForProviderErrorKind("unavailable"),
          reason: "provider_unavailable",
        }).success,
      ).toBe(true);
    });

    it("rejects a 500 status (the bug this issue fixes must not be representable)", () => {
      expect(
        BillingProviderErrorBody.safeParse({
          statusCode: 500,
          error: "Internal Server Error",
          message: "The API is having trouble. Try again in a moment.",
          reason: "provider_unavailable",
        }).success,
      ).toBe(false);
    });

    it("rejects an unknown reason code", () => {
      expect(
        BillingProviderErrorBody.safeParse({
          statusCode: 503,
          error: "Service Unavailable",
          message: "x",
          reason: "something_else",
        }).success,
      ).toBe(false);
    });
  });
});

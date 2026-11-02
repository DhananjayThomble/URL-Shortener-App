import { describe, expect, it } from "vitest";
import type { SubscriptionStatus } from "@snapurl/contract";
import {
  GRACE_PERIOD_DAYS,
  graceEndFrom,
  isEntitled,
  isFailedPaymentStatus,
  noticeFor,
  type LifecycleSubscription,
} from "./billing-lifecycle.js";

/* #989 — the lifecycle rules, as pure functions. Oracles are the issue's lines:
   failed payment → 7-day grace → free; cancel → paid until period end → free;
   data kept throughout (this layer never deletes — it only reports entitlement).
   No DB and no real clock: `now` is injected into every call. */

const NOW = new Date("2026-03-01T00:00:00.000Z");
const future = (ms: number) => new Date(NOW.getTime() + ms);
const DAY = 24 * 60 * 60 * 1000;

function sub(partial: Partial<LifecycleSubscription> & { status: SubscriptionStatus }): LifecycleSubscription {
  return { currentPeriodEnd: null, cancelAtPeriodEnd: null, graceEndsAt: null, ...partial };
}

describe("isFailedPaymentStatus", () => {
  it("is true for past_due and halted only", () => {
    expect(isFailedPaymentStatus("past_due")).toBe(true);
    expect(isFailedPaymentStatus("halted")).toBe(true);
    expect(isFailedPaymentStatus("active")).toBe(false);
    expect(isFailedPaymentStatus("cancelled")).toBe(false);
    expect(isFailedPaymentStatus("expired")).toBe(false);
  });
});

describe("graceEndFrom", () => {
  it("is exactly GRACE_PERIOD_DAYS (7) days after the failure instant", () => {
    expect(GRACE_PERIOD_DAYS).toBe(7);
    expect(graceEndFrom(NOW).toISOString()).toBe(future(7 * DAY).toISOString());
  });
});

describe("isEntitled — healthy", () => {
  it("active and trialing are entitled regardless of dates", () => {
    expect(isEntitled(sub({ status: "active" }), NOW)).toBe(true);
    expect(isEntitled(sub({ status: "trialing" }), NOW)).toBe(true);
  });

  it("created / authenticated / completed / expired are NOT entitled", () => {
    for (const status of ["created", "authenticated", "completed", "expired"] as const) {
      expect(isEntitled(sub({ status }), NOW)).toBe(false);
    }
  });
});

describe("isEntitled — failed payment (grace window)", () => {
  it("is entitled while graceEndsAt is in the future", () => {
    expect(isEntitled(sub({ status: "halted", graceEndsAt: future(3 * DAY) }), NOW)).toBe(true);
    expect(isEntitled(sub({ status: "past_due", graceEndsAt: future(1) }), NOW)).toBe(true);
  });

  it("is NOT entitled once graceEndsAt has passed", () => {
    expect(isEntitled(sub({ status: "halted", graceEndsAt: future(-1) }), NOW)).toBe(false);
    expect(isEntitled(sub({ status: "halted", graceEndsAt: NOW }), NOW)).toBe(false); // boundary: strictly future
  });

  it("is NOT entitled with no grace window set (fails closed)", () => {
    expect(isEntitled(sub({ status: "halted", graceEndsAt: null }), NOW)).toBe(false);
  });
});

describe("isEntitled — cancellation (paid until period end)", () => {
  it("is entitled until currentPeriodEnd, then not", () => {
    expect(isEntitled(sub({ status: "cancelled", currentPeriodEnd: future(5 * DAY) }), NOW)).toBe(true);
    expect(isEntitled(sub({ status: "cancelled", currentPeriodEnd: future(-DAY) }), NOW)).toBe(false);
  });

  it("is NOT entitled when a cancelled sub has no period end", () => {
    expect(isEntitled(sub({ status: "cancelled", currentPeriodEnd: null }), NOW)).toBe(false);
  });
});

describe("noticeFor", () => {
  it("is null for a healthy sub with no pending cancellation", () => {
    expect(noticeFor(sub({ status: "active" }), NOW)).toBeNull();
  });

  it("raises payment_failed while in grace, with graceEndsAt as revertsAt", () => {
    const end = future(4 * DAY);
    expect(noticeFor(sub({ status: "halted", graceEndsAt: end }), NOW)).toEqual({
      kind: "payment_failed",
      revertsAt: end,
    });
  });

  it("raises cancellation_scheduled for a cancelled sub still within its period", () => {
    const end = future(10 * DAY);
    expect(noticeFor(sub({ status: "cancelled", currentPeriodEnd: end }), NOW)).toEqual({
      kind: "cancellation_scheduled",
      revertsAt: end,
    });
  });

  it("raises cancellation_scheduled for an active sub with cancelAtPeriodEnd set", () => {
    const end = future(20 * DAY);
    expect(noticeFor(sub({ status: "active", cancelAtPeriodEnd: end }), NOW)).toEqual({
      kind: "cancellation_scheduled",
      revertsAt: end,
    });
  });

  it("is null once the sub has lapsed (grace passed) — it is simply free, no banner", () => {
    expect(noticeFor(sub({ status: "halted", graceEndsAt: future(-DAY) }), NOW)).toBeNull();
    expect(noticeFor(sub({ status: "expired" }), NOW)).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import {
  AdminPlanChangeInput,
  AdminPlanChangeResult,
  PLAN_HISTORY_KIND_LABELS,
  PLAN_HISTORY_KINDS,
  PlanHistoryEntry,
  PlanHistoryKind,
} from "./plan-management.js";

function base(over: Record<string, unknown> = {}) {
  return {
    toPlanKey: "pro",
    timing: "immediate",
    settlement: "charge",
    reason: "Customer upgraded over the phone.",
    ...over,
  };
}

describe("AdminPlanChangeInput", () => {
  it("accepts an immediate charge with a reason", () => {
    const v = AdminPlanChangeInput.parse(base());
    expect(v.toPlanKey).toBe("pro");
    expect(v.settlement).toBe("charge");
    expect(v.compEndsAt).toBeNull();
  });

  it("accepts an immediate comp with an end date", () => {
    const v = AdminPlanChangeInput.parse(
      base({ settlement: "comp", compEndsAt: "2026-12-31T00:00:00.000Z" }),
    );
    expect(v.settlement).toBe("comp");
    expect(v.compEndsAt).toBe("2026-12-31T00:00:00.000Z");
  });

  it("accepts a period-end change with no settlement", () => {
    const v = AdminPlanChangeInput.parse(base({ timing: "period_end", settlement: undefined }));
    expect(v.timing).toBe("period_end");
    expect(v.settlement).toBeUndefined();
  });

  it("rejects an immediate change with no settlement", () => {
    expect(() => AdminPlanChangeInput.parse(base({ settlement: undefined }))).toThrow(
      /charge or comp/,
    );
  });

  it("rejects a comp end date on a non-comp settlement", () => {
    expect(() =>
      AdminPlanChangeInput.parse(base({ settlement: "charge", compEndsAt: "2026-12-31T00:00:00.000Z" })),
    ).toThrow(/comp end date only applies/);
  });

  it("rejects a comp scheduled for period end", () => {
    expect(() =>
      AdminPlanChangeInput.parse(base({ timing: "period_end", settlement: "comp" })),
    ).toThrow(/takes effect immediately/);
  });

  it("rejects an empty reason", () => {
    expect(() => AdminPlanChangeInput.parse(base({ reason: "   " }))).toThrow();
  });

  it("rejects a missing plan key", () => {
    expect(() => AdminPlanChangeInput.parse(base({ toPlanKey: "" }))).toThrow();
  });
});

describe("AdminPlanChangeResult", () => {
  it("parses an applied immediate charge with a proration breakdown", () => {
    const r = AdminPlanChangeResult.parse({
      outcome: "applied",
      toPlanKey: "pro",
      timing: "immediate",
      settlement: "charge",
      effectiveAt: "2026-11-02T00:00:00.000Z",
      compEndsAt: null,
      proration: {
        amountMinor: 10000,
        oldPlanCreditMinor: 5000,
        newPlanChargeMinor: 15000,
        unusedFraction: 0.5,
        direction: "upgrade",
        currency: "INR",
      },
    });
    expect(r.outcome).toBe("applied");
    expect(r.proration?.amountMinor).toBe(10000);
  });

  it("parses a scheduled period-end change with no proration", () => {
    const r = AdminPlanChangeResult.parse({
      outcome: "scheduled",
      toPlanKey: "starter",
      timing: "period_end",
      settlement: null,
      effectiveAt: "2026-12-01T00:00:00.000Z",
      compEndsAt: null,
      proration: null,
    });
    expect(r.outcome).toBe("scheduled");
    expect(r.proration).toBeNull();
  });
});

describe("PlanHistoryEntry", () => {
  it("parses a plan-change row", () => {
    const e = PlanHistoryEntry.parse({
      id: "01",
      kind: "plan_change",
      fromPlanKey: "starter",
      toPlanKey: "pro",
      timing: "immediate",
      settlement: "charge",
      amountMinor: "10000",
      currency: "INR",
      reason: "upgrade",
      actor: "admin@example.com",
      effectiveAt: "2026-11-02T00:00:00.000Z",
      createdAt: "2026-11-02T00:00:00.000Z",
    });
    expect(e.kind).toBe("plan_change");
    expect(e.amountMinor).toBe("10000");
  });

  it("parses a no-money event with null amount", () => {
    const e = PlanHistoryEntry.parse({
      id: "02",
      kind: "trial_start",
      fromPlanKey: null,
      toPlanKey: "pro",
      timing: null,
      settlement: null,
      amountMinor: null,
      currency: null,
      reason: null,
      actor: null,
      effectiveAt: "2026-11-02T00:00:00.000Z",
      createdAt: "2026-11-02T00:00:00.000Z",
    });
    expect(e.amountMinor).toBeNull();
  });
});

describe("history kinds", () => {
  it("has a label for every kind", () => {
    for (const k of PLAN_HISTORY_KINDS) {
      expect(PLAN_HISTORY_KIND_LABELS[k]).toBeTruthy();
    }
  });

  it("rejects an unknown kind", () => {
    expect(() => PlanHistoryKind.parse("mystery")).toThrow();
  });
});

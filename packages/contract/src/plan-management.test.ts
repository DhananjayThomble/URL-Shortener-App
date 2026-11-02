import { describe, expect, it } from "vitest";
import {
  AdminPlanChangeInput,
  AdminPlanChangeResult,
  PLAN_HISTORY_KIND_LABELS,
  PLAN_HISTORY_KINDS,
  PlanHistoryEntry,
  PlanHistoryKind,
  PlanHistoryList,
} from "./plan-management.js";

function base(over: Record<string, unknown> = {}) {
  return {
    toPlanKey: "pro",
    timing: "immediate",
    reason: "Customer upgraded over the phone.",
    ...over,
  };
}

describe("AdminPlanChangeInput", () => {
  it("accepts an immediate change with no settlement (defaults to a comp)", () => {
    const v = AdminPlanChangeInput.parse(base());
    expect(v.toPlanKey).toBe("pro");
    expect(v.settlement).toBeUndefined();
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

  it('accepts "charge" as a settlement (PR-C: provider-backed change)', () => {
    const immediate = AdminPlanChangeInput.parse(base({ settlement: "charge" }));
    expect(immediate.settlement).toBe("charge");
    // A charge can also be scheduled at period end (a provider-backed
    // downgrade), unlike a comp end date.
    const scheduled = AdminPlanChangeInput.parse(base({ timing: "period_end", settlement: "charge" }));
    expect(scheduled.settlement).toBe("charge");
  });

  /** The zod error path for the first issue of a failed parse, so a test can
   *  assert WHICH field the validation blamed (not just that it threw). */
  function firstIssuePath(value: unknown): (string | number)[] {
    const r = AdminPlanChangeInput.safeParse(value);
    expect(r.success).toBe(false);
    return r.success ? [] : r.error.issues[0]!.path;
  }

  it("accepts a period-end comp with no settlement (PR-A) and a period-end charge (PR-C)", () => {
    expect(AdminPlanChangeInput.parse(base({ timing: "period_end" })).settlement).toBeUndefined();
    expect(AdminPlanChangeInput.parse(base({ timing: "period_end", settlement: "charge" })).settlement).toBe(
      "charge",
    );
  });

  it("rejects a comp end date on a period-end change, blaming compEndsAt", () => {
    expect(() =>
      AdminPlanChangeInput.parse(base({ timing: "period_end", compEndsAt: "2026-12-31T00:00:00.000Z" })),
    ).toThrow(/only applies to an immediate comp/);
    expect(firstIssuePath(base({ timing: "period_end", compEndsAt: "2026-12-31T00:00:00.000Z" }))).toEqual([
      "compEndsAt",
    ]);
  });

  it("rejects a comp end date on an immediate charge, blaming compEndsAt", () => {
    expect(() =>
      AdminPlanChangeInput.parse(base({ settlement: "charge", compEndsAt: "2026-12-31T00:00:00.000Z" })),
    ).toThrow(/only applies to an immediate comp/);
    expect(firstIssuePath(base({ settlement: "charge", compEndsAt: "2026-12-31T00:00:00.000Z" }))).toEqual([
      "compEndsAt",
    ]);
  });

  it("trims the plan key", () => {
    const v = AdminPlanChangeInput.parse(base({ toPlanKey: "  pro  " }));
    expect(v.toPlanKey).toBe("pro");
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

  it('parses a "requested" provider-backed charge (plan moves on the webhook)', () => {
    const r = AdminPlanChangeResult.parse({
      outcome: "requested",
      toPlanKey: "team",
      timing: "immediate",
      settlement: "charge",
      effectiveAt: "2026-11-02T00:00:00.000Z",
      compEndsAt: null,
      proration: {
        amountMinor: 20000,
        oldPlanCreditMinor: 5000,
        newPlanChargeMinor: 25000,
        unusedFraction: 0.5,
        direction: "upgrade",
        currency: "INR",
      },
    });
    expect(r.outcome).toBe("requested");
    expect(r.proration?.direction).toBe("upgrade");
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

describe("PlanHistoryList", () => {
  it("requires items to be an array of entries", () => {
    const ok = PlanHistoryList.parse({
      items: [
        {
          id: "1",
          kind: "payment",
          fromPlanKey: null,
          toPlanKey: null,
          timing: null,
          settlement: null,
          amountMinor: "100",
          currency: "INR",
          reason: null,
          actor: null,
          effectiveAt: "2026-11-02T00:00:00.000Z",
          createdAt: "2026-11-02T00:00:00.000Z",
        },
      ],
    });
    expect(ok.items).toHaveLength(1);
    expect(ok.items[0]!.kind).toBe("payment");
    // A non-array items, or a missing items, is rejected (proves items is part
    // of the shape, not stripped).
    expect(() => PlanHistoryList.parse({ items: "nope" })).toThrow();
    expect(() => PlanHistoryList.parse({})).toThrow();
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

import { describe, expect, it } from "vitest";
import {
  PLAN_CHANGE_SETTLEMENTS,
  PLAN_CHANGE_TIMINGS,
  PLAN_CHANGE_SETTLEMENTS as SETTLEMENTS,
  PlanChangeSettlement,
  PlanChangeTiming,
  PRORATION_DIRECTIONS,
  ProrationDirection,
  ProrationInput,
  prorate,
  prorationDirection,
  roundMinorHalfUp,
  unusedFraction,
  type ProrationInput as ProrationInputT,
} from "./proration.js";

/** A whole 30-day period in ms, with named instants inside it, so every test
 *  reads in human terms. Day 0 is the period start. */
const DAY = 24 * 60 * 60 * 1000;
const PERIOD_START = 1_700_000_000_000; // an arbitrary fixed epoch ms
const PERIOD_DAYS = 30;
const PERIOD_END = PERIOD_START + PERIOD_DAYS * DAY;

function at(dayOffset: number): number {
  return PERIOD_START + dayOffset * DAY;
}

function input(over: Partial<ProrationInputT> = {}): ProrationInputT {
  return {
    oldPeriodPriceMinor: 0,
    newPeriodPriceMinor: 0,
    periodStartMs: PERIOD_START,
    periodEndMs: PERIOD_END,
    changeAtMs: PERIOD_START,
    currency: "INR",
    ...over,
  };
}

describe("unusedFraction", () => {
  it("is 1 at the exact period start", () => {
    expect(unusedFraction(input({ changeAtMs: PERIOD_START }))).toBe(1);
  });

  it("is 0 at the exact period end", () => {
    expect(unusedFraction(input({ changeAtMs: PERIOD_END }))).toBe(0);
  });

  it("is exactly half at the period midpoint", () => {
    expect(unusedFraction(input({ changeAtMs: at(15) }))).toBe(0.5);
  });

  it("is two-thirds with ten of thirty days remaining", () => {
    // change on day 20 → 10 days remaining of 30 → 1/3 unused.
    expect(unusedFraction(input({ changeAtMs: at(20) }))).toBeCloseTo(1 / 3, 12);
  });

  it("clamps a change dated before the period start to the whole period (1)", () => {
    expect(unusedFraction(input({ changeAtMs: PERIOD_START - 5 * DAY }))).toBe(1);
  });

  it("clamps a change dated after the period end to nothing (0)", () => {
    expect(unusedFraction(input({ changeAtMs: PERIOD_END + 5 * DAY }))).toBe(0);
  });

  it("fails safe to 0 for a zero-length period", () => {
    expect(
      unusedFraction(input({ periodStartMs: PERIOD_START, periodEndMs: PERIOD_START, changeAtMs: PERIOD_START })),
    ).toBe(0);
  });

  it("fails safe to 0 for a negative-length period", () => {
    expect(
      unusedFraction(
        input({ periodStartMs: PERIOD_START, periodEndMs: PERIOD_START - DAY, changeAtMs: PERIOD_START }),
      ),
    ).toBe(0);
  });
});

describe("roundMinorHalfUp", () => {
  it("rounds a positive half up", () => {
    expect(roundMinorHalfUp(100.5)).toBe(101);
  });

  it("rounds a positive just-below-half down", () => {
    expect(roundMinorHalfUp(100.4999)).toBe(100);
  });

  it("rounds a negative half away from zero (−0.5 → −1)", () => {
    expect(roundMinorHalfUp(-0.5)).toBe(-1);
  });

  it("rounds a negative magnitude half up symmetrically (−100.5 → −101)", () => {
    expect(roundMinorHalfUp(-100.5)).toBe(-101);
  });

  it("leaves a whole number unchanged", () => {
    expect(roundMinorHalfUp(4200)).toBe(4200);
  });

  it("maps zero to zero (sign 0)", () => {
    expect(roundMinorHalfUp(0)).toBe(0);
  });
});

describe("prorationDirection", () => {
  it("is upgrade when the new price is dearer", () => {
    expect(prorationDirection(10000, 20000)).toBe("upgrade");
  });

  it("is downgrade when the new price is cheaper", () => {
    expect(prorationDirection(20000, 10000)).toBe("downgrade");
  });

  it("is same when the prices are equal", () => {
    expect(prorationDirection(15000, 15000)).toBe("same");
  });
});

describe("prorate — exact paise amounts", () => {
  it("charges the exact prorated difference on a mid-period upgrade", () => {
    // Starter ₹100/period → Pro ₹300/period, changed at the exact midpoint.
    // unused = 0.5; oldCredit = 0.5 × 10000 = 5000; newCharge = 0.5 × 30000 = 15000.
    // amount = 15000 − 5000 = 10000 paise (= ₹100).
    const r = prorate(
      input({ oldPeriodPriceMinor: 10000, newPeriodPriceMinor: 30000, changeAtMs: at(15) }),
    );
    expect(r.unusedFraction).toBe(0.5);
    expect(r.oldPlanCreditMinor).toBe(5000);
    expect(r.newPlanChargeMinor).toBe(15000);
    expect(r.amountMinor).toBe(10000);
    expect(r.direction).toBe("upgrade");
    expect(r.currency).toBe("INR");
  });

  it("produces a negative amount (credit) on a mid-period downgrade", () => {
    // Pro ₹300 → Starter ₹100 at midpoint: oldCredit 15000, newCharge 5000.
    // amount = 5000 − 15000 = −10000 paise (a ₹100 credit).
    const r = prorate(
      input({ oldPeriodPriceMinor: 30000, newPeriodPriceMinor: 10000, changeAtMs: at(15) }),
    );
    expect(r.oldPlanCreditMinor).toBe(15000);
    expect(r.newPlanChargeMinor).toBe(5000);
    expect(r.amountMinor).toBe(-10000);
    expect(r.direction).toBe("downgrade");
  });

  it("charges the full difference when the change is at the period start", () => {
    // unused = 1 at the start: full old credit and full new charge.
    const r = prorate(
      input({ oldPeriodPriceMinor: 10000, newPeriodPriceMinor: 30000, changeAtMs: PERIOD_START }),
    );
    expect(r.oldPlanCreditMinor).toBe(10000);
    expect(r.newPlanChargeMinor).toBe(30000);
    expect(r.amountMinor).toBe(20000);
  });

  it("settles nothing when the change is at the period end", () => {
    const r = prorate(
      input({ oldPeriodPriceMinor: 10000, newPeriodPriceMinor: 30000, changeAtMs: PERIOD_END }),
    );
    expect(r.oldPlanCreditMinor).toBe(0);
    expect(r.newPlanChargeMinor).toBe(0);
    expect(r.amountMinor).toBe(0);
  });

  it("rounds each line to the paise half-up and nets exactly", () => {
    // A fraction that does not divide cleanly: change on day 20 → 1/3 unused.
    // old ₹100 = 10000 paise → 10000/3 = 3333.33… → 3333.
    // new ₹300 = 30000 paise → 30000/3 = 10000 exactly.
    // amount = 10000 − 3333 = 6667 paise.
    const r = prorate(
      input({ oldPeriodPriceMinor: 10000, newPeriodPriceMinor: 30000, changeAtMs: at(20) }),
    );
    expect(r.oldPlanCreditMinor).toBe(3333);
    expect(r.newPlanChargeMinor).toBe(10000);
    expect(r.amountMinor).toBe(6667);
    // the two lines sum to the net, exactly.
    expect(r.newPlanChargeMinor - r.oldPlanCreditMinor).toBe(r.amountMinor);
  });

  it("rounds a .5 paise line up (half-up, not toward even)", () => {
    // Pick numbers so a line lands on exactly x.5: price 10001 paise at 0.5
    // unused → 5000.5 → rounds to 5001.
    const r = prorate(
      input({ oldPeriodPriceMinor: 10001, newPeriodPriceMinor: 10001, changeAtMs: at(15) }),
    );
    expect(r.oldPlanCreditMinor).toBe(5001);
    expect(r.newPlanChargeMinor).toBe(5001);
    expect(r.amountMinor).toBe(0);
    expect(r.direction).toBe("same");
  });

  it("is zero on a same-price interval change", () => {
    const r = prorate(
      input({ oldPeriodPriceMinor: 59900, newPeriodPriceMinor: 59900, changeAtMs: at(10) }),
    );
    expect(r.amountMinor).toBe(0);
    expect(r.direction).toBe("same");
  });

  it("carries USD currency through", () => {
    const r = prorate(
      input({ oldPeriodPriceMinor: 0, newPeriodPriceMinor: 1200, changeAtMs: PERIOD_START, currency: "USD" }),
    );
    expect(r.currency).toBe("USD");
    expect(r.amountMinor).toBe(1200);
  });

  it("rejects a negative price via the schema", () => {
    expect(() => prorate(input({ newPeriodPriceMinor: -1 }))).toThrow();
  });
});

describe("contract enums", () => {
  it("exposes both plan-change timings", () => {
    expect(PLAN_CHANGE_TIMINGS).toEqual(["immediate", "period_end"]);
    expect(PlanChangeTiming.parse("immediate")).toBe("immediate");
    expect(PlanChangeTiming.parse("period_end")).toBe("period_end");
    expect(() => PlanChangeTiming.parse("later")).toThrow();
  });

  it("exposes both settlements", () => {
    expect(SETTLEMENTS).toEqual(["charge", "comp"]);
    expect(PLAN_CHANGE_SETTLEMENTS).toBe(SETTLEMENTS);
    expect(PlanChangeSettlement.parse("charge")).toBe("charge");
    expect(PlanChangeSettlement.parse("comp")).toBe("comp");
    expect(() => PlanChangeSettlement.parse("free")).toThrow();
  });

  it("exposes the three proration directions", () => {
    expect(PRORATION_DIRECTIONS).toEqual(["upgrade", "downgrade", "same"]);
    expect(ProrationDirection.parse("upgrade")).toBe("upgrade");
    expect(() => ProrationDirection.parse("sidegrade")).toThrow();
  });

  it("ProrationInput requires an integer price", () => {
    expect(() => ProrationInput.parse({ ...input(), oldPeriodPriceMinor: 1.5 })).toThrow();
  });
});

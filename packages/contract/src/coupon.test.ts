import { describe, expect, it } from "vitest";
import {
  COUPON_DURATIONS,
  COUPON_KINDS,
  CouponDuration,
  CouponKind,
  CouponList,
  CouponRedemptionList,
  CouponRedemptionView,
  CouponView,
  CreateCouponInput,
  SetCouponPausedInput,
  applyDiscount,
  couponRejection,
  discountMinor,
  type RedeemableCoupon,
} from "./coupon.js";

describe("discountMinor", () => {
  it("takes a whole-percent cut, rounded half-up", () => {
    // 10% of 5900 = 590.
    expect(discountMinor("percent", 10, 5900)).toBe(590);
    // 33% of 10000 = 3300.
    expect(discountMinor("percent", 33, 10000)).toBe(3300);
    // a .5 rounds up: 50% of 10001 = 5000.5 -> 5001.
    expect(discountMinor("percent", 50, 10001)).toBe(5001);
  });

  it("takes a fixed minor-unit amount, clamped to the base", () => {
    expect(discountMinor("fixed", 2000, 5900)).toBe(2000);
    // larger than base -> clamped to base (never negative price).
    expect(discountMinor("fixed", 9999, 5900)).toBe(5900);
  });

  it("is zero on a zero or negative base", () => {
    expect(discountMinor("percent", 50, 0)).toBe(0);
    expect(discountMinor("fixed", 100, 0)).toBe(0);
    expect(discountMinor("percent", 50, -100)).toBe(0);
  });

  it("100% off zeroes the price", () => {
    expect(discountMinor("percent", 100, 5900)).toBe(5900);
  });
});

describe("applyDiscount", () => {
  it("subtracts the discount from the base", () => {
    expect(applyDiscount("percent", 10, 5900)).toBe(5310);
    expect(applyDiscount("fixed", 2000, 5900)).toBe(3900);
  });

  it("never goes below zero", () => {
    expect(applyDiscount("fixed", 9999, 5900)).toBe(0);
    expect(applyDiscount("percent", 100, 5900)).toBe(0);
  });
});

describe("couponRejection", () => {
  const base: RedeemableCoupon = {
    kind: "percent",
    duration: "once",
    durationMonths: null,
    expiresAt: null,
    maxRedemptions: null,
    pausedAt: null,
    restrictPlanKeys: null,
    restrictInterval: null,
  };
  const now = new Date("2026-06-15T12:00:00.000Z");

  it("allows an unrestricted active coupon", () => {
    expect(couponRejection(base, "pro", "monthly", 0, now)).toBeNull();
  });

  it("rejects a paused coupon first", () => {
    expect(couponRejection({ ...base, pausedAt: "2026-06-01T00:00:00.000Z" }, "pro", "monthly", 0, now)).toBe(
      "paused",
    );
  });

  it("rejects an expired coupon", () => {
    expect(couponRejection({ ...base, expiresAt: "2026-06-14T00:00:00.000Z" }, "pro", "monthly", 0, now)).toBe(
      "expired",
    );
  });

  it("treats an expiry exactly at now as expired (<=)", () => {
    expect(couponRejection({ ...base, expiresAt: now.toISOString() }, "pro", "monthly", 0, now)).toBe("expired");
  });

  it("allows an expiry in the future", () => {
    expect(couponRejection({ ...base, expiresAt: "2026-06-16T00:00:00.000Z" }, "pro", "monthly", 0, now)).toBeNull();
  });

  it("rejects when the redemption cap is reached", () => {
    expect(couponRejection({ ...base, maxRedemptions: 5 }, "pro", "monthly", 5, now)).toBe(
      "max_redemptions_reached",
    );
    // one below the cap is still allowed.
    expect(couponRejection({ ...base, maxRedemptions: 5 }, "pro", "monthly", 4, now)).toBeNull();
  });

  it("rejects a plan not in the restriction (case-insensitive) and allows one that is", () => {
    const c = { ...base, restrictPlanKeys: ["pro", "team"] };
    expect(couponRejection(c, "starter", "monthly", 0, now)).toBe("plan_not_allowed");
    expect(couponRejection(c, "PRO", "monthly", 0, now)).toBeNull();
  });

  it("rejects an interval not in the restriction", () => {
    const c = { ...base, restrictInterval: "yearly" as const };
    expect(couponRejection(c, "pro", "monthly", 0, now)).toBe("interval_not_allowed");
    expect(couponRejection(c, "pro", "yearly", 0, now)).toBeNull();
  });

  it("checks paused before expiry before cap before plan before interval", () => {
    // all failing at once: paused wins.
    const c: RedeemableCoupon = {
      ...base,
      pausedAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2026-01-01T00:00:00.000Z",
      maxRedemptions: 0,
      restrictPlanKeys: ["team"],
      restrictInterval: "yearly",
    };
    expect(couponRejection(c, "pro", "monthly", 3, now)).toBe("paused");
  });
});

describe("CreateCouponInput", () => {
  const base = { code: "SAVE10", kind: "percent", value: 10, duration: "once" };

  it("accepts a percent coupon", () => {
    const v = CreateCouponInput.parse(base);
    expect(v.code).toBe("SAVE10");
    expect(v.kind).toBe("percent");
    expect(v.durationMonths).toBeNull();
  });

  it("accepts a fixed coupon with a currency", () => {
    const v = CreateCouponInput.parse({ code: "FLAT", kind: "fixed", value: 2000, currency: "INR", duration: "forever" });
    expect(v.currency).toBe("INR");
  });

  it("accepts a repeating coupon with months", () => {
    const v = CreateCouponInput.parse({ ...base, duration: "repeating", durationMonths: 3 });
    expect(v.durationMonths).toBe(3);
  });

  it("rejects a percent over 100", () => {
    expect(() => CreateCouponInput.parse({ ...base, value: 101 })).toThrow(/at most 100/);
  });

  it("rejects a fixed coupon with no currency", () => {
    expect(() => CreateCouponInput.parse({ code: "FLAT", kind: "fixed", value: 2000, duration: "once" })).toThrow(
      /needs a currency/,
    );
  });

  it("rejects a repeating coupon with no months", () => {
    expect(() => CreateCouponInput.parse({ ...base, duration: "repeating" })).toThrow(/needs a number of months/);
  });

  it("rejects months on a non-repeating coupon", () => {
    expect(() => CreateCouponInput.parse({ ...base, duration: "once", durationMonths: 3 })).toThrow(
      /Only a repeating coupon/,
    );
  });

  it("rejects a bad code and a zero value", () => {
    expect(() => CreateCouponInput.parse({ ...base, code: "bad code!" })).toThrow();
    expect(() => CreateCouponInput.parse({ ...base, value: 0 })).toThrow();
  });

  it("accepts a percent of exactly 100 (boundary)", () => {
    expect(CreateCouponInput.parse({ ...base, value: 100 }).value).toBe(100);
  });

  it("trims the code and rejects one over 40 chars", () => {
    expect(CreateCouponInput.parse({ ...base, code: "  SAVE10  " }).code).toBe("SAVE10");
    expect(() => CreateCouponInput.parse({ ...base, code: "x".repeat(41) })).toThrow();
  });

  it("rejects durationMonths over 60 and accepts 60", () => {
    expect(CreateCouponInput.parse({ ...base, duration: "repeating", durationMonths: 60 }).durationMonths).toBe(60);
    expect(() => CreateCouponInput.parse({ ...base, duration: "repeating", durationMonths: 61 })).toThrow();
  });

  /** First zod error path, to pin which field each superRefine issue blames. */
  function firstPath(value: unknown): (string | number)[] {
    const r = CreateCouponInput.safeParse(value);
    expect(r.success).toBe(false);
    return r.success ? [] : r.error.issues[0]!.path;
  }

  it("blames the right field on each cross-field rule", () => {
    expect(firstPath({ ...base, value: 101 })).toEqual(["value"]);
    expect(firstPath({ code: "F", kind: "fixed", value: 10, duration: "once" })).toEqual(["currency"]);
    expect(firstPath({ ...base, duration: "repeating" })).toEqual(["durationMonths"]);
    expect(firstPath({ ...base, duration: "once", durationMonths: 3 })).toEqual(["durationMonths"]);
  });

  it("accepts and preserves plan/interval restrictions", () => {
    const v = CreateCouponInput.parse({ ...base, restrictPlanKeys: ["pro", "team"], restrictInterval: "yearly" });
    expect(v.restrictPlanKeys).toEqual(["pro", "team"]);
    expect(v.restrictInterval).toBe("yearly");
  });

  it("rejects an empty or over-long restrictPlanKeys member and a bad interval", () => {
    expect(() => CreateCouponInput.parse({ ...base, restrictPlanKeys: [""] })).toThrow();
    expect(() => CreateCouponInput.parse({ ...base, restrictPlanKeys: ["x".repeat(41)] })).toThrow();
    expect(() => CreateCouponInput.parse({ ...base, restrictInterval: "weekly" })).toThrow();
  });

  it("rejects a code whose FIRST character is invalid (anchored regex)", () => {
    // leading hyphen is not allowed by ^[a-z0-9]...
    expect(() => CreateCouponInput.parse({ ...base, code: "-SAVE" })).toThrow();
  });

  it("accepts maxRedemptions above 1 and rejects 0 (min 1, not max 1)", () => {
    expect(CreateCouponInput.parse({ ...base, maxRedemptions: 25 }).maxRedemptions).toBe(25);
    expect(() => CreateCouponInput.parse({ ...base, maxRedemptions: 0 })).toThrow();
  });
});

describe("CouponList / SetCouponPausedInput / redemption shapes", () => {
  const couponView = {
    id: "1", code: "C", kind: "percent", value: 10, currency: null, duration: "once",
    durationMonths: null, expiresAt: null, maxRedemptions: null, paused: false,
    restrictPlanKeys: null, restrictInterval: null, redemptions: 0, createdBy: null,
    createdAt: "2026-06-01T00:00:00.000Z",
  };

  it("CouponList carries its items array", () => {
    const v = CouponList.parse({ items: [couponView] });
    expect(v.items).toHaveLength(1);
    expect(v.items[0]!.code).toBe("C");
    expect(() => CouponList.parse({ items: "no" })).toThrow();
    expect(() => CouponList.parse({})).toThrow();
  });

  it("SetCouponPausedInput requires a boolean paused", () => {
    expect(SetCouponPausedInput.parse({ paused: true }).paused).toBe(true);
    expect(() => SetCouponPausedInput.parse({ paused: "yes" })).toThrow();
    expect(() => SetCouponPausedInput.parse({})).toThrow();
  });

  it("CouponRedemptionView parses a row and rejects a missing field", () => {
    const row = {
      id: "r1", workspaceId: "w1", workspaceName: "Acme", planKey: "pro",
      interval: "monthly", redeemedAt: "2026-06-10T00:00:00.000Z",
    };
    const v = CouponRedemptionView.parse(row);
    expect(v.workspaceName).toBe("Acme");
    expect(CouponRedemptionView.parse({ ...row, workspaceName: null }).workspaceName).toBeNull();
    expect(() => CouponRedemptionView.parse({ ...row, planKey: undefined })).toThrow();
  });

  it("CouponRedemptionList carries its items array", () => {
    const row = {
      id: "r1", workspaceId: "w1", workspaceName: null, planKey: "pro",
      interval: "monthly", redeemedAt: "2026-06-10T00:00:00.000Z",
    };
    expect(CouponRedemptionList.parse({ items: [row] }).items).toHaveLength(1);
    expect(() => CouponRedemptionList.parse({ items: [{}] })).toThrow();
  });
});

describe("CouponView + enums", () => {
  it("parses a coupon view", () => {
    const v = CouponView.parse({
      id: "1",
      code: "SAVE10",
      kind: "percent",
      value: 10,
      currency: null,
      duration: "once",
      durationMonths: null,
      expiresAt: null,
      maxRedemptions: 100,
      paused: false,
      restrictPlanKeys: null,
      restrictInterval: null,
      redemptions: 3,
      createdBy: "admin@example.com",
      createdAt: "2026-06-01T00:00:00.000Z",
    });
    expect(v.redemptions).toBe(3);
  });

  it("parses a fixed repeating coupon view with all fields populated", () => {
    const v = CouponView.parse({
      id: "2",
      code: "FLAT3",
      kind: "fixed",
      value: 2000,
      currency: "INR",
      duration: "repeating",
      durationMonths: 3,
      expiresAt: "2026-12-31T00:00:00.000Z",
      maxRedemptions: 50,
      paused: true,
      restrictPlanKeys: ["pro"],
      restrictInterval: "yearly",
      redemptions: 7,
      createdBy: null,
      createdAt: "2026-06-01T00:00:00.000Z",
    });
    expect(v.currency).toBe("INR");
    expect(v.durationMonths).toBe(3);
    expect(v.paused).toBe(true);
    expect(v.restrictPlanKeys).toEqual(["pro"]);
    expect(v.restrictInterval).toBe("yearly");
  });

  it("rejects a CouponView with a non-boolean paused, a negative redemptions, or a bad interval", () => {
    const ok = {
      id: "1", code: "C", kind: "percent", value: 10, currency: null, duration: "once",
      durationMonths: null, expiresAt: null, maxRedemptions: null, paused: false,
      restrictPlanKeys: null, restrictInterval: null, redemptions: 0, createdBy: null,
      createdAt: "2026-06-01T00:00:00.000Z",
    };
    expect(() => CouponView.parse({ ...ok, paused: "no" })).toThrow();
    expect(() => CouponView.parse({ ...ok, redemptions: -1 })).toThrow();
    expect(() => CouponView.parse({ ...ok, restrictInterval: "weekly" })).toThrow();
  });

  it("exposes the kind and duration enums", () => {
    expect(COUPON_KINDS).toEqual(["percent", "fixed"]);
    expect(COUPON_DURATIONS).toEqual(["once", "repeating", "forever"]);
    expect(CouponKind.parse("fixed")).toBe("fixed");
    expect(CouponDuration.parse("forever")).toBe("forever");
    expect(() => CouponKind.parse("bogus")).toThrow();
  });
});

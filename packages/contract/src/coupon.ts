import { z } from "zod";
import { PriceCurrency } from "./plans.js";

/* ============================================================
   #992 — coupons (billing 6/6, epic #991).

   The wire shapes + the pure discount math for coupons. A coupon is percent or
   fixed, lasts once / N months / forever, can expire, can cap total redemptions
   and can be restricted to certain plans or intervals. Admins create, pause and
   see redemptions.

   The DISCOUNT is applied by the billing provider (the money math lives with the
   provider, same rule as prices): SnapURL validates a coupon against its own
   rules and records the redemption, then passes the coupon's provider offer id
   to the provider. `applyDiscount` here is the pure, exact-minor-unit preview
   the UI shows and a test pins — it never replaces the provider's charge.
   ============================================================ */

/** Percent-off or a fixed minor-unit amount off. */
export const COUPON_KINDS = ["percent", "fixed"] as const;
export const CouponKind = z.enum(COUPON_KINDS);
export type CouponKind = (typeof COUPON_KINDS)[number];

/** How long the discount lasts once redeemed. */
export const COUPON_DURATIONS = ["once", "repeating", "forever"] as const;
export const CouponDuration = z.enum(COUPON_DURATIONS);
export type CouponDuration = (typeof COUPON_DURATIONS)[number];

/* ── Pure discount math ─────────────────────────────────────

   All in the currency's MINOR unit (paise/cents) as integers — no float. The
   preview the UI shows and the amount a test asserts. A percent coupon rounds
   the discount HALF-UP to a whole minor unit; a fixed coupon is clamped so the
   price never goes below zero. */

/** Round half-up on magnitude (−0.5 → −1), the same rule the proration engine
 *  uses, so a discount and a credit round consistently. */
function roundHalfUp(amount: number): number {
  return Math.sign(amount) * Math.round(Math.abs(amount));
}

/**
 * The minor-unit discount a coupon takes off a base price, clamped to [0, base]
 * so a fixed coupon larger than the price only ever zeroes it (never negative).
 * A percent coupon is `round(base × percent / 100)`. A fixed coupon is its
 * value, clamped. `kind`/`value` are the coupon's; `baseMinor` is the price the
 * discount applies to.
 */
export function discountMinor(kind: CouponKind, value: number, baseMinor: number): number {
  const raw = kind === "percent" ? roundHalfUp((baseMinor * value) / 100) : value;
  // Clamp to [0, baseMinor]: a fixed coupon larger than the price only zeroes it,
  // and a non-positive base yields 0 (min with a non-positive base, floored at 0).
  return Math.max(0, Math.min(raw, baseMinor));
}

/** The price a customer pays after a coupon: base minus the clamped discount,
 *  never below zero. */
export function applyDiscount(kind: CouponKind, value: number, baseMinor: number): number {
  return baseMinor - discountMinor(kind, value, baseMinor);
}

/* ── Redeemability ──────────────────────────────────────────

   Whether a coupon may be redeemed RIGHT NOW for a (plan, interval), given its
   rules and the live redemption count. Pure: the caller passes the facts (now,
   count) so the clock and the DB read live in the service. */

/** The facts a redeemability check needs about a coupon. */
export interface RedeemableCoupon {
  kind: CouponKind;
  duration: CouponDuration;
  durationMonths: number | null;
  expiresAt: string | null;
  maxRedemptions: number | null;
  pausedAt: string | null;
  restrictPlanKeys: string[] | null;
  restrictInterval: "monthly" | "yearly" | null;
}

/** Why a coupon cannot be redeemed, or null when it can. A named reason so the
 *  API returns a specific message and a test pins each branch. */
export type CouponRejection =
  | "paused"
  | "expired"
  | "max_redemptions_reached"
  | "plan_not_allowed"
  | "interval_not_allowed";

/**
 * Whether `coupon` can be redeemed for (planKey, interval) at `now` given how
 * many times it has already been redeemed (`redemptionCount`). Returns null when
 * redeemable, else the first failing reason. Checked in a fixed order so the
 * message is deterministic: paused, expired, cap, plan, interval.
 */
export function couponRejection(
  coupon: RedeemableCoupon,
  planKey: string,
  interval: "monthly" | "yearly",
  redemptionCount: number,
  now: Date,
): CouponRejection | null {
  if (coupon.pausedAt !== null) return "paused";
  if (coupon.expiresAt !== null && new Date(coupon.expiresAt).getTime() <= now.getTime()) return "expired";
  if (coupon.maxRedemptions !== null && redemptionCount >= coupon.maxRedemptions) {
    return "max_redemptions_reached";
  }
  if (coupon.restrictPlanKeys !== null && !coupon.restrictPlanKeys.includes(planKey.toLowerCase())) {
    return "plan_not_allowed";
  }
  if (coupon.restrictInterval !== null && coupon.restrictInterval !== interval) {
    return "interval_not_allowed";
  }
  return null;
}

/* ── Admin wire shapes ──────────────────────────────────────── */

/** Create a coupon. `value` is a whole percent (1..100) for a percent coupon or
 *  a minor-unit amount (>= 1) for a fixed one; the service validates value and
 *  currency by kind. `repeating` requires durationMonths; once/forever forbid
 *  it. Restrictions and caps are optional. */
export const CreateCouponInput = z
  .object({
    code: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .regex(/^[a-z0-9][a-z0-9_-]*$/i, "A coupon code is letters, digits, hyphens and underscores."),
    kind: CouponKind,
    value: z.number().int().min(1),
    currency: PriceCurrency.optional(),
    duration: CouponDuration,
    durationMonths: z.number().int().min(1).max(60).nullable().default(null),
    expiresAt: z.string().datetime().nullable().default(null),
    maxRedemptions: z.number().int().min(1).nullable().default(null),
    restrictPlanKeys: z.array(z.string().trim().min(1).max(40)).nullable().default(null),
    restrictInterval: z.enum(["monthly", "yearly"]).nullable().default(null),
  })
  .superRefine((v, ctx) => {
    if (v.kind === "percent" && v.value > 100) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["value"], message: "A percent coupon is at most 100." });
    }
    if (v.kind === "fixed" && v.currency === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["currency"], message: "A fixed coupon needs a currency." });
    }
    if (v.duration === "repeating" && v.durationMonths === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["durationMonths"],
        message: "A repeating coupon needs a number of months.",
      });
    }
    if (v.duration !== "repeating" && v.durationMonths !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["durationMonths"],
        message: "Only a repeating coupon has a number of months.",
      });
    }
  });
export type CreateCouponInput = z.infer<typeof CreateCouponInput>;

/** A coupon as the admin grid reads it, with its live redemption count. */
export const CouponView = z.object({
  id: z.string(),
  code: z.string(),
  kind: CouponKind,
  value: z.number().int(),
  currency: z.string().nullable(),
  duration: CouponDuration,
  durationMonths: z.number().int().nullable(),
  expiresAt: z.string().nullable(),
  maxRedemptions: z.number().int().nullable(),
  /** True when paused (paused_at set). */
  paused: z.boolean(),
  restrictPlanKeys: z.array(z.string()).nullable(),
  restrictInterval: z.enum(["monthly", "yearly"]).nullable(),
  /** Live count of coupon_redemptions rows. */
  redemptions: z.number().int().min(0),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
});
export type CouponView = z.infer<typeof CouponView>;

export const CouponList = z.object({ items: z.array(CouponView) });
export type CouponList = z.infer<typeof CouponList>;

/** Pause or resume a coupon. */
export const SetCouponPausedInput = z.object({ paused: z.boolean() });
export type SetCouponPausedInput = z.infer<typeof SetCouponPausedInput>;

/** One redemption row in the admin "see redemptions" view. */
export const CouponRedemptionView = z.object({
  id: z.string(),
  workspaceId: z.string(),
  workspaceName: z.string().nullable(),
  planKey: z.string(),
  interval: z.string(),
  redeemedAt: z.string(),
});
export type CouponRedemptionView = z.infer<typeof CouponRedemptionView>;

export const CouponRedemptionList = z.object({ items: z.array(CouponRedemptionView) });
export type CouponRedemptionList = z.infer<typeof CouponRedemptionList>;

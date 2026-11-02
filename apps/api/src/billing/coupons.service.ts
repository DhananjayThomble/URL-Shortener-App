import { BadRequestException, ConflictException, Inject, Injectable } from "@nestjs/common";
import {
  coupons,
  couponRedemptions,
  count,
  eq,
  isUniqueViolation,
  sql,
  type Database,
} from "@snapurl/database";
import {
  couponRejection,
  discountMinor,
  type CouponKind,
  type CouponRejection,
  type RedeemableCoupon,
} from "@snapurl/contract";
import type { BillingInterval } from "@snapurl/contract";
import { DB } from "../database/database.module.js";

/* ============================================================
   #992 — coupons at checkout.

   A customer enters a code at checkout. This service is the ONLY place a coupon
   is validated and a redemption is recorded; the money side (the actual
   discount) is applied by the billing provider via the coupon's provider offer
   id, exactly as prices live with the provider. A coupon never grants a plan on
   its own — the plan still becomes entitled only on the verified webhook.

   Two guarantees the issue's acceptance turns on:
   - A coupon respects expiry, max redemptions and plan/interval restrictions.
     Those checks are the pure `couponRejection` from the contract, fed the live
     redemption count and the clock here.
   - One redemption per workspace, exactly. The coupon_redemptions table has a
     UNIQUE index on (coupon_id, workspace_id); recordRedemption inserts and
     treats the unique violation as "already redeemed", so two concurrent
     checkouts for the same (coupon, workspace) can never both succeed — the DB,
     not a read-then-write, is the arbiter.
   ============================================================ */

/** A coupon resolved for checkout: its id + provider offer (what the provider
 *  needs) and the discount preview the confirmation screen shows. */
export interface ResolvedCoupon {
  couponId: string;
  code: string;
  /** The coupon's provider offer id, or null when it has none (the provider
   *  then applies no discount, which the admin sees). */
  providerOfferId: string | null;
  /** The minor-unit discount off the given base price, for the preview only —
   *  the provider applies the real discount. */
  discountMinor: number;
}

/** Why a coupon could not be applied: either it does not exist, or one of the
 *  pure rejection reasons. Carried so the controller returns a specific message
 *  and a test pins each branch. */
export type CouponApplyError = "not_found" | CouponRejection;

/** Raised when a coupon code cannot be applied at checkout. Maps to a 400: the
 *  customer named a code that does not exist or cannot be used right now. */
export class CouponNotApplicableError extends BadRequestException {
  constructor(readonly code: string, readonly reason: CouponApplyError) {
    super(messageFor(reason));
    this.name = "CouponNotApplicableError";
  }
}

/** A customer-facing message per rejection reason. Deterministic so the UI and
 *  a test read the same text. */
function messageFor(reason: CouponApplyError): string {
  switch (reason) {
    case "not_found":
      return "That coupon code is not valid.";
    case "paused":
      return "That coupon is not currently available.";
    case "expired":
      return "That coupon has expired.";
    case "max_redemptions_reached":
      return "That coupon has reached its redemption limit.";
    case "plan_not_allowed":
      return "That coupon does not apply to this plan.";
    case "interval_not_allowed":
      return "That coupon does not apply to this billing interval.";
  }
}

/** The stored coupon row, as drizzle returns it. */
type CouponRow = typeof coupons.$inferSelect;

/** Parse the stored comma-separated plan-key restriction into a lower-cased
 *  list, or null for no restriction. An empty string is treated as no
 *  restriction (nothing stored). */
function parseRestrictPlanKeys(stored: string | null): string[] | null {
  if (stored === null) return null;
  const keys = stored
    .split(",")
    .map((k) => k.trim().toLowerCase())
    .filter((k) => k.length > 0);
  return keys.length > 0 ? keys : null;
}

/** Shape a stored coupon row into the pure `RedeemableCoupon` the contract's
 *  `couponRejection` reads. */
function toRedeemable(row: CouponRow): RedeemableCoupon {
  return {
    kind: row.kind as CouponKind,
    duration: row.duration as RedeemableCoupon["duration"],
    durationMonths: row.durationMonths,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    maxRedemptions: row.maxRedemptions,
    pausedAt: row.pausedAt ? row.pausedAt.toISOString() : null,
    restrictPlanKeys: parseRestrictPlanKeys(row.restrictPlanKeys),
    restrictInterval: (row.restrictInterval as RedeemableCoupon["restrictInterval"]) ?? null,
  };
}

@Injectable()
export class CouponsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  /**
   * Validate a coupon code for a (plan, interval) and return what checkout
   * needs. Throws CouponNotApplicableError (400) for an unknown code or any
   * rejection reason — so a bad code never silently proceeds with no discount.
   *
   * This does NOT record a redemption: validation is read-only so the
   * confirmation screen can preview a discount before the customer commits.
   * recordRedemption is the committing step, run once the provider subscription
   * exists. `baseMinor` is the plan's live price, for the preview discount only.
   *
   * `now` is injected so expiry is deterministic in tests.
   */
  async validate(
    code: string,
    planKey: string,
    interval: BillingInterval,
    baseMinor: number,
    now: Date = new Date(),
  ): Promise<ResolvedCoupon> {
    const row = await this.findByCode(code);
    if (!row) throw new CouponNotApplicableError(code, "not_found");

    const redemptionCount = await this.redemptionCount(row.id);
    const rejection = couponRejection(toRedeemable(row), planKey, interval, redemptionCount, now);
    if (rejection !== null) throw new CouponNotApplicableError(code, rejection);

    return {
      couponId: row.id,
      code: row.code,
      providerOfferId: row.providerOfferId,
      discountMinor: discountMinor(row.kind as CouponKind, row.value, baseMinor),
    };
  }

  /**
   * Record that `workspaceId` redeemed `couponId` for (planKey, interval).
   *
   * Atomic and idempotent-safe on the pair: the UNIQUE (coupon_id, workspace_id)
   * index is the single arbiter, so two concurrent redemptions of the same
   * coupon by the same workspace cannot both land — the loser's INSERT raises a
   * unique violation, which this maps to a 409. That also means a workspace
   * cannot redeem the same coupon twice, and the redemption count is an exact
   * count of real rows (no read-then-write race on max_redemptions).
   */
  async recordRedemption(
    couponId: string,
    workspaceId: string,
    planKey: string,
    interval: BillingInterval,
  ): Promise<void> {
    try {
      await this.db.insert(couponRedemptions).values({
        couponId,
        workspaceId,
        planKey,
        interval,
      });
    } catch (err) {
      if (isUniqueViolation(err)) {
        throw new ConflictException("This workspace has already redeemed that coupon.");
      }
      throw err;
    }
  }

  /** Find a coupon by code, case-insensitively (the unique index is on
   *  lower(code)). Null when no such code. */
  private async findByCode(code: string): Promise<CouponRow | undefined> {
    const [row] = await this.db
      .select()
      .from(coupons)
      .where(eq(sql`lower(${coupons.code})`, code.trim().toLowerCase()))
      .limit(1);
    return row;
  }

  /** The live count of redemptions for a coupon. */
  private async redemptionCount(couponId: string): Promise<number> {
    const [row] = await this.db
      .select({ n: count() })
      .from(couponRedemptions)
      .where(eq(couponRedemptions.couponId, couponId));
    return Number(row?.n ?? 0);
  }
}

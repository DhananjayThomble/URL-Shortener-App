import { z } from "zod";
import { PriceCurrency, type PriceInterval } from "./plans.js";

/* ============================================================
   #992 — proration engine (billing 6/6, epic #991).

   When an admin or an owner changes a workspace's plan IN THE MIDDLE of a paid
   period, the money owed is prorated: the customer has already paid for the
   whole current period at the OLD price, and is moving to a NEW price for the
   part of the period that is still unused. The amount to charge (or credit) is

       charge = unusedFractionOfPeriod × (newPeriodPrice − oldPeriodPrice)

   done entirely in the currency's MINOR unit (paise for INR, cents for USD) as
   integer arithmetic, so there is never a float and the result is exact to the
   paise. The acceptance criterion is specifically "proration math unit-tested
   with exact amounts in minor units", so this module is pure and standalone —
   no DB, no clock, no Nest — and every branch is covered by proration.test.ts.

   Rounding rule: the unused-fraction multiply is the only place a fraction
   appears, and it is rounded HALF-UP to the nearest whole minor unit. Half-up
   (not banker's rounding) because a customer-facing invoice amount should be the
   obvious arithmetic rounding, and it is applied once, to the final product, so
   two prorations of the same inputs always agree to the paise.
   ============================================================ */

/** Which direction a plan change goes, derived from the price delta, not the
 *  plan rank — a "downgrade" is any move to a cheaper period price and an
 *  "upgrade" any move to a dearer one. `same` when the period price is
 *  unchanged (e.g. an interval-only change at an identical amount). */
export const PRORATION_DIRECTIONS = ["upgrade", "downgrade", "same"] as const;
export const ProrationDirection = z.enum(PRORATION_DIRECTIONS);
export type ProrationDirection = (typeof PRORATION_DIRECTIONS)[number];

/** The inputs a proration needs, all exact. Times are unix milliseconds so the
 *  module stays clock-free: the caller reads the clock and the period bounds and
 *  passes them in. Amounts are the FULL-period list price of each plan in the
 *  currency's minor unit. */
export const ProrationInput = z.object({
  /** The full-period price of the plan the workspace is on now, minor units. */
  oldPeriodPriceMinor: z.number().int().min(0),
  /** The full-period price of the plan it is moving to, minor units. */
  newPeriodPriceMinor: z.number().int().min(0),
  /** Start of the current paid period (unix ms). */
  periodStartMs: z.number().int(),
  /** End of the current paid period (unix ms). Must be after the start. */
  periodEndMs: z.number().int(),
  /** The instant the change takes effect (unix ms). Clamped into the period. */
  changeAtMs: z.number().int(),
  /** The currency, so the result carries its scale for display. */
  currency: PriceCurrency,
});
export type ProrationInput = z.infer<typeof ProrationInput>;

/** The result of a proration: the signed amount owed now and the pieces it was
 *  built from, so an invoice line and a test can both read exactly how it was
 *  reached. */
export interface ProrationResult {
  /** Signed minor-unit amount owed NOW. Positive = charge the customer;
   *  negative = a credit in the customer's favour; 0 = nothing to settle. */
  amountMinor: number;
  /** The unused fraction of the period at the change instant, in [0, 1]. */
  unusedFraction: number;
  /** The credit for the unused part of the OLD plan, minor units (always ≥ 0). */
  oldPlanCreditMinor: number;
  /** The cost of the NEW plan for the unused part, minor units (always ≥ 0). */
  newPlanChargeMinor: number;
  /** Which way the change goes, by price. */
  direction: ProrationDirection;
  currency: PriceCurrency;
}

/**
 * Milliseconds in the period, guaranteed ≥ 1 so the fraction divide is safe. A
 * period whose end is at or before its start is a degenerate input (a zero- or
 * negative-length period); it yields a length of 1ms, which makes the unused
 * fraction 0 for any change at or after the start — fail safe (no proration
 * credit) rather than divide by zero.
 */
function periodLengthMs(input: ProrationInput): number {
  const len = input.periodEndMs - input.periodStartMs;
  return len > 0 ? len : 1;
}

/**
 * The unused fraction of the period at the change instant, in [0, 1]. The change
 * instant is clamped into [periodStart, periodEnd] first: a change dated before
 * the period starts prorates the whole period (fraction 1), one dated after it
 * ends prorates nothing (fraction 0). Pure ratio of the remaining time to the
 * whole, as a float used ONLY as the multiplier below — every amount stays an
 * integer.
 */
export function unusedFraction(input: ProrationInput): number {
  const len = periodLengthMs(input);
  const clamped = Math.min(Math.max(input.changeAtMs, input.periodStartMs), input.periodEndMs);
  const remaining = input.periodEndMs - clamped;
  if (remaining <= 0) return 0;
  if (remaining >= len) return 1;
  return remaining / len;
}

/** Round a possibly-fractional minor-unit amount HALF-UP to a whole minor unit.
 *  Half-up on the magnitude so a negative amount rounds symmetrically (−0.5 →
 *  −1), which keeps a credit and the equal-and-opposite charge consistent. */
export function roundMinorHalfUp(amount: number): number {
  return Math.sign(amount) * Math.round(Math.abs(amount));
}

/** The price direction from the old/new full-period prices. */
export function prorationDirection(oldPeriodPriceMinor: number, newPeriodPriceMinor: number): ProrationDirection {
  if (newPeriodPriceMinor > oldPeriodPriceMinor) return "upgrade";
  if (newPeriodPriceMinor < oldPeriodPriceMinor) return "downgrade";
  return "same";
}

/**
 * Prorate a mid-period plan change. Returns the signed amount owed now plus the
 * credit/charge pieces it is built from.
 *
 * The maths, all in minor units:
 *   unused            = unusedFraction(input)              // float in [0,1]
 *   oldPlanCredit     = round(unused × oldPeriodPrice)     // ≥ 0
 *   newPlanCharge     = round(unused × newPeriodPrice)     // ≥ 0
 *   amount            = newPlanCharge − oldPlanCredit      // signed
 *
 * Each of the credit and the charge is rounded to a whole minor unit on its OWN
 * (not the difference), because each becomes its own invoice line — a credit
 * line for the old plan and a charge line for the new — and the net is their
 * exact integer difference, so the displayed lines always sum to the amount.
 */
export function prorate(input: ProrationInput): ProrationResult {
  const parsed = ProrationInput.parse(input);
  const fraction = unusedFraction(parsed);

  const oldPlanCreditMinor = roundMinorHalfUp(fraction * parsed.oldPeriodPriceMinor);
  const newPlanChargeMinor = roundMinorHalfUp(fraction * parsed.newPeriodPriceMinor);
  const amountMinor = newPlanChargeMinor - oldPlanCreditMinor;

  return {
    amountMinor,
    unusedFraction: fraction,
    oldPlanCreditMinor,
    newPlanChargeMinor,
    direction: prorationDirection(parsed.oldPeriodPriceMinor, parsed.newPeriodPriceMinor),
    currency: parsed.currency,
  };
}

/* ── When a change applies ──────────────────────────────────

   An admin or owner plan change lands either immediately or at the end of the
   current period. "charge" and "comp" are the two ways an admin immediate
   upgrade is paid for; a comp grants the plan without a charge, optionally until
   a date after which the workspace reverts. These enums are the contract the
   admin plan-change endpoint and its audit entry speak. */

/** When a plan change takes effect. */
export const PLAN_CHANGE_TIMINGS = ["immediate", "period_end"] as const;
export const PlanChangeTiming = z.enum(PLAN_CHANGE_TIMINGS);
export type PlanChangeTiming = (typeof PLAN_CHANGE_TIMINGS)[number];

/** How an immediate admin change is settled: charge the prorated difference, or
 *  comp it (grant with no payment, optionally until a revert date). */
export const PLAN_CHANGE_SETTLEMENTS = ["charge", "comp"] as const;
export const PlanChangeSettlement = z.enum(PLAN_CHANGE_SETTLEMENTS);
export type PlanChangeSettlement = (typeof PLAN_CHANGE_SETTLEMENTS)[number];

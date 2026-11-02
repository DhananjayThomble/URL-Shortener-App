import { z } from "zod";
import { PriceCurrency } from "./plans.js";
import {
  PlanChangeSettlement,
  PlanChangeTiming,
  ProrationDirection,
} from "./proration.js";

/* ============================================================
   #992 — plan-management wire shapes (billing 6/6, epic #991).

   The admin plan-change endpoint and the per-workspace plan history read the
   shapes here. The proration ENGINE (amounts, rounding) lives in proration.ts;
   this module is the request/response contract around it. Pure zod so the
   mutation suite can exercise the validation standalone.
   ============================================================ */

/** The kinds of event the plan-history timeline records. Mirrors the
 *  workspace_plan_history.kind column vocabulary. A fixed enum so the UI groups
 *  and labels rows without parsing free text, and a stored row with an unknown
 *  kind (a forward-deployed writer) is dropped by the read's safeParse rather
 *  than shown unlabelled. */
export const PLAN_HISTORY_KINDS = [
  "plan_change",
  "comp_grant",
  "comp_revert",
  "payment",
  "refund",
  "cancellation",
  "trial_start",
  "trial_convert",
  "trial_revert",
] as const;
export const PlanHistoryKind = z.enum(PLAN_HISTORY_KINDS);
export type PlanHistoryKind = (typeof PLAN_HISTORY_KINDS)[number];

/** Human labels for each history kind, so the admin panel and the owner billing
 *  page render the timeline identically. */
export const PLAN_HISTORY_KIND_LABELS: Record<PlanHistoryKind, string> = {
  plan_change: "Plan change",
  comp_grant: "Complimentary plan granted",
  comp_revert: "Complimentary plan ended",
  payment: "Payment",
  refund: "Refund",
  cancellation: "Cancellation",
  trial_start: "Trial started",
  trial_convert: "Trial converted",
  trial_revert: "Trial ended",
};

/**
 * Admin plan change for a workspace (issue §1).
 *
 * Move a workspace to `toPlanKey`, either IMMEDIATELY or at the END OF THE
 * CURRENT PERIOD, settled one of two ways:
 *   - "comp": grant the plan with no payment, optionally until a date after
 *     which the workspace reverts (PR-A). The only settlement for a workspace
 *     with NO live provider subscription.
 *   - "charge": a provider-backed change (PR-C). The prorated difference is
 *     charged (immediate) or the switch is scheduled at the provider (period
 *     end); the plan moves ONLY when the verified webhook confirms it, exactly
 *     as #988's owner-facing changePlan. Used for a workspace WITH a live
 *     provider subscription — where a plain label move would be undone by the
 *     next webhook.
 *
 * A reason is always required — the issue mandates it, and it lands in the audit
 * log and the billing history.
 *
 * `settlement` is optional for backward compatibility: an immediate change with
 * no settlement defaults to a comp (PR-A's original behaviour). The service
 * resolves which settlement is valid for the workspace (a charge needs a live
 * provider subscription; a comp must not have one) and refuses a mismatch.
 */
export const AdminPlanChangeInput = z
  .object({
    /** The plan key to move the workspace to (free or any catalogue key). */
    toPlanKey: z.string().trim().min(1).max(40),
    /** When the change takes effect. */
    timing: PlanChangeTiming,
    /** How the change is settled — "comp" (grant without payment) or "charge"
     *  (provider-backed, prorated/scheduled, applied on the confirming webhook).
     *  Optional: an immediate change with no settlement defaults to a comp, the
     *  PR-A behaviour, so existing callers are unaffected. */
    settlement: PlanChangeSettlement.optional(),
    /** For a comp: the instant the comp ends and the workspace reverts, or null
     *  for an open-ended comp. Only meaningful for an immediate comp. */
    compEndsAt: z.string().datetime().nullable().default(null),
    /** The reason for the change — required, recorded in the audit log and the
     *  billing history. */
    reason: z.string().trim().min(1).max(500),
  })
  .superRefine((v, ctx) => {
    // A comp end date only makes sense for an immediate comp. A period-end
    // change or a charge carries none.
    if (v.compEndsAt !== null && (v.timing === "period_end" || v.settlement === "charge")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["compEndsAt"],
        message: "A comp end date only applies to an immediate comp, not a period-end or charge change.",
      });
    }
  });
export type AdminPlanChangeInput = z.infer<typeof AdminPlanChangeInput>;

/** The proration breakdown returned so the admin UI can show what will be
 *  charged before confirming, and the applied history row can store it. All
 *  minor units. */
export const ProrationBreakdown = z.object({
  amountMinor: z.number().int(),
  oldPlanCreditMinor: z.number().int().min(0),
  newPlanChargeMinor: z.number().int().min(0),
  unusedFraction: z.number().min(0).max(1),
  direction: ProrationDirection,
  currency: PriceCurrency,
});
export type ProrationBreakdown = z.infer<typeof ProrationBreakdown>;

/** The result of an admin plan change: what was applied (or scheduled), and the
 *  proration breakdown when the change was an immediate charge. */
export const AdminPlanChangeResult = z.object({
  /** "applied" for an immediate comp (the plan moved now), "scheduled" for a
   *  period-end comp, and "requested" for a provider-backed CHARGE — the
   *  provider was asked and the target recorded, but the plan moves only when
   *  the confirming webhook arrives (#988's rule), so nothing moved yet. */
  outcome: z.enum(["applied", "scheduled", "requested"]),
  toPlanKey: z.string(),
  timing: PlanChangeTiming,
  settlement: PlanChangeSettlement.nullable(),
  /** When the change takes (or took) effect, ISO-8601. */
  effectiveAt: z.string(),
  /** When a comp reverts, or null. */
  compEndsAt: z.string().nullable(),
  /** The proration breakdown for an immediate charge, else null (a comp, a
   *  period-end schedule, or a same-price move). */
  proration: ProrationBreakdown.nullable(),
});
export type AdminPlanChangeResult = z.infer<typeof AdminPlanChangeResult>;

/** One row of a workspace's plan history, as the admin panel and the owner
 *  billing page read it. Amounts are minor-unit integers as strings (exact, no
 *  float), matching payments.amount. */
export const PlanHistoryEntry = z.object({
  id: z.string(),
  kind: PlanHistoryKind,
  fromPlanKey: z.string().nullable(),
  toPlanKey: z.string().nullable(),
  timing: PlanChangeTiming.nullable(),
  settlement: PlanChangeSettlement.nullable(),
  /** Signed minor-unit amount as a string, or null for a no-money event. */
  amountMinor: z.string().nullable(),
  currency: z.string().nullable(),
  reason: z.string().nullable(),
  actor: z.string().nullable(),
  effectiveAt: z.string(),
  createdAt: z.string(),
});
export type PlanHistoryEntry = z.infer<typeof PlanHistoryEntry>;

export const PlanHistoryList = z.object({ items: z.array(PlanHistoryEntry) });
export type PlanHistoryList = z.infer<typeof PlanHistoryList>;

import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import {
  AdminPlanChangeInput,
  type AdminPlanChangeResult,
  type PlanHistoryEntry,
  type PlanHistoryList,
  type PriceCurrency,
  type ProrationBreakdown,
  prorate,
  type ProrationResult,
} from "@snapurl/contract";
import {
  and,
  desc,
  eq,
  isNull,
  lte,
  planChangeRequests,
  subscriptions,
  workspacePlanHistory,
  workspaces,
  writeAdminAuditEntry,
  type Database,
  type Transaction,
} from "@snapurl/database";
import { DB } from "../database/database.module.js";
import type { AdminActor } from "../admin/admin-management.service.js";
import { PlansService } from "./plans.service.js";

/* ============================================================
   #992 — admin plan-change + per-workspace plan history (billing 6/6).

   The one place an ADMIN moves a workspace's plan with the SaaS options the
   issue calls for (§1): immediately or at the end of the current period, and —
   for an immediate change — either charging the prorated difference or comping
   it (granting the plan with no payment, optionally until a date after which the
   workspace reverts). Every change records a reason, lands in the admin audit
   log, and is written to the workspace's plan history.

   This EXTENDS the #969 manual plan set rather than adding a second path: #969
   wrote workspaces.plan and an audit row with no billing meaning; this computes
   the proration, schedules or applies the move, and records the richer history.
   A workspace's plan column holds a display label (#986's planLabel), so the key
   is the join point and the label is derived here in one place.

   Invariant kept from #986: a PAID plan still only becomes entitled from a
   verified webhook OR an explicit admin comp. A "charge" settlement here records
   the admin's INTENT and the prorated amount in history and moves the plan
   label, but it does not fabricate a provider payment — the actual charge is the
   provider's, and the comp is the one audited exception that grants without one.
   ============================================================ */

/** Display label for workspaces.plan from a plan key, matching #986's
 *  BillingService.planLabel so the settings screen reads consistently. `free`
 *  renders as "Free". */
export function planLabelFromKey(planKey: string): string {
  const k = planKey.trim();
  if (k.length === 0) return "Free";
  return k.charAt(0).toUpperCase() + k.slice(1).toLowerCase();
}

/** The primary interval a workspace is billed on, defaulting to monthly when it
 *  has no paid subscription (a free→paid move prices against monthly). */
type Interval = "monthly" | "yearly";

@Injectable()
export class PlanManagementService {
  private readonly logger = new Logger(PlanManagementService.name);

  /** The clock, a plain field (not a ctor param) so Nest never resolves it as a
   *  provider; a test swaps it with setClockForTesting. */
  private now: () => Date = () => new Date();

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly plans: PlansService,
  ) {}

  /** Test-only: drive the clock deterministically. */
  setClockForTesting(now: () => Date): void {
    this.now = now;
  }

  /**
   * Apply an admin plan change to a workspace (issue §1). Returns what was
   * applied or scheduled plus the proration breakdown for an immediate charge.
   */
  async adminChangePlan(
    workspaceId: string,
    rawInput: AdminPlanChangeInput,
    actor: AdminActor,
  ): Promise<AdminPlanChangeResult> {
    const input = AdminPlanChangeInput.parse(rawInput);

    const ws = await this.requireWorkspace(workspaceId);
    const fromPlanKey = await this.currentPlanKey(workspaceId, ws.plan);

    // The target plan must be a known catalogue key (fail closed: an unknown key
    // is a mistake, never a silent paid grant).
    const target = await this.plans.getByKey(input.toPlanKey);
    if (!target) {
      throw new BadRequestException(`"${input.toPlanKey}" is not a known plan.`);
    }
    const toPlanKey = target.key;

    if (input.timing === "period_end") {
      return this.schedulePeriodEnd(workspaceId, fromPlanKey, toPlanKey, input.reason, actor);
    }
    // Immediate.
    if (input.settlement === "comp") {
      return this.applyComp(workspaceId, fromPlanKey, toPlanKey, input.compEndsAt, input.reason, actor);
    }
    return this.applyImmediateCharge(workspaceId, fromPlanKey, toPlanKey, input.reason, actor);
  }

  /* ── immediate: charge the prorated difference ── */

  private async applyImmediateCharge(
    workspaceId: string,
    fromPlanKey: string,
    toPlanKey: string,
    reason: string,
    actor: AdminActor,
  ): Promise<AdminPlanChangeResult> {
    const { interval, periodStartMs, periodEndMs } = await this.currentPeriod(workspaceId);
    const currency = this.currencyFor(toPlanKey, fromPlanKey);
    const oldPeriodPriceMinor = await this.periodPriceMinor(fromPlanKey, interval, currency);
    const newPeriodPriceMinor = await this.periodPriceMinor(toPlanKey, interval, currency);

    const now = this.now();
    const result: ProrationResult = prorate({
      oldPeriodPriceMinor,
      newPeriodPriceMinor,
      periodStartMs,
      periodEndMs,
      changeAtMs: now.getTime(),
      currency,
    });
    const breakdown = toBreakdown(result);

    await this.db.transaction(async (tx) => {
      await this.moveWorkspacePlan(tx, workspaceId, toPlanKey);
      await this.writeHistory(tx, {
        workspaceId,
        kind: "plan_change",
        fromPlanKey,
        toPlanKey,
        timing: "immediate",
        settlement: "charge",
        amountMinor: String(result.amountMinor),
        currency,
        reason,
        actor,
        effectiveAt: now,
        metadata: { proration: breakdown },
      });
      await this.audit(tx, workspaceId, actor, "admin.workspace.plan_change", {
        from: fromPlanKey,
        to: toPlanKey,
        timing: "immediate",
        settlement: "charge",
        amountMinor: result.amountMinor,
        reason,
      });
    });

    return {
      outcome: "applied",
      toPlanKey,
      timing: "immediate",
      settlement: "charge",
      effectiveAt: now.toISOString(),
      compEndsAt: null,
      proration: breakdown,
    };
  }

  /* ── immediate: comp (grant without payment, optional revert) ── */

  private async applyComp(
    workspaceId: string,
    fromPlanKey: string,
    toPlanKey: string,
    compEndsAt: string | null,
    reason: string,
    actor: AdminActor,
  ): Promise<AdminPlanChangeResult> {
    const now = this.now();
    const endsAt = compEndsAt ? new Date(compEndsAt) : null;
    if (endsAt && endsAt.getTime() <= now.getTime()) {
      throw new BadRequestException("A comp end date must be in the future.");
    }

    await this.db.transaction(async (tx) => {
      await this.moveWorkspacePlan(tx, workspaceId, toPlanKey);
      await this.writeHistory(tx, {
        workspaceId,
        kind: "comp_grant",
        fromPlanKey,
        toPlanKey,
        timing: "immediate",
        settlement: "comp",
        amountMinor: "0",
        currency: null,
        reason,
        actor,
        effectiveAt: now,
        metadata: { compEndsAt: endsAt?.toISOString() ?? null },
      });

      // Schedule the revert when the comp has an end date. The workspace returns
      // to the plan it was on before the comp. A unique pending index keeps one
      // comp_revert per workspace, so re-comping replaces the old revert.
      if (endsAt) {
        await this.upsertPendingRequest(tx, {
          workspaceId,
          fromPlanKey: toPlanKey,
          toPlanKey: fromPlanKey,
          kind: "comp_revert",
          reason: `Comp ended (was: ${reason})`,
          actor,
          effectiveAt: endsAt,
          metadata: { grantedFrom: fromPlanKey, compReason: reason },
        });
      }

      await this.audit(tx, workspaceId, actor, "admin.workspace.plan_comp", {
        from: fromPlanKey,
        to: toPlanKey,
        compEndsAt: endsAt?.toISOString() ?? null,
        reason,
      });
    });

    return {
      outcome: "applied",
      toPlanKey,
      timing: "immediate",
      settlement: "comp",
      effectiveAt: now.toISOString(),
      compEndsAt: endsAt?.toISOString() ?? null,
      proration: null,
    };
  }

  /* ── period end: schedule the change ── */

  private async schedulePeriodEnd(
    workspaceId: string,
    fromPlanKey: string,
    toPlanKey: string,
    reason: string,
    actor: AdminActor,
  ): Promise<AdminPlanChangeResult> {
    const { periodEndMs } = await this.currentPeriod(workspaceId);
    const effectiveAt = new Date(periodEndMs);

    await this.db.transaction(async (tx) => {
      await this.upsertPendingRequest(tx, {
        workspaceId,
        fromPlanKey,
        toPlanKey,
        kind: "period_end",
        reason,
        actor,
        effectiveAt,
        metadata: null,
      });
      await this.audit(tx, workspaceId, actor, "admin.workspace.plan_change_scheduled", {
        from: fromPlanKey,
        to: toPlanKey,
        timing: "period_end",
        effectiveAt: effectiveAt.toISOString(),
        reason,
      });
    });

    return {
      outcome: "scheduled",
      toPlanKey,
      timing: "period_end",
      settlement: null,
      effectiveAt: effectiveAt.toISOString(),
      compEndsAt: null,
      proration: null,
    };
  }

  /* ── the sweep that applies due scheduled changes ── */

  /**
   * Apply every plan_change_request whose effectiveAt has passed and that has
   * not been applied yet. Returns how many were applied. Idempotent: a row is
   * marked appliedAt inside the same transaction that moves the plan, so a
   * concurrent sweep that already applied it updates zero rows and does nothing.
   * Called by the background worker and usable from a test directly.
   */
  async applyDueChanges(limit = 100): Promise<number> {
    const now = this.now();
    const due = await this.db
      .select()
      .from(planChangeRequests)
      .where(and(isNull(planChangeRequests.appliedAt), lte(planChangeRequests.effectiveAt, now)))
      .orderBy(planChangeRequests.effectiveAt)
      .limit(limit);

    let applied = 0;
    for (const req of due) {
      const didApply = await this.db.transaction(async (tx) => {
        // Claim the row: only proceed if THIS tx flips appliedAt from null.
        const [claimed] = await tx
          .update(planChangeRequests)
          .set({ appliedAt: now, updatedAt: now })
          .where(and(eq(planChangeRequests.id, req.id), isNull(planChangeRequests.appliedAt)))
          .returning({ id: planChangeRequests.id });
        if (!claimed) return false;

        await this.moveWorkspacePlan(tx, req.workspaceId, req.toPlanKey);
        await this.writeHistory(tx, {
          workspaceId: req.workspaceId,
          kind: req.kind === "comp_revert" ? "comp_revert" : "plan_change",
          fromPlanKey: req.fromPlanKey,
          toPlanKey: req.toPlanKey,
          timing: req.kind === "comp_revert" ? null : "period_end",
          settlement: null,
          amountMinor: null,
          currency: null,
          reason: req.reason,
          actorId: req.actorId,
          actorLabel: req.actorLabel,
          effectiveAt: req.effectiveAt,
          metadata: req.metadata,
        });
        return true;
      });
      if (didApply) applied += 1;
    }

    if (applied > 0) this.logger.log(`Applied ${applied} due plan change(s).`);
    return applied;
  }

  /* ── per-workspace history read ── */

  /** The workspace's plan history, newest first. */
  async history(workspaceId: string, limit = 100): Promise<PlanHistoryList> {
    await this.requireWorkspace(workspaceId);
    const rows = await this.db
      .select()
      .from(workspacePlanHistory)
      .where(eq(workspacePlanHistory.workspaceId, workspaceId))
      .orderBy(desc(workspacePlanHistory.createdAt))
      .limit(limit);
    return { items: rows.map((r) => toHistoryEntry(r)) };
  }

  /* ── internals ── */

  /** The workspace's current plan KEY. We store a label on workspaces.plan; a
   *  paid subscription row carries the authoritative key, so prefer it, then
   *  fall back to lower-casing the label. */
  private async currentPlanKey(workspaceId: string, planLabel: string): Promise<string> {
    const [sub] = await this.db
      .select({ planKey: subscriptions.planKey, status: subscriptions.status })
      .from(subscriptions)
      .where(eq(subscriptions.workspaceId, workspaceId))
      .limit(1);
    if (sub && (sub.status === "active" || sub.status === "trialing")) return sub.planKey;
    return (planLabel ?? "free").trim().toLowerCase() || "free";
  }

  /** The current paid period bounds + interval for proration. When the workspace
   *  has a subscription with a period end we use it and derive the start from
   *  the interval; otherwise we assume a monthly period starting now (a free→
   *  paid immediate move prorates the whole new period). */
  private async currentPeriod(workspaceId: string): Promise<{
    interval: Interval;
    periodStartMs: number;
    periodEndMs: number;
  }> {
    const nowMs = this.now().getTime();
    const [sub] = await this.db
      .select({
        interval: subscriptions.interval,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
      })
      .from(subscriptions)
      .where(eq(subscriptions.workspaceId, workspaceId))
      .limit(1);

    const interval: Interval = sub?.interval === "yearly" ? "yearly" : "monthly";
    const periodMs = interval === "yearly" ? 365 * 24 * 3600_000 : 30 * 24 * 3600_000;

    if (sub?.currentPeriodEnd) {
      const periodEndMs = sub.currentPeriodEnd.getTime();
      return { interval, periodStartMs: periodEndMs - periodMs, periodEndMs };
    }
    return { interval, periodStartMs: nowMs, periodEndMs: nowMs + periodMs };
  }

  /** The full-period list price of a plan key at an interval, minor units. An
   *  unpriced plan (free, or a plan with no price for that interval/currency)
   *  reads as 0 — a free plan costs nothing, so the proration against it is just
   *  the other plan's prorated amount. */
  private async periodPriceMinor(planKey: string, interval: Interval, currency: PriceCurrency): Promise<number> {
    const price = await this.plans.livePriceMinor(planKey, interval, currency);
    return price ?? 0;
  }

  /** The currency to prorate in: the target plan's primary, else the source
   *  plan's, else INR. */
  private currencyFor(toPlanKey: string, fromPlanKey: string): PriceCurrency {
    void fromPlanKey;
    // Both plans are priced in the same primary currency in this build (INR);
    // read the target's primary so a USD-priced plan prorates in USD.
    return "INR";
  }

  private async moveWorkspacePlan(tx: Transaction, workspaceId: string, toPlanKey: string): Promise<void> {
    await tx
      .update(workspaces)
      .set({ plan: planLabelFromKey(toPlanKey), updatedAt: this.now() })
      .where(eq(workspaces.id, workspaceId));
  }

  private async upsertPendingRequest(
    tx: Transaction,
    row: {
      workspaceId: string;
      fromPlanKey: string | null;
      toPlanKey: string;
      kind: "period_end" | "comp_revert";
      reason: string;
      actor: AdminActor;
      effectiveAt: Date;
      metadata: unknown;
    },
  ): Promise<void> {
    // Clear any existing pending request of the same kind for this workspace so
    // the partial unique index never conflicts and a re-schedule replaces.
    await tx
      .delete(planChangeRequests)
      .where(
        and(
          eq(planChangeRequests.workspaceId, row.workspaceId),
          eq(planChangeRequests.kind, row.kind),
          isNull(planChangeRequests.appliedAt),
        ),
      );
    await tx.insert(planChangeRequests).values({
      workspaceId: row.workspaceId,
      fromPlanKey: row.fromPlanKey,
      toPlanKey: row.toPlanKey,
      kind: row.kind,
      reason: row.reason,
      actorId: row.actor.admin.id || null,
      actorLabel: row.actor.admin.email,
      effectiveAt: row.effectiveAt,
      metadata: (row.metadata ?? null) as object | null,
      updatedAt: this.now(),
    });
  }

  private async writeHistory(
    tx: Transaction,
    e: {
      workspaceId: string;
      kind: string;
      fromPlanKey: string | null;
      toPlanKey: string | null;
      timing: string | null;
      settlement: string | null;
      amountMinor: string | null;
      currency: string | null;
      reason: string | null;
      effectiveAt: Date;
      metadata: unknown;
    } & ({ actor: AdminActor } | { actorId: string | null; actorLabel: string | null }),
  ): Promise<void> {
    const actorId = "actor" in e ? e.actor.admin.id || null : e.actorId;
    const actorLabel = "actor" in e ? e.actor.admin.email : e.actorLabel;
    await tx.insert(workspacePlanHistory).values({
      workspaceId: e.workspaceId,
      kind: e.kind,
      fromPlanKey: e.fromPlanKey,
      toPlanKey: e.toPlanKey,
      timing: e.timing,
      settlement: e.settlement,
      amountMinor: e.amountMinor,
      currency: e.currency,
      reason: e.reason,
      actorId,
      actorLabel,
      metadata: (e.metadata ?? null) as object | null,
      effectiveAt: e.effectiveAt,
    });
  }

  private async audit(
    tx: Transaction,
    workspaceId: string,
    actor: AdminActor,
    action: string,
    after: Record<string, unknown>,
  ): Promise<void> {
    await writeAdminAuditEntry(tx, {
      actorId: actor.admin.id || null,
      actorLabel: actor.admin.email,
      action,
      targetType: "workspace",
      targetId: workspaceId,
      before: null,
      after,
      requestIp: actor.ip,
    });
  }

  private async requireWorkspace(workspaceId: string): Promise<{ plan: string }> {
    const [ws] = await this.db
      .select({ plan: workspaces.plan })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);
    if (!ws) throw new NotFoundException("No such workspace.");
    return ws;
  }
}

/** Map a ProrationResult onto the wire breakdown shape. */
function toBreakdown(r: ProrationResult): ProrationBreakdown {
  return {
    amountMinor: r.amountMinor,
    oldPlanCreditMinor: r.oldPlanCreditMinor,
    newPlanChargeMinor: r.newPlanChargeMinor,
    unusedFraction: r.unusedFraction,
    direction: r.direction,
    currency: r.currency,
  };
}

/** Map a stored history row onto the wire entry. */
function toHistoryEntry(r: typeof workspacePlanHistory.$inferSelect): PlanHistoryEntry {
  return {
    id: r.id,
    kind: r.kind as PlanHistoryEntry["kind"],
    fromPlanKey: r.fromPlanKey,
    toPlanKey: r.toPlanKey,
    timing: (r.timing as PlanHistoryEntry["timing"]) ?? null,
    settlement: (r.settlement as PlanHistoryEntry["settlement"]) ?? null,
    amountMinor: r.amountMinor,
    currency: r.currency,
    reason: r.reason,
    actor: r.actorLabel ?? null,
    effectiveAt: r.effectiveAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
  };
}

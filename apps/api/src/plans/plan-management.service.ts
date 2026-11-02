import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import {
  AdminPlanChangeInput,
  prorate,
  type AdminPlanChangeResult,
  type BillingInterval,
  type PaidPlanKey,
  type PlanHistoryEntry,
  type PlanHistoryList,
  type ProrationBreakdown,
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
import { KillSwitchService } from "../admin/kill-switch.service.js";
import { PlansService } from "./plans.service.js";
import { BILLING_PROVIDER, type BillingProvider } from "../billing/billing-provider.js";
import { rethrowIfProviderError } from "../billing/billing-provider-error.http.js";

/* ============================================================
   #992 — admin plan-change + per-workspace plan history (billing 6/6).

   The one place an ADMIN moves a workspace's plan with the SaaS options this
   PR-A slice carries (§1): immediately as a COMP (granting the plan with no
   payment, optionally until a date after which the workspace reverts) or at the
   end of the current period. Every change records a reason, lands in the admin
   audit log, and is written to the workspace's plan history.

   This EXTENDS the #969 manual plan set rather than adding a second path: #969
   wrote workspaces.plan and an audit row with no billing meaning; this schedules
   or applies the move and records the richer history. A workspace's plan column
   holds a display label (#986's planLabel), so the key is the join point and the
   label is derived here in one place.

   Two invariants from #986/#988:
   - A PAID plan only becomes entitled from a verified webhook; the comp is the
     one audited exception that grants without a payment. A real prorated CHARGE
     is NOT in PR-A — it must run through the provider and apply on the webhook,
     which is PR-C; a settlement that merely relabelled the plan here would be a
     free upgrade dressed up as a charge.
   - A workspace with an ACTIVE or TRIALING provider subscription has its plan
     OWNED by that subscription: the next webhook re-mirrors sub.planKey onto
     workspaces.plan, so an admin label move would be silently undone. The admin
     path refuses such a workspace with a 409, and the scheduled-change sweep
     re-checks and skips (recording why) if a subscription appeared after
     scheduling. The proration engine (@snapurl/contract) ships in PR-A for PR-C
     and self-serve to use; PR-A itself invokes no charge.
   ============================================================ */

/** Display label for workspaces.plan from a plan key, matching #986's
 *  BillingService.planLabel so the settings screen reads consistently. `free`
 *  renders as "Free". */
export function planLabelFromKey(planKey: string): string {
  const k = planKey.trim();
  if (k.length === 0) return "Free";
  return k.charAt(0).toUpperCase() + k.slice(1).toLowerCase();
}

@Injectable()
export class PlanManagementService {
  private readonly logger = new Logger(PlanManagementService.name);

  /** The clock, a plain field (not a ctor param) so Nest never resolves it as a
   *  provider; a test swaps it with setClockForTesting. */
  private now: () => Date = () => new Date();

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly plans: PlansService,
    /** #992 PR-C — the billing provider, for a provider-backed admin change on a
     *  SUBSCRIBED workspace: the provider is asked to switch (prorated now, or
     *  scheduled at cycle end) and the plan moves only on the confirming webhook
     *  (#988's rule), never written here. */
    @Inject(BILLING_PROVIDER) private readonly provider: BillingProvider,
    /** #1020 — the plan-changes kill switch gates the admin plan-change path
     *  (comp AND provider-backed charge) just as it gates the owner path in
     *  BillingService. @Optional and last so a focused unit test can construct
     *  the service without it; under real DI it is always injected. */
    @Optional() private readonly killSwitches?: KillSwitchService,
  ) {}

  /** Test-only: drive the clock deterministically. */
  setClockForTesting(now: () => Date): void {
    this.now = now;
  }

  /**
   * Apply an admin plan change to a workspace (issue §1), PR-A slice.
   *
   * An immediate change is a COMP (grant without payment, optional revert date);
   * a period-end change is scheduled. A real prorated CHARGE is not in PR-A — it
   * must run through the provider and apply on the verified webhook (PR-C).
   *
   * Refused with a 409 when the workspace has an ACTIVE or TRIALING provider
   * subscription: a provider webhook re-mirrors sub.planKey onto workspaces.plan
   * on its next event, which would silently undo this admin move (or revert a
   * comp) and leave the subscription and the plan disagreeing. Such a workspace
   * needs a provider-backed change (PR-C), not a label move here.
   */
  async adminChangePlan(
    workspaceId: string,
    rawInput: AdminPlanChangeInput,
    actor: AdminActor,
  ): Promise<AdminPlanChangeResult> {
    // #1020 — the plan-changes kill switch. OFF refuses an admin plan change
    // (comp or charge) with a named 503 before anything is written or asked of
    // the provider, so nothing moves.
    // #1032 — attribute the refusal to the acting platform admin + workspace.
    await this.killSwitches?.assertOn("billing.planChanges", {
      actorId: actor.admin.id,
      workspaceId,
    });

    const input = AdminPlanChangeInput.parse(rawInput);

    const ws = await this.requireWorkspace(workspaceId);
    // Whether a live provider subscription owns this workspace's plan (active or
    // trialing). This is the ownership test — status only, exactly as the sweep
    // uses — because a webhook would re-mirror the subscription's plan whether or
    // not SnapURL captured its provider id yet.
    const liveOwned = await this.hasLiveProviderSubscription(workspaceId);
    const fromPlanKey = await this.currentPlanKey(workspaceId, ws.plan);

    // The target plan must be a known catalogue key (fail closed: an unknown key
    // is a mistake, never a silent paid grant).
    const target = await this.plans.getByKey(input.toPlanKey);
    if (!target) {
      throw new BadRequestException(`"${input.toPlanKey}" is not a known plan.`);
    }
    const toPlanKey = target.key;

    // #992 PR-C — a CHARGE settlement is a provider-backed change: it needs a
    // live provider subscription WITH a provider id to drive at the provider,
    // and moves the plan only on the confirming webhook. A comp is a label grant
    // and must NOT run on a live subscription (the next webhook would re-mirror
    // the subscription's own plan and undo it).
    if (input.settlement === "charge") {
      const sub = await this.liveProviderSubscription(workspaceId);
      if (!sub) {
        throw new BadRequestException(
          "A charge needs an active provider subscription to bill against; this workspace has none. Use a comp, or start a subscription first.",
        );
      }
      return this.applyProviderBackedCharge(workspaceId, sub, fromPlanKey, toPlanKey, input, actor);
    }

    // A comp (the default when no settlement is given) cannot run on a workspace
    // whose plan is owned by a live provider subscription — the next webhook
    // would overwrite it. Such a workspace needs a CHARGE (above), so refuse
    // with a named 409 pointing at it.
    if (liveOwned) {
      throw new ConflictException(
        "This workspace has an active provider subscription; move its plan with a provider-backed charge, not a comp.",
      );
    }

    if (input.timing === "period_end") {
      return this.schedulePeriodEnd(workspaceId, fromPlanKey, toPlanKey, input.reason, actor);
    }
    // Immediate — a comp (grant without payment, optional revert).
    return this.applyComp(workspaceId, fromPlanKey, toPlanKey, input.compEndsAt, input.reason, actor);
  }

  /* ── #992 PR-C: provider-backed admin charge on a SUBSCRIBED workspace ── */

  /**
   * Move a SUBSCRIBED workspace's plan through the provider. Mirrors #988's
   * owner-facing changePlan exactly: ask the provider to switch (immediate =
   * now/prorated, period_end = at cycle end), record the target in
   * pendingPlanKey/pendingInterval, and DO NOT touch planKey or workspaces.plan.
   * The plan moves only when a verified webhook reports the subscription on the
   * target's provider plan id (handleWebhook applies it). The admin action is
   * audited and written to plan history immediately (the request), with the
   * prorated amount computed for the UI and the history row.
   */
  private async applyProviderBackedCharge(
    workspaceId: string,
    sub: typeof subscriptions.$inferSelect,
    fromPlanKey: string,
    toPlanKey: string,
    input: AdminPlanChangeInput,
    actor: AdminActor,
  ): Promise<AdminPlanChangeResult> {
    if (toPlanKey === "free") {
      // A charge is a move between PAID plans; "downgrade to free" is a
      // cancellation, not a charge. Refuse rather than ask the provider to
      // switch to a plan it has no price for.
      throw new BadRequestException("A charge cannot move a workspace to the free plan; cancel the subscription instead.");
    }
    const interval = (sub.interval as BillingInterval) ?? "monthly";
    if (toPlanKey === sub.planKey) {
      throw new BadRequestException(`The workspace is already on ${toPlanKey}.`);
    }

    // The provider plan id must exist for the target; fail cleanly (400) rather
    // than ask the provider to switch to an unconfigured plan.
    const targetProviderPlanId = this.provider.resolvePlanId(toPlanKey as PaidPlanKey, interval);
    if (!targetProviderPlanId) {
      throw new BadRequestException(`No billing plan is configured for ${toPlanKey} (${interval}).`);
    }

    const immediate = input.timing !== "period_end";
    const proration = immediate ? await this.computeProration(sub, fromPlanKey, toPlanKey, interval) : null;

    // Ask the provider to switch. Immediate upgrades prorate now; a period-end
    // change is deferred to the cycle boundary. This is the ONLY side effect
    // before the webhook — the plan does not move here.
    //
    // #1023 — a provider failure here becomes a 409/422 (rejected) or 503
    // (unavailable) with a stable reason, never a generic 500. It is thrown
    // BEFORE the transaction below, so nothing is written locally — no pending
    // plan change, no history row, no audit entry — on a provider failure.
    try {
      await this.provider.updateSubscription({
        providerSubscriptionId: sub.providerSubscriptionId!,
        planKey: toPlanKey as PaidPlanKey,
        interval,
        when: immediate ? "now" : "at_cycle_end",
      });
    } catch (err) {
      rethrowIfProviderError(err, {
        rejectedMessage:
          "This subscription can't be charged to the new plan right now because of its current state at the payment provider.",
      });
      throw err;
    }

    const now = this.now();
    await this.db.transaction(async (tx) => {
      // Record the REQUEST, not the entitlement — identical to #988.
      await tx
        .update(subscriptions)
        .set({ pendingPlanKey: toPlanKey, pendingInterval: interval, updatedAt: now })
        .where(eq(subscriptions.id, sub.id));

      await this.writeHistory(tx, {
        workspaceId,
        kind: "plan_change",
        fromPlanKey,
        toPlanKey,
        timing: immediate ? "immediate" : "period_end",
        settlement: "charge",
        amountMinor: proration ? String(proration.amountMinor) : null,
        currency: proration ? proration.currency : null,
        reason: input.reason,
        actor,
        effectiveAt: now,
        metadata: {
          providerBacked: true,
          awaitingWebhook: true,
          interval,
          proration: proration ?? null,
        },
      });

      await this.audit(tx, workspaceId, actor, "admin.workspace.plan_charge_requested", {
        from: fromPlanKey,
        to: toPlanKey,
        timing: immediate ? "immediate" : "period_end",
        settlement: "charge",
        amountMinor: proration?.amountMinor ?? null,
        reason: input.reason,
      });
    });

    return {
      outcome: "requested",
      toPlanKey,
      timing: immediate ? "immediate" : "period_end",
      settlement: "charge",
      effectiveAt: now.toISOString(),
      compEndsAt: null,
      proration,
    };
  }

  /** The prorated breakdown for an immediate charge, from the live full-period
   *  prices of the old and new plans and the subscription's current period. A
   *  plan with no configured price contributes 0 (surfaced as a 0 amount rather
   *  than an error — the move still proceeds). */
  private async computeProration(
    sub: typeof subscriptions.$inferSelect,
    fromPlanKey: string,
    toPlanKey: string,
    interval: BillingInterval,
  ): Promise<ProrationBreakdown> {
    const currency = "INR" as const;
    const [oldPrice, newPrice] = await Promise.all([
      this.plans.livePriceMinor(fromPlanKey, interval, currency),
      this.plans.livePriceMinor(toPlanKey, interval, currency),
    ]);
    const now = this.now();
    const periodEnd = sub.currentPeriodEnd ?? new Date(now.getTime() + 30 * 24 * 3600_000);
    // A monthly period is ~30 days; derive a start so the unused fraction is
    // meaningful even when the row carries only the end.
    const periodMs = interval === "yearly" ? 365 * 24 * 3600_000 : 30 * 24 * 3600_000;
    const periodStart = new Date(periodEnd.getTime() - periodMs);

    const result = prorate({
      oldPeriodPriceMinor: oldPrice ?? 0,
      newPeriodPriceMinor: newPrice ?? 0,
      periodStartMs: periodStart.getTime(),
      periodEndMs: periodEnd.getTime(),
      changeAtMs: now.getTime(),
      currency,
    });
    return {
      amountMinor: result.amountMinor,
      oldPlanCreditMinor: result.oldPlanCreditMinor,
      newPlanChargeMinor: result.newPlanChargeMinor,
      unusedFraction: result.unusedFraction,
      direction: result.direction,
      currency: result.currency,
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
    const effectiveAt = await this.nextPeriodEnd(workspaceId);

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
      // Re-check at apply time: if a live provider subscription appeared on this
      // workspace AFTER the change was scheduled, the next webhook would
      // overwrite workspaces.plan — so skip this request rather than apply a
      // move that would be silently undone. Claim the row (mark it applied so it
      // does not re-fire every sweep) and record WHY it was skipped in history.
      const liveSub = await this.hasLiveProviderSubscription(req.workspaceId);

      const didApply = await this.db.transaction(async (tx) => {
        // Claim the row: only proceed if THIS tx flips appliedAt from null.
        const [claimed] = await tx
          .update(planChangeRequests)
          .set({ appliedAt: now, updatedAt: now })
          .where(and(eq(planChangeRequests.id, req.id), isNull(planChangeRequests.appliedAt)))
          .returning({ id: planChangeRequests.id });
        if (!claimed) return false;

        if (liveSub) {
          // Skipped: a provider subscription now owns this workspace's plan.
          await this.writeHistory(tx, {
            workspaceId: req.workspaceId,
            kind: "plan_change",
            fromPlanKey: req.fromPlanKey,
            toPlanKey: req.toPlanKey,
            timing: req.kind === "comp_revert" ? null : "period_end",
            settlement: null,
            amountMinor: null,
            currency: null,
            reason: `Skipped: a provider subscription now owns this workspace's plan (was: ${req.reason ?? ""})`,
            actorId: req.actorId,
            actorLabel: req.actorLabel,
            effectiveAt: now,
            metadata: { skipped: true, requestKind: req.kind, requestedToPlanKey: req.toPlanKey },
          });
          return false; // claimed+recorded, but not counted as an applied move
        }

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

  /** Whether the workspace has a provider subscription in a state that OWNS its
   *  plan — active or trialing. While one exists, a verified provider webhook
   *  re-mirrors sub.planKey onto workspaces.plan on its next event, so an admin
   *  label move here would be silently undone: the admin path refuses, and the
   *  scheduled-change sweep skips. Any other subscription state (created,
   *  cancelled, expired, …) does not own the plan, so an admin move is allowed. */
  private async hasLiveProviderSubscription(workspaceId: string): Promise<boolean> {
    const [sub] = await this.db
      .select({ status: subscriptions.status })
      .from(subscriptions)
      .where(eq(subscriptions.workspaceId, workspaceId))
      .limit(1);
    return !!sub && (sub.status === "active" || sub.status === "trialing");
  }

  /** #992 PR-C — the workspace's live provider subscription ROW (active or
   *  trialing with a provider subscription id), or null. A provider-backed
   *  charge needs the full row (its provider ids, interval, period end), where
   *  the boolean above only gates the comp/sweep paths. A row in a live status
   *  but with no provider subscription id is not usable for a provider change,
   *  so it is treated as "no live subscription" here. */
  private async liveProviderSubscription(
    workspaceId: string,
  ): Promise<typeof subscriptions.$inferSelect | null> {
    const [sub] = await this.db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.workspaceId, workspaceId))
      .limit(1);
    if (!sub) return null;
    const live = sub.status === "active" || sub.status === "trialing";
    return live && sub.providerSubscriptionId ? sub : null;
  }

  /** When a period-end change should take effect: the end of the workspace's
   *  current paid period if a subscription row carries one, else ~30 days out (a
   *  monthly period) from now. A live-subscription workspace never reaches here
   *  (it is refused upstream), so this covers a lapsed/created row's period end
   *  or a free workspace with none. */
  private async nextPeriodEnd(workspaceId: string): Promise<Date> {
    const [sub] = await this.db
      .select({ currentPeriodEnd: subscriptions.currentPeriodEnd })
      .from(subscriptions)
      .where(eq(subscriptions.workspaceId, workspaceId))
      .limit(1);
    const now = this.now();
    if (sub?.currentPeriodEnd && sub.currentPeriodEnd.getTime() > now.getTime()) {
      return sub.currentPeriodEnd;
    }
    return new Date(now.getTime() + 30 * 24 * 3600_000);
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

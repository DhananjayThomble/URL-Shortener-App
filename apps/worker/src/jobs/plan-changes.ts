import {
  and,
  eq,
  isNull,
  lte,
  planChangeRequests,
  subscriptions,
  workspacePlanHistory,
  workspaces,
  type Database,
} from "@snapurl/database";

/* ============================================================
   #992 — apply due scheduled plan changes (billing 6/6).

   A workspace plan change the admin or owner set for "the end of the current
   period", and a comp that reverts on its end date, are written to
   plan_change_requests with an effectiveAt in the future. This job is the sweep
   that applies them once that instant passes: it moves the workspace's plan and
   writes a workspace_plan_history row, inside one transaction per request, and
   marks the request applied so it never fires twice.

   DB-only and self-contained, like billing-reconcile (#989): the worker depends
   on @snapurl/database alone, never on apps/api. The API's PlanManagementService
   has an equivalent applyDueChanges for the request/test path; this is the
   production entrypoint the worker runs on its maintenance timer.

   Idempotent: a request is claimed by flipping appliedAt from null to now inside
   the same transaction that applies it, so two concurrent workers never both
   apply the same row — the second claim updates zero rows and skips.

   Re-check at apply time (same rule as the admin path): if a workspace gained an
   ACTIVE or TRIALING provider subscription after the change was scheduled, a
   verified webhook now owns workspaces.plan, so applying a label move here would
   be silently undone. The sweep SKIPS such a request — it still claims the row
   (so it does not re-fire every pass) and records WHY in the history — rather
   than fighting the webhook.
   ============================================================ */

/** Display label for workspaces.plan from a plan key, matching the API's
 *  planLabelFromKey / BillingService.planLabel so the settings screen reads
 *  consistently however the plan moved. */
function planLabelFromKey(planKey: string): string {
  const k = planKey.trim();
  if (k.length === 0) return "Free";
  return k.charAt(0).toUpperCase() + k.slice(1).toLowerCase();
}

/** Whether a workspace has a provider subscription that OWNS its plan (active or
 *  trialing) — the states whose next webhook re-mirrors sub.planKey onto
 *  workspaces.plan. */
async function hasLiveProviderSubscription(db: Database, workspaceId: string): Promise<boolean> {
  const [sub] = await db
    .select({ status: subscriptions.status })
    .from(subscriptions)
    .where(eq(subscriptions.workspaceId, workspaceId))
    .limit(1);
  return !!sub && (sub.status === "active" || sub.status === "trialing");
}

/** Apply every due plan_change_request, returning how many were applied (a
 *  skipped request is claimed but not counted). */
export async function applyDuePlanChanges(db: Database, limit = 200): Promise<number> {
  const now = new Date();
  const due = await db
    .select()
    .from(planChangeRequests)
    .where(and(isNull(planChangeRequests.appliedAt), lte(planChangeRequests.effectiveAt, now)))
    .orderBy(planChangeRequests.effectiveAt)
    .limit(limit);

  let applied = 0;
  for (const req of due) {
    const liveSub = await hasLiveProviderSubscription(db, req.workspaceId);

    const didApply = await db.transaction(async (tx) => {
      const [claimed] = await tx
        .update(planChangeRequests)
        .set({ appliedAt: now, updatedAt: now })
        .where(and(eq(planChangeRequests.id, req.id), isNull(planChangeRequests.appliedAt)))
        .returning({ id: planChangeRequests.id });
      if (!claimed) return false;

      if (liveSub) {
        // Skip: a provider subscription now owns this workspace's plan. Record
        // why; do not move the label (the webhook would overwrite it anyway).
        await tx.insert(workspacePlanHistory).values({
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
          metadata: { skipped: true, requestKind: req.kind, requestedToPlanKey: req.toPlanKey },
          effectiveAt: now,
        });
        return false;
      }

      await tx
        .update(workspaces)
        .set({ plan: planLabelFromKey(req.toPlanKey), updatedAt: now })
        .where(eq(workspaces.id, req.workspaceId));

      await tx.insert(workspacePlanHistory).values({
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
        metadata: req.metadata as object | null,
        effectiveAt: req.effectiveAt,
      });
      return true;
    });
    if (didApply) applied += 1;
  }

  return applied;
}

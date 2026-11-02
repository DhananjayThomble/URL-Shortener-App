import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { writeAdminAuditEntry, type Database } from "@snapurl/database";
import type {
  AdminRefundResult,
  AdminRevenue,
  AdminRevenueRankRow,
  AdminSubscriptionList,
  AdminSubscriptionRow,
  AdminWorkspaceBillingEvents,
} from "@snapurl/contract";
import { DB } from "../../database/database.module.js";
import { BillingService } from "../../billing/billing.service.js";
import type { AdminActor } from "../admin-management.service.js";
import {
  ADMIN_BILLING_READER,
  type AdminBillingReader,
  type ActiveSubscriptionAmount,
} from "./admin-billing.reader.js";

/* ============================================================
   #989 — the admin billing views + the one admin billing WRITE (refund).

   The reads (subscriptions list, revenue headline, per-workspace events) go
   through AdminBillingReader off the read replica, with all the store-agnostic
   shaping here: MRR normalisation, churn rate, the active-by-plan tally. The
   reads do NOT audit, exactly like #973's analytics reads.

   The refund is the only write. It is admin-only (the controller is behind
   AdminGuard) and AUDITED: writeAdminAuditEntry records the actor, the payment,
   and the reason in the platform admin audit log, in the same transaction-free
   path the other admin management writes use. The provider call + the local
   status flip live in BillingService.refundPayment; this method wraps it with
   the audit entry and maps each outcome to an HTTP response. There is no
   self-serve refund — this surface is reachable only by a platform admin.
   ============================================================ */

/** A month in milliseconds, for normalising a yearly price to monthly MRR.
 *  A yearly subscription contributes 1/12 of its yearly amount each month. */
const MONTHS_PER_YEAR = 12;

@Injectable()
export class AdminBillingService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ADMIN_BILLING_READER) private readonly reader: AdminBillingReader,
    private readonly billing: BillingService,
  ) {}

  /** The subscriptions list: every subscription with its workspace, newest
   *  first. Dates are rendered ISO-8601; a null stays null. */
  async subscriptions(): Promise<AdminSubscriptionList> {
    const rows = await this.reader.allSubscriptions();
    const subscriptions: AdminSubscriptionRow[] = rows.map((r) => ({
      workspaceId: r.workspaceId,
      workspaceName: r.workspaceName,
      planKey: r.planKey as AdminSubscriptionRow["planKey"],
      interval: (r.interval as AdminSubscriptionRow["interval"]) ?? null,
      status: r.status as AdminSubscriptionRow["status"],
      currentPeriodEnd: iso(r.currentPeriodEnd),
      cancelAtPeriodEnd: iso(r.cancelAtPeriodEnd),
      graceEndsAt: iso(r.graceEndsAt),
      updatedAt: r.updatedAt.toISOString(),
    }));
    return { subscriptions };
  }

  /** The per-workspace billing-event history, newest first. The raw payloads
   *  stay in the table; this returns only the glanceable fields. */
  async workspaceEvents(workspaceId: string): Promise<AdminWorkspaceBillingEvents> {
    const rows = await this.reader.workspaceEvents(workspaceId);
    return {
      workspaceId,
      events: rows.map((e) => ({
        id: e.id,
        provider: e.provider,
        providerEventId: e.providerEventId,
        eventType: e.eventType,
        receivedAt: e.receivedAt.toISOString(),
        processedAt: iso(e.processedAt),
      })),
    };
  }

  /**
   * The revenue headline for the trailing `days`-day window (default 30).
   *
   * MRR is derived from the REAL captured amounts (the payments table), not a
   * hard-coded price table — a plan's price lives at the provider (#987 makes
   * it editable later), so the honest figure comes from what was actually
   * charged. Each entitled subscription contributes its latest captured amount,
   * normalised to monthly (yearly ÷ 12). A subscription with no captured
   * payment yet contributes 0 and is counted in `mrrUnpricedSubscriptions`, so
   * a gap is visible rather than silently dropping revenue.
   */
  async revenue(days = 30, now: Date = new Date()): Promise<AdminRevenue> {
    const end = now;
    const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

    const [amounts, churned, entitledAtStart, failed, inGrace] = await Promise.all([
      this.reader.entitledSubscriptionAmounts(now),
      this.reader.churnedInWindow(start, end),
      this.reader.entitledCountAt(start),
      this.reader.failedPaymentsInWindow(start, end),
      this.reader.inGraceCount(now),
    ]);

    const { mrr, currency, unpriced } = computeMrr(amounts);
    const activeByPlan = tallyByPlan(amounts);

    return {
      mrr: mrr.toString(),
      currency,
      mrrUnpricedSubscriptions: unpriced,
      activeSubscriptions: amounts.length,
      activeByPlan,
      churnedInWindow: churned,
      churnRate: entitledAtStart === 0 ? null : Math.round((churned / entitledAtStart) * 10000) / 10000,
      failedPaymentsInWindow: failed,
      inGrace,
    };
  }

  /**
   * Refund a payment, admin-only and audited.
   *
   * BillingService does the provider refund + the local status flip; this maps
   * the outcome (404 for an unknown payment, 400 for a non-captured or
   * already-refunded one) and, on success, records the before/after and the
   * reason in the admin audit log. The reason is required by the contract
   * (AdminRefundInput), so it is always present here.
   */
  async refund(paymentId: string, reason: string, actor: AdminActor): Promise<AdminRefundResult> {
    const result = await this.billing.refundPayment(paymentId);

    switch (result.outcome) {
      case "not_found":
        throw new NotFoundException("No such payment.");
      case "not_refundable":
        throw new BadRequestException("Only a captured payment can be refunded.");
      case "already_refunded":
        throw new BadRequestException("This payment has already been refunded.");
      case "refunded": {
        await writeAdminAuditEntry(this.db, {
          actorId: actor.admin.id,
          actorLabel: actor.admin.email,
          action: "admin.billing.refund",
          targetType: "payment",
          targetId: paymentId,
          before: { status: result.before.status, amount: result.before.amount, currency: result.before.currency },
          after: { status: "refunded", reason },
          requestIp: actor.ip,
        });
        return {
          paymentId,
          providerPaymentId: result.payment.providerPaymentId,
          status: "refunded",
        };
      }
    }
  }
}

/** Normalise a set of entitled subscriptions' latest captured amounts into a
 *  single monthly recurring figure in minor units, plus the currency and the
 *  count of unpriced subscriptions. Integer arithmetic throughout: a yearly
 *  amount is divided by 12 and floored, so MRR never becomes a float. */
function computeMrr(amounts: ActiveSubscriptionAmount[]): { mrr: number; currency: string | null; unpriced: number } {
  let mrr = 0;
  let currency: string | null = null;
  let unpriced = 0;
  for (const a of amounts) {
    if (a.latestCapturedAmount === null) {
      unpriced += 1;
      continue;
    }
    const amount = Number(a.latestCapturedAmount);
    if (!Number.isFinite(amount)) {
      unpriced += 1;
      continue;
    }
    currency ??= a.currency;
    mrr += a.interval === "yearly" ? Math.floor(amount / MONTHS_PER_YEAR) : amount;
  }
  return { mrr, currency, unpriced };
}

/** Count entitled subscriptions per plan key, largest first. */
function tallyByPlan(amounts: ActiveSubscriptionAmount[]): AdminRevenueRankRow[] {
  const counts = new Map<string, number>();
  for (const a of amounts) counts.set(a.planKey, (counts.get(a.planKey) ?? 0) + 1);
  return [...counts.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}

/** ISO-8601 or null, for a nullable timestamp column. */
function iso(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

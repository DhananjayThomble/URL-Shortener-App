import type { BillingInvoice, PlanKey, SubscriptionStatus, WorkspaceSubscription } from "@snapurl/contract";
import { formatMoney } from "./money";

/* ============================================================
   #988 — pure view helpers for the Settings → Billing screen.

   Kept out of the component so the plan/status/invoice copy is unit-tested
   directly (the component is covered by the E2E specs). Nothing here talks to
   the network or React.
   ============================================================ */

/** A plan key as a person-facing label. `free` is "Free"; the paid keys are
 *  title-cased. */
export function planLabel(planKey: PlanKey): string {
  return planKey.charAt(0).toUpperCase() + planKey.slice(1);
}

/** Whether the workspace currently holds a paid plan (entitled). The free shape
 *  and any lapsed status read as not-paid. */
export function isPaid(sub: WorkspaceSubscription): boolean {
  return sub.planKey !== "free" && (sub.status === "active" || sub.status === "trialing");
}

type Tone = "good" | "warn" | "bad" | "default" | "accent";

/** A short, person-facing description of the subscription status, with a chip
 *  tone. Covers the paid states, the pending-cancellation case, and the lapsed
 *  states an owner needs to see honestly (a failed charge is not hidden). */
export function statusView(sub: WorkspaceSubscription): { label: string; tone: Tone } {
  if (sub.cancelAtPeriodEnd && isPaid(sub)) {
    return { label: "Cancels at period end", tone: "warn" };
  }
  const byStatus: Partial<Record<SubscriptionStatus, { label: string; tone: Tone }>> = {
    active: { label: "Active", tone: "good" },
    trialing: { label: "Trial", tone: "accent" },
    past_due: { label: "Payment past due", tone: "bad" },
    halted: { label: "Paused — payment failed", tone: "bad" },
    cancelled: { label: "Cancelled", tone: "default" },
    completed: { label: "Ended", tone: "default" },
    expired: { label: "Expired", tone: "default" },
    created: { label: "Checkout not completed", tone: "warn" },
    authenticated: { label: "Confirming payment…", tone: "warn" },
  };
  if (sub.status && byStatus[sub.status]) return byStatus[sub.status]!;
  return { label: "Free plan", tone: "default" };
}

/** The invoice amount (stored in the currency's MINOR unit — paise / cents)
 *  formatted in its own currency. Divides by 100 for two-decimal currencies,
 *  which is the whole set the app offers (see money.ts). */
export function invoiceAmount(inv: Pick<BillingInvoice, "amount" | "currency">): string {
  return formatMoney(inv.amount / 100, inv.currency);
}

/** A person-facing label for an invoice status. */
export function invoiceStatusLabel(status: BillingInvoice["status"]): string {
  switch (status) {
    case "paid":
      return "Paid";
    case "issued":
      return "Issued";
    case "partially_paid":
      return "Partially paid";
    case "cancelled":
      return "Cancelled";
    case "expired":
      return "Expired";
  }
}

"use client";

import { useState } from "react";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  Field,
  Segmented,
  Skeleton,
} from "@/components/ui";
import {
  BILLING_OFF,
  PAID_PLANS,
  useCancelSubscription,
  useChangePlan,
  useInvoices,
  useMe,
  useStartCheckout,
  useSubscription,
} from "@/lib/api/hooks";
import { invoiceAmount, invoiceStatusLabel, isPaid, planLabel, statusView } from "@/lib/billing";
import { openRazorpayCheckout } from "@/lib/razorpay-checkout";
import { formatDate } from "@/lib/utils";
import type { BillingInterval, CheckoutSession, PaidPlanKey } from "@snapurl/contract";

/* ============================================================
   #988 — Settings → Billing.

   The owner manages their plan here: see the current plan, renewal date and
   status; upgrade from Free; change between paid plans (upgrade now / downgrade
   at period end); cancel at period end; and download Razorpay invoices.

   HIDDEN WHEN BILLING IS OFF: the whole surface 404s on a `none` build (#986),
   so useSubscription resolves to BILLING_OFF and this component renders null —
   no card, no heading, nothing. HIDDEN FOR NON-OWNERS: billing is owner-only
   (@Roles("owner")), so a non-owner never even asks (the queries are disabled)
   and the card is not shown.

   A plan change / cancel NEVER moves the plan here — the API asks the provider
   and the verified webhook is what actually switches it. So after an action the
   screen shows the pending state (e.g. "Cancels at period end") and re-reads;
   it does not pretend the plan changed instantly.
   ============================================================ */

export function BillingCard() {
  const me = useMe();
  const isOwner = me.data?.role === "owner";
  // Owner-only: a non-owner never asks (the API would 403), so the card hides.
  const subQuery = useSubscription({ enabled: isOwner });
  const invoicesQuery = useInvoices({ enabled: isOwner });
  const startCheckout = useStartCheckout();
  const changePlan = useChangePlan();
  const cancel = useCancelSubscription();

  const [interval, setInterval] = useState<BillingInterval>("monthly");
  const [busyPlan, setBusyPlan] = useState<PaidPlanKey | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // Not an owner → nothing to show. (me still loading also hides it, since the
  // section is irrelevant until we know the role.)
  if (!isOwner) return null;

  // Billing off on this deployment → render nothing at all.
  if (subQuery.data === BILLING_OFF) return null;

  // While the first read is in flight, a skeleton in a card so the layout is
  // stable; a hard failure (not a 404) shows a short message rather than a
  // blank space.
  if (subQuery.isLoading) {
    return (
      <Card>
        <CardHeader title="Billing" />
        <CardBody>
          <Skeleton className="h-[160px]" />
        </CardBody>
      </Card>
    );
  }
  if (subQuery.isError || !subQuery.data) {
    return (
      <Card>
        <CardHeader title="Billing" />
        <CardBody className="text-[13px] text-ink-2">
          Couldn&apos;t load billing just now. Reload to try again.
        </CardBody>
      </Card>
    );
  }

  const sub = subQuery.data;
  const paid = isPaid(sub);
  const status = statusView(sub);
  const invoices = invoicesQuery.data === BILLING_OFF ? [] : invoicesQuery.data ?? [];

  async function upgradeOrChange(planKey: PaidPlanKey) {
    setProblem(null);
    setBusyPlan(planKey);
    try {
      if (paid) {
        // Already on a paid plan → change (server decides now vs cycle end).
        await changePlan.mutateAsync({ planKey, interval });
      } else {
        // On Free → start a checkout and hand the session to Razorpay Checkout.
        const session: CheckoutSession = await startCheckout.mutateAsync({ planKey, interval });
        await openRazorpayCheckout(session);
        // The plan activates on the verified webhook; re-read so the status
        // reflects the provider once it confirms.
        void subQuery.refetch();
      }
    } catch (err) {
      setProblem((err as Error).message);
    } finally {
      setBusyPlan(null);
    }
  }

  async function doCancel() {
    setProblem(null);
    try {
      await cancel.mutateAsync();
      setConfirmingCancel(false);
    } catch (err) {
      setProblem((err as Error).message);
      setConfirmingCancel(false);
    }
  }

  return (
    <Card id="billing">
      <CardHeader
        title="Billing"
        right={<Chip tone={status.tone} dot>{status.label}</Chip>}
      />
      <CardBody className="flex flex-col gap-3.5">
        {/* Current plan + renewal */}
        <div className="flex justify-between items-baseline">
          <span className="text-[12.5px] text-ink-3">Current plan</span>
          <b className="text-ink text-[15px]" data-testid="billing-current-plan">
            {planLabel(sub.planKey)}
            {sub.interval ? <span className="text-ink-3 font-normal text-[12px]"> · {sub.interval}</span> : null}
          </b>
        </div>
        {sub.currentPeriodEnd ? (
          <div className="flex justify-between items-baseline">
            <span className="text-[12.5px] text-ink-3">
              {sub.cancelAtPeriodEnd ? "Access until" : "Renews"}
            </span>
            <span className="text-ink-2 text-[13px]" data-testid="billing-renewal">
              {formatDate(sub.currentPeriodEnd)}
            </span>
          </div>
        ) : null}

        {/* #988 — a requested plan change the provider has not confirmed yet.
            The current plan above is still what the workspace is entitled to;
            this only says a switch is in flight (it lands on the next charge
            for an upgrade, or at the period end for a downgrade). */}
        {sub.pendingChange ? (
          <div
            className="px-[13px] py-[9px] bg-accent-wash rounded-[var(--radius-sm)] text-[12.5px] text-accent leading-[1.5]"
            data-testid="billing-pending-change"
          >
            Changing to <b>{planLabel(sub.pendingChange.planKey)}</b> ({sub.pendingChange.interval}). This takes effect
            once your next payment confirms it.
          </div>
        ) : null}

        {problem ? (
          <p role="alert" className="m-0 text-[12.5px] text-bad">{problem}</p>
        ) : null}

        {/* Billing interval toggle, shared by upgrade and change. */}
        <Field label="Billing interval" controlId="billing-interval">
          <Segmented<BillingInterval>
            id="billing-interval"
            aria-label="Billing interval"
            value={interval}
            onChange={setInterval}
            options={[
              { value: "monthly", label: "Monthly" },
              { value: "yearly", label: "Yearly" },
            ]}
          />
        </Field>

        {/* Plans. On Free these are "Upgrade"; on a paid plan the current one is
            marked and the rest offer "Change". */}
        <div className="flex flex-col gap-2" data-testid="billing-plans">
          {PAID_PLANS.map((plan) => {
            const isCurrent = paid && sub.planKey === plan.key;
            return (
              <div
                key={plan.key}
                className="flex items-center justify-between gap-3 px-[13px] py-[11px] bg-surface-2 rounded-[var(--radius-sm)] border border-line-2"
              >
                <div className="min-w-0">
                  <div className="text-[13.5px] font-semibold text-ink">{plan.label}</div>
                  <div className="text-[12px] text-ink-3 leading-[1.5]">{plan.blurb}</div>
                </div>
                {isCurrent ? (
                  <Chip tone="accent">Current</Chip>
                ) : (
                  <Button
                    size="sm"
                    variant={paid ? "ghost" : "primary"}
                    aria-label={`${paid ? "Change to" : "Upgrade to"} ${plan.label}`}
                    disabled={busyPlan !== null}
                    onClick={() => upgradeOrChange(plan.key)}
                  >
                    {busyPlan === plan.key ? "Working…" : paid ? "Change" : "Upgrade"}
                  </Button>
                )}
              </div>
            );
          })}
        </div>

        {/* Cancel at period end — only when on a paid plan and not already
            pending cancellation. */}
        {paid && !sub.cancelAtPeriodEnd ? (
          confirmingCancel ? (
            <div className="flex flex-col gap-2 px-[13px] py-[11px] bg-surface-3 rounded-[var(--radius-sm)]">
              <p className="m-0 text-[12.5px] text-ink-2 leading-[1.55]">
                Your plan stays active until {sub.currentPeriodEnd ? formatDate(sub.currentPeriodEnd) : "the period end"}
                . Your links keep working after that — cancelling never breaks a link.
              </p>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => setConfirmingCancel(false)}>Keep my plan</Button>
                <Button size="sm" variant="danger" disabled={cancel.isPending} onClick={doCancel}>
                  {cancel.isPending ? "Cancelling…" : "Cancel at period end"}
                </Button>
              </div>
            </div>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="self-start"
              onClick={() => { setConfirmingCancel(true); setProblem(null); }}
            >
              Cancel subscription
            </Button>
          )
        ) : null}

        {/* Invoices */}
        <div className="flex flex-col gap-2">
          <div className="text-[12.5px] text-ink-3">Invoices</div>
          {invoicesQuery.isLoading ? (
            <Skeleton className="h-[60px]" />
          ) : invoices.length === 0 ? (
            <p className="m-0 text-[12.5px] text-ink-3">No invoices yet.</p>
          ) : (
            <ul className="m-0 p-0 list-none flex flex-col" data-testid="billing-invoices">
              {invoices.map((inv) => (
                <li
                  key={inv.id}
                  className="flex items-center justify-between gap-3 py-[8px] border-b border-line last:border-b-0 text-[12.5px]"
                >
                  <span className="text-ink-2">
                    {formatDate(inv.createdAt)}
                    <span className="text-ink-3"> · {invoiceStatusLabel(inv.status)}</span>
                  </span>
                  <span className="flex items-center gap-3">
                    <b className="text-ink font-mono tnum">{invoiceAmount(inv)}</b>
                    {inv.pdfUrl ? (
                      <a
                        href={inv.pdfUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-accent hover:underline"
                        aria-label={`Download invoice from ${formatDate(inv.createdAt)}`}
                      >
                        Download
                      </a>
                    ) : (
                      <span className="text-ink-3">—</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

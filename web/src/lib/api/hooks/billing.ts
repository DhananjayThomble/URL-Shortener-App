"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BillingInvoiceList,
  CheckoutSession,
  WorkspaceSubscription,
  type ChangePlanInput,
  type PaidPlanKey,
  type StartCheckoutInput,
} from "@snapurl/contract";
import { ApiError, request } from "../client";

/* ============================================================
   #988 — the owner's billing data hooks.

   "Hidden entirely when billing is off" is made STRUCTURAL here rather than
   gated on a separate flag: the whole billing surface 404s when the API runs
   with BILLING_PROVIDER=none (#986's BillingEnabledGuard). So the hooks treat a
   404 as "billing is disabled on this deployment" and resolve to BILLING_OFF —
   a sentinel the Settings → Billing card reads to render nothing at all. No
   extra endpoint, no flag that can drift from the API's real reachability.

   Every route here is owner-only (@Roles("owner") on the controller), so a
   non-owner gets a 403 the same way they would for any owner-gated screen; the
   Settings card also hides the section for a non-owner before it ever asks, so
   the 403 is a backstop, not the normal path.
   ============================================================ */

/** The sentinel a billing query resolves to when billing is off (the API 404s
 *  the whole surface). Distinct from `null`/`undefined` so "off" is explicit. */
export const BILLING_OFF = "billing-off" as const;
export type BillingOff = typeof BILLING_OFF;

const qkBilling = {
  subscription: ["billing", "subscription"] as const,
  invoices: ["billing", "invoices"] as const,
};

/** True when an error is the API saying billing is disabled on this deploy. */
function isBillingDisabled(err: unknown): boolean {
  return err instanceof ApiError && err.status === 404;
}

/**
 * The workspace's subscription, or BILLING_OFF when billing is disabled.
 *
 * A 404 is swallowed into the BILLING_OFF sentinel (not thrown) because it is
 * the expected answer on a self-hosted / `none` build — not an error to
 * surface. Any other failure (a real outage, a 403 for a non-owner) propagates
 * as usual. `enabled` lets the Settings card skip the request entirely for a
 * non-owner.
 */
export function useSubscription(opts: { enabled?: boolean } = {}) {
  return useQuery<WorkspaceSubscription | BillingOff>({
    queryKey: qkBilling.subscription,
    enabled: opts.enabled ?? true,
    retry: (count, err) => !isBillingDisabled(err) && count < 2,
    queryFn: async () => {
      try {
        return await request("/billing/subscription", WorkspaceSubscription);
      } catch (err) {
        if (isBillingDisabled(err)) return BILLING_OFF;
        throw err;
      }
    },
  });
}

/** The workspace's invoices, or BILLING_OFF when billing is disabled. */
export function useInvoices(opts: { enabled?: boolean } = {}) {
  return useQuery<BillingInvoiceList | BillingOff>({
    queryKey: qkBilling.invoices,
    enabled: opts.enabled ?? true,
    retry: (count, err) => !isBillingDisabled(err) && count < 2,
    queryFn: async () => {
      try {
        return await request("/billing/invoices", BillingInvoiceList);
      } catch (err) {
        if (isBillingDisabled(err)) return BILLING_OFF;
        throw err;
      }
    },
  });
}

/**
 * Start a checkout for a paid plan. Returns the CheckoutSession the browser
 * opens Razorpay Checkout with — it does NOT activate the plan (the verified
 * webhook does). The caller hands the result to Razorpay Checkout.js.
 */
export function useStartCheckout() {
  return useMutation({
    mutationFn: (input: StartCheckoutInput) =>
      request("/billing/checkout", CheckoutSession, { method: "POST", body: input }),
  });
}

/**
 * Change between paid plans. The server derives the timing (upgrade now,
 * downgrade at cycle end); the plan moves on the verified webhook, so the
 * returned subscription may still show the old plan until it arrives — the
 * query is invalidated so the page re-reads.
 */
export function useChangePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ChangePlanInput) =>
      request("/billing/change", WorkspaceSubscription, { method: "POST", body: input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qkBilling.subscription });
      void qc.invalidateQueries({ queryKey: qkBilling.invoices });
    },
  });
}

/**
 * Schedule the subscription to end at the period end. The plan stays live until
 * then (and only the verified cancellation webhook actually lapses it), so the
 * returned subscription reflects the pending cancellation, not an immediate
 * downgrade.
 */
export function useCancelSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      request("/billing/cancel", WorkspaceSubscription, { method: "POST", body: { atPeriodEnd: true } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qkBilling.subscription }),
  });
}

/** The paid plans offered in the app, in upgrade order. Labelled here for the
 *  UI; the price lives with the provider (#986), so nothing here carries an
 *  amount. */
export const PAID_PLANS: ReadonlyArray<{ key: PaidPlanKey; label: string; blurb: string }> = [
  { key: "starter", label: "Starter", blurb: "Custom domains and a higher cap for a growing workspace." },
  { key: "pro", label: "Pro", blurb: "Everything in Starter, plus the full analytics history and team seats." },
  { key: "team", label: "Team", blurb: "Pro for the whole team, with priority support." },
];

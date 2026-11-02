import { eq, inArray, subscriptions, type Database } from "@snapurl/database";

/* ============================================================
   #989 — the daily billing reconciliation job.

   Local subscription state is moved only by verified webhooks (#986). Webhooks
   can be missed — a delivery that never arrived, a window where the endpoint
   was down past Razorpay's retry budget — and then the local row drifts from
   the provider's truth: a subscription Razorpay has cancelled still reads
   active locally, or vice versa. This job is the safety net: once a day it asks
   the provider for the real status of each subscription it is tracking and
   FLAGS every row that disagrees.

   It only FLAGS (logs + returns the mismatches); it does NOT silently "fix" the
   local row, because a webhook is the single source of truth for a plan change
   (#986's invariant) and a reconciliation pass quietly flipping a plan would be
   a second mover. A flagged mismatch is for an operator to investigate (and, if
   real, replay the missed webhook), not for this job to paper over.

   The provider read is behind the ProviderStatusSource seam, so the job is
   tested with a fake and CI needs no real key or network — the same shape as
   the Safe Browsing scanner and the domain-blocklist lookup in this worker.
   ============================================================ */

/** The subscription statuses that map to a provider-side lifecycle we can read
 *  back. Mirrors the SUBSCRIPTION_STATUSES contract; kept as a plain string on
 *  the wire since the provider is the authority. */
export type ProviderStatus = string;

/**
 * Reads a subscription's CURRENT status from the provider, by its provider
 * subscription id. Returns the provider's status string, or null when the
 * provider has no such subscription (itself a mismatch worth flagging — a local
 * row pointing at a subscription the provider does not know).
 */
export type ProviderStatusSource = (providerSubscriptionId: string) => Promise<ProviderStatus | null>;

/** One row whose local status disagrees with the provider's. */
export interface ReconcileMismatch {
  subscriptionId: string;
  workspaceId: string;
  providerSubscriptionId: string;
  localStatus: string;
  /** The provider's status, or null when the provider does not know the sub. */
  providerStatus: ProviderStatus | null;
}

export interface ReconcileResult {
  /** Subscriptions checked (those with a provider subscription id). */
  checked: number;
  /** The mismatches found — the thing the operator acts on. */
  mismatches: ReconcileMismatch[];
}

/** How a mismatch is surfaced. The worker logs it at warn and (in production)
 *  can forward to an alert sink; the default sink is injected so the job itself
 *  stays pure and testable. */
export type ReconcileAlert = (mismatch: ReconcileMismatch) => void | Promise<void>;

export interface ReconcileOptions {
  /** Reads the provider's status for a subscription id. */
  providerStatus: ProviderStatusSource;
  /** Called once per mismatch. Defaults to a no-op; the worker passes a logger. */
  alert?: ReconcileAlert;
  /** Only reconcile subscriptions in these local statuses. Defaults to the ones
   *  worth checking: a `created` row that never activated is not drift. */
  statuses?: string[];
}

/** The local statuses reconciled by default: anything that claims (or recently
 *  claimed) a live plan. A never-activated `created` row is excluded — it has
 *  no provider lifecycle to disagree with yet. */
const DEFAULT_RECONCILED_STATUSES = [
  "authenticated",
  "active",
  "trialing",
  "past_due",
  "halted",
  "cancelled",
];

/**
 * Compare every tracked local subscription against the provider and flag the
 * ones that disagree. Reads only subscriptions that have a provider
 * subscription id and sit in a reconciled status; for each, fetches the
 * provider status and records a mismatch when it differs (including when the
 * provider does not know the subscription at all).
 *
 * Pure except for the injected `providerStatus` read and the `alert` sink, so a
 * test seeds a local row whose provider status differs and asserts the mismatch
 * is flagged, with no network and no clock.
 */
export async function reconcileBilling(db: Database, opts: ReconcileOptions): Promise<ReconcileResult> {
  const statuses = opts.statuses ?? DEFAULT_RECONCILED_STATUSES;
  const alert = opts.alert ?? (() => {});

  const rows = await db
    .select({
      id: subscriptions.id,
      workspaceId: subscriptions.workspaceId,
      providerSubscriptionId: subscriptions.providerSubscriptionId,
      status: subscriptions.status,
    })
    .from(subscriptions)
    .where(inArray(subscriptions.status, statuses));

  const mismatches: ReconcileMismatch[] = [];
  let checked = 0;

  for (const row of rows) {
    // A row in a reconciled status with no provider id is a local-only artifact
    // (should not happen once activated); skip it rather than calling the
    // provider with an empty id.
    if (!row.providerSubscriptionId) continue;
    checked += 1;

    const providerStatus = await opts.providerStatus(row.providerSubscriptionId);
    if (providerStatus !== row.status) {
      const mismatch: ReconcileMismatch = {
        subscriptionId: row.id,
        workspaceId: row.workspaceId,
        providerSubscriptionId: row.providerSubscriptionId,
        localStatus: row.status,
        providerStatus,
      };
      mismatches.push(mismatch);
      await alert(mismatch);
    }
  }

  return { checked, mismatches };
}

/**
 * A ProviderStatusSource backed by the real Razorpay SDK — the only place in
 * the worker that imports it, so the job's logic (reconcileBilling) stays
 * SDK-free and testable with a fake. Fetches the subscription and returns its
 * provider status string; a 404 (the provider does not know the id) is mapped
 * to null, which reconcileBilling treats as a mismatch. Any other read error is
 * re-thrown so the maintenance pass logs a reconciliation failure rather than
 * silently reporting "no mismatches".
 *
 * The SDK is constructed with the key id + SECRET, held only here and never
 * returned or logged. Imported dynamically so the SDK is loaded only when
 * reconciliation is actually configured (BILLING_PROVIDER=razorpay with a key).
 */
export async function makeRazorpayStatusSource(keyId: string, keySecret: string): Promise<ProviderStatusSource> {
  const { default: Razorpay } = await import("razorpay");
  const rzp = new Razorpay({ key_id: keyId, key_secret: keySecret });
  return async (providerSubscriptionId: string): Promise<ProviderStatus | null> => {
    try {
      const sub = (await rzp.subscriptions.fetch(providerSubscriptionId)) as { status?: string };
      return typeof sub.status === "string" ? sub.status : null;
    } catch (err) {
      // Razorpay throws for an unknown subscription; treat a not-found as null
      // (a flag-worthy mismatch), and re-throw anything else.
      const statusCode = (err as { statusCode?: number }).statusCode;
      if (statusCode === 400 || statusCode === 404) return null;
      throw err;
    }
  };
}

/** Exported for a caller that wants to re-read a single row after a flagged
 *  mismatch (e.g. to confirm it is still live before acting). Not used by the
 *  pass itself, which reads in bulk above. */
export async function readSubscriptionStatus(db: Database, subscriptionId: string): Promise<string | null> {
  const [row] = await db
    .select({ status: subscriptions.status })
    .from(subscriptions)
    .where(eq(subscriptions.id, subscriptionId))
    .limit(1);
  return row?.status ?? null;
}

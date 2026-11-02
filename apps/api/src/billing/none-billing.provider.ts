import type {
  BillingProvider,
  BillingProviderName,
  CheckoutResult,
  CreateCheckoutParams,
  NormalizedBillingEvent,
} from "./billing-provider.js";

/* ============================================================
   #986 — the no-op billing provider, and the DEFAULT.

   With BILLING_PROVIDER=none this is what the app runs with: billing is off,
   `enabled` is false, and the controller keeps every billing route unreachable
   (404) by reading that flag. The write methods are never reached when the
   routes 404, but they throw rather than silently succeeding so that any future
   caller that reaches one is told plainly, and verifyWebhook returns null —
   nothing can ever move a plan while billing is off.

   This is the self-hoster / open-source build's behaviour, byte-identical to
   before billing existed.
   ============================================================ */

export class NoneBillingProvider implements BillingProvider {
  readonly name: BillingProviderName = "none";
  readonly enabled = false;

  async createCheckout(_params: CreateCheckoutParams): Promise<CheckoutResult> {
    throw new Error("Billing is disabled (BILLING_PROVIDER=none).");
  }

  async cancel(_providerSubscriptionId: string, _atPeriodEnd: boolean): Promise<void> {
    throw new Error("Billing is disabled (BILLING_PROVIDER=none).");
  }

  async refund(_providerPaymentId: string): Promise<void> {
    throw new Error("Billing is disabled (BILLING_PROVIDER=none).");
  }

  /** Always null: with billing off, no webhook can ever verify, so no plan can
   *  ever move. */
  verifyWebhook(_rawBody: string, _signature: string | undefined): NormalizedBillingEvent | null {
    return null;
  }
}

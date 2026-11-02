import type { CheckoutSession } from "@snapurl/contract";

/* ============================================================
   #988 — hand a started checkout to Razorpay Checkout.js.

   The browser opens Razorpay's hosted checkout with the PUBLIC key id and the
   provider subscription id from CheckoutSession (#986) — never a secret, never
   a card number (Razorpay collects the card on its own surface). The payment
   result the browser sees activates NOTHING: a workspace's plan only moves when
   the verified webhook arrives server-side. So this helper's job ends when the
   modal is opened; it does not trust any client-side "success" to change state.

   Checkout.js is loaded lazily from Razorpay's CDN on first use, so the script
   is not pulled into every page. The helper is a thin, SSR-safe seam that the
   E2E specs stub (window.Razorpay) — they assert the checkout POST happened and
   that the right subscription id reached Checkout, without a real Razorpay.
   ============================================================ */

const CHECKOUT_SRC = "https://checkout.razorpay.com/v1/checkout.js";

/** The minimal Razorpay Checkout global surface this uses. */
interface RazorpayCheckoutCtor {
  new (options: Record<string, unknown>): { open(): void };
}
declare global {
  interface Window {
    Razorpay?: RazorpayCheckoutCtor;
  }
}

let loader: Promise<void> | null = null;

/** Load Checkout.js once. Resolves immediately if it is already present (the
 *  E2E stub sets window.Razorpay, so no network happens under test). */
function loadCheckoutScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("Checkout is only available in the browser."));
  if (window.Razorpay) return Promise.resolve();
  if (loader) return loader;
  loader = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${CHECKOUT_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Couldn't load the payment form.")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = CHECKOUT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      loader = null; // let a later attempt retry the load
      reject(new Error("Couldn't load the payment form."));
    };
    document.head.appendChild(script);
  });
  return loader;
}

/**
 * Open Razorpay Checkout for a started subscription checkout. Resolves once the
 * modal has been opened (not once payment completes — that is the webhook's
 * job). Rejects when Checkout.js cannot be loaded or constructed.
 */
export async function openRazorpayCheckout(session: CheckoutSession): Promise<void> {
  await loadCheckoutScript();
  const Ctor = typeof window !== "undefined" ? window.Razorpay : undefined;
  if (!Ctor) throw new Error("The payment form is unavailable. Try again in a moment.");
  const checkout = new Ctor({
    key: session.keyId,
    subscription_id: session.subscriptionId,
    name: "SnapURL",
    description: `${session.planKey} (${session.interval})`,
    // No handler that activates anything — the verified webhook moves the plan.
  });
  checkout.open();
}

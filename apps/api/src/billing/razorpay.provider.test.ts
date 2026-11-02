import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  BillingProviderError,
  classifyRazorpayError,
  PlanNotConfiguredError,
  RazorpayBillingProvider,
  statusForEvent,
  trialStatusFromEntity,
  type RazorpayClient,
} from "./razorpay.provider.js";
import { parsePlanIds } from "./billing-plans.js";
import { NoneBillingProvider } from "./none-billing.provider.js";

/* #986 — the security-critical path and the provider seam, with no DB and no
   network. Oracles are the issue's acceptance lines:
     - "a forged or replayed webhook is rejected" — a body re-signed with the
       wrong secret, a tampered body under a good signature, and a missing
       signature all return null from verifyWebhook;
     - "only a verified webhook" — a correct HMAC over the exact bytes verifies
       and normalises; nothing else does;
     - "with BILLING_PROVIDER=none nothing is reachable" — NoneBillingProvider
       is disabled, verifies nothing, and throws on every write.
   These use OBVIOUSLY FAKE low-entropy fixture secrets, never a real key. */

// Low-entropy, obviously-fake fixture secrets. Not real Razorpay credentials.
const FAKE_WEBHOOK_SECRET = "whsec_test_fake_0000";
const FAKE_KEY_ID = "rzp_test_fake_0000";
const FAKE_KEY_SECRET = "keysec_test_fake_0000";

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body, "utf8").digest("hex");
}

function makeProvider(client?: Partial<RazorpayClient>, planIds = "pro:monthly=plan_fake_pro_m,pro:yearly=plan_fake_pro_y") {
  const fakeClient: RazorpayClient = {
    createSubscription: vi.fn(async () => ({ id: "sub_fake_created" })),
    cancelSubscription: vi.fn(async () => {}),
    updateSubscription: vi.fn(async () => {}),
    listInvoices: vi.fn(async () => []),
    refundPayment: vi.fn(async () => {}),
    ...client,
  };
  const provider = new RazorpayBillingProvider(
    {
      keyId: FAKE_KEY_ID,
      keySecret: FAKE_KEY_SECRET,
      webhookSecret: FAKE_WEBHOOK_SECRET,
      planIds: parsePlanIds(planIds),
    },
    fakeClient,
  );
  return { provider, fakeClient };
}

const SUBSCRIPTION_CHARGED = JSON.stringify({
  id: "evt_fake_charged_1",
  event: "subscription.charged",
  payload: { subscription: { entity: { id: "sub_fake_created", current_end: 1_800_000_000 } } },
});

describe("RazorpayBillingProvider.verifyWebhook — the signature gate", () => {
  it("verifies and normalises a correctly-signed event", () => {
    const { provider } = makeProvider();
    const sig = sign(SUBSCRIPTION_CHARGED, FAKE_WEBHOOK_SECRET);
    const event = provider.verifyWebhook(SUBSCRIPTION_CHARGED, sig);
    expect(event).not.toBeNull();
    expect(event!.eventId).toBe("evt_fake_charged_1");
    expect(event!.eventType).toBe("subscription.charged");
    expect(event!.providerSubscriptionId).toBe("sub_fake_created");
    expect(event!.status).toBe("active");
    expect(event!.currentPeriodEnd).toEqual(new Date(1_800_000_000 * 1000));
  });

  it("rejects a FORGED event signed with the wrong secret", () => {
    const { provider } = makeProvider();
    const forged = sign(SUBSCRIPTION_CHARGED, "whsec_attacker_guess_9999");
    expect(provider.verifyWebhook(SUBSCRIPTION_CHARGED, forged)).toBeNull();
  });

  it("rejects a TAMPERED body under an otherwise-valid signature", () => {
    const { provider } = makeProvider();
    // Attacker keeps a legitimately-signed signature but swaps the body to
    // activate a different subscription. The HMAC no longer matches the bytes.
    const sig = sign(SUBSCRIPTION_CHARGED, FAKE_WEBHOOK_SECRET);
    const tampered = SUBSCRIPTION_CHARGED.replace("sub_fake_created", "sub_attacker_owned");
    expect(provider.verifyWebhook(tampered, sig)).toBeNull();
  });

  it("rejects a missing signature header", () => {
    const { provider } = makeProvider();
    expect(provider.verifyWebhook(SUBSCRIPTION_CHARGED, undefined)).toBeNull();
    expect(provider.verifyWebhook(SUBSCRIPTION_CHARGED, "")).toBeNull();
  });

  it("rejects a signature of the wrong length without throwing (timingSafeEqual guard)", () => {
    const { provider } = makeProvider();
    expect(provider.verifyWebhook(SUBSCRIPTION_CHARGED, "deadbeef")).toBeNull();
  });

  it("rejects a correctly-signed body that is not valid JSON", () => {
    const { provider } = makeProvider();
    const notJson = "this is not json";
    const sig = sign(notJson, FAKE_WEBHOOK_SECRET);
    expect(provider.verifyWebhook(notJson, sig)).toBeNull();
  });

  it("rejects a signed body with no event type", () => {
    const { provider } = makeProvider();
    const noEvent = JSON.stringify({ id: "evt_x", payload: {} });
    expect(provider.verifyWebhook(noEvent, sign(noEvent, FAKE_WEBHOOK_SECRET))).toBeNull();
  });

  it("returns null when the webhook secret is not configured", () => {
    const provider = new RazorpayBillingProvider(
      { keyId: FAKE_KEY_ID, keySecret: FAKE_KEY_SECRET, webhookSecret: undefined, planIds: new Map() },
      { createSubscription: vi.fn(), cancelSubscription: vi.fn(), refundPayment: vi.fn() } as unknown as RazorpayClient,
    );
    expect(provider.verifyWebhook(SUBSCRIPTION_CHARGED, sign(SUBSCRIPTION_CHARGED, FAKE_WEBHOOK_SECRET))).toBeNull();
  });

  it("falls back to a deterministic event id when the body has none", () => {
    const { provider } = makeProvider();
    const noId = JSON.stringify({ event: "subscription.charged", payload: {} });
    const a = provider.verifyWebhook(noId, sign(noId, FAKE_WEBHOOK_SECRET));
    const b = provider.verifyWebhook(noId, sign(noId, FAKE_WEBHOOK_SECRET));
    expect(a).not.toBeNull();
    // Same id-less body → same fallback id (so a replay still dedupes)…
    expect(a!.eventId).toBe(b!.eventId);
    expect(a!.eventId.startsWith("sha256:")).toBe(true);
    // …but a DIFFERENT id-less body → a different id (no empty-string collision).
    const other = JSON.stringify({ event: "subscription.halted", payload: {} });
    const c = provider.verifyWebhook(other, sign(other, FAKE_WEBHOOK_SECRET));
    expect(c!.eventId).not.toBe(a!.eventId);
  });
});

describe("statusForEvent — event type → lifecycle status", () => {
  it("maps the active-making events to active", () => {
    expect(statusForEvent("subscription.activated")).toBe("active");
    expect(statusForEvent("subscription.charged")).toBe("active");
    expect(statusForEvent("subscription.resumed")).toBe("active");
  });

  it("maps the lapsing events to their own status", () => {
    expect(statusForEvent("subscription.authenticated")).toBe("authenticated");
    expect(statusForEvent("subscription.pending")).toBe("past_due");
    expect(statusForEvent("subscription.halted")).toBe("halted");
    expect(statusForEvent("subscription.cancelled")).toBe("cancelled");
    expect(statusForEvent("subscription.completed")).toBe("completed");
    expect(statusForEvent("subscription.expired")).toBe("expired");
  });

  it("maps a payment-only / unknown event to null (moves no plan)", () => {
    expect(statusForEvent("payment.captured")).toBeNull();
    expect(statusForEvent("something.else")).toBeNull();
  });
});

describe("#992 — trialStatusFromEntity: the provider's trial window → trialing", () => {
  const now = new Date("2026-06-01T00:00:00.000Z");
  const futureChargeAt = Math.floor(new Date("2026-06-15T00:00:00.000Z").getTime() / 1000);
  const pastChargeAt = Math.floor(new Date("2026-05-15T00:00:00.000Z").getTime() / 1000);

  it("is trialing when the entity is authenticated with a FUTURE first charge", () => {
    expect(trialStatusFromEntity({ status: "authenticated", charge_at: futureChargeAt }, now)).toBe("trialing");
  });

  it("is NOT trialing once the first charge is in the past (trial ended)", () => {
    expect(trialStatusFromEntity({ status: "authenticated", charge_at: pastChargeAt }, now)).toBeNull();
  });

  it("is NOT trialing for an active or non-authenticated entity", () => {
    expect(trialStatusFromEntity({ status: "active", charge_at: futureChargeAt }, now)).toBeNull();
    expect(trialStatusFromEntity({ status: "halted", charge_at: futureChargeAt }, now)).toBeNull();
  });

  it("is null without a charge_at, or for a null entity", () => {
    expect(trialStatusFromEntity({ status: "authenticated" }, now)).toBeNull();
    expect(trialStatusFromEntity(null, now)).toBeNull();
  });
});

describe("RazorpayBillingProvider — checkout, enabled, and errors", () => {
  it("is enabled only when all three credentials are present", () => {
    const { provider } = makeProvider();
    expect(provider.enabled).toBe(true);
    const half = new RazorpayBillingProvider(
      { keyId: FAKE_KEY_ID, keySecret: undefined, webhookSecret: FAKE_WEBHOOK_SECRET, planIds: new Map() },
      { createSubscription: vi.fn(), cancelSubscription: vi.fn(), refundPayment: vi.fn() } as unknown as RazorpayClient,
    );
    expect(half.enabled).toBe(false);
  });

  it("creates a checkout for a configured plan and returns the public key id + sub id", async () => {
    const { provider, fakeClient } = makeProvider();
    const result = await provider.createCheckout({
      planKey: "pro",
      interval: "monthly",
      workspaceId: "ws_1",
      customerEmail: "owner@example.com",
    });
    // #992 — a plain checkout (no trial) returns a null trialEndsAt and never
    // passes start_at/offer_id to the client.
    expect(result).toEqual({ subscriptionId: "sub_fake_created", keyId: FAKE_KEY_ID, trialEndsAt: null });
    expect(fakeClient.createSubscription).toHaveBeenCalledWith(
      expect.objectContaining({ planId: "plan_fake_pro_m", notes: expect.objectContaining({ workspaceId: "ws_1" }) }),
    );
    const call = (fakeClient.createSubscription as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.startAt).toBeUndefined();
    expect(call.offerId).toBeUndefined();
  });

  it("#992 — a trial plan defers the first charge: start_at ≈ now + trialDays and trialEndsAt returned", async () => {
    const { provider, fakeClient } = makeProvider();
    const before = Date.now();
    const result = await provider.createCheckout({
      planKey: "pro",
      interval: "monthly",
      workspaceId: "ws_1",
      customerEmail: "owner@example.com",
      trialDays: 14,
      trialRequiresCard: false,
    });
    const after = Date.now();
    // trialEndsAt is ~14 days out, and start_at (epoch seconds) matches it.
    const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
    const end = result.trialEndsAt!.getTime();
    expect(end).toBeGreaterThanOrEqual(before + fourteenDaysMs);
    expect(end).toBeLessThanOrEqual(after + fourteenDaysMs);
    const call = (fakeClient.createSubscription as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.startAt).toBe(Math.floor(end / 1000));
  });

  it("#992 — passes the coupon's offer id to the client when one is given", async () => {
    const { provider, fakeClient } = makeProvider();
    await provider.createCheckout({
      planKey: "pro",
      interval: "monthly",
      workspaceId: "ws_1",
      customerEmail: "owner@example.com",
      offerId: "offer_abc123",
    });
    const call = (fakeClient.createSubscription as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.offerId).toBe("offer_abc123");
  });

  it("throws PlanNotConfiguredError for a plan with no configured id", async () => {
    const { provider } = makeProvider();
    await expect(
      provider.createCheckout({ planKey: "team", interval: "monthly", workspaceId: "ws_1", customerEmail: "o@x.com" }),
    ).rejects.toBeInstanceOf(PlanNotConfiguredError);
  });

  it("delegates cancel and refund to the client", async () => {
    const { provider, fakeClient } = makeProvider();
    await provider.cancel("sub_fake_created", true);
    expect(fakeClient.cancelSubscription).toHaveBeenCalledWith("sub_fake_created", true);
    await provider.refund("pay_fake_1");
    expect(fakeClient.refundPayment).toHaveBeenCalledWith("pay_fake_1");
  });
});

describe("#988 RazorpayBillingProvider.updateSubscription — plan change at the provider", () => {
  it("resolves the target plan id and passes schedule_change_at=now for an upgrade", async () => {
    const { provider, fakeClient } = makeProvider();
    await provider.updateSubscription({
      providerSubscriptionId: "sub_fake_created",
      planKey: "pro",
      interval: "yearly",
      when: "now",
    });
    expect(fakeClient.updateSubscription).toHaveBeenCalledWith("sub_fake_created", {
      planId: "plan_fake_pro_y",
      scheduleChangeAt: "now",
    });
  });

  it("passes schedule_change_at=cycle_end for a deferred (at_cycle_end) change", async () => {
    const { provider, fakeClient } = makeProvider();
    await provider.updateSubscription({
      providerSubscriptionId: "sub_fake_created",
      planKey: "pro",
      interval: "monthly",
      when: "at_cycle_end",
    });
    expect(fakeClient.updateSubscription).toHaveBeenCalledWith("sub_fake_created", {
      planId: "plan_fake_pro_m",
      scheduleChangeAt: "cycle_end",
    });
  });

  it("throws PlanNotConfiguredError when the target plan has no configured id", async () => {
    const { provider } = makeProvider();
    await expect(
      provider.updateSubscription({ providerSubscriptionId: "sub_fake_created", planKey: "team", interval: "monthly", when: "now" }),
    ).rejects.toBeInstanceOf(PlanNotConfiguredError);
  });
});

describe("#988 RazorpayBillingProvider.listInvoices — mapping the provider entities", () => {
  it("maps a full invoice entity: upper-cases currency, truncates the amount, maps status, keeps short_url", async () => {
    const { provider } = makeProvider({
      listInvoices: vi.fn(async () => [
        { id: "inv_1", invoice_number: "INV-9", status: "paid", amount: 50000, currency: "usd", issued_at: 1_700_000_000, short_url: "https://rzp.example/i/inv_1.pdf" },
      ]),
    });
    const [inv] = await provider.listInvoices("sub_fake_created");
    expect(inv).toEqual({
      id: "inv_1",
      number: "INV-9",
      status: "paid",
      amount: 50000,
      currency: "USD",
      issuedAt: 1_700_000_000,
      pdfUrl: "https://rzp.example/i/inv_1.pdf",
    });
  });

  it("is defensive about a sparse entity: missing id → empty string, missing number/url → null, unknown status → issued, missing amount → 0, missing currency → INR", async () => {
    const { provider } = makeProvider({
      listInvoices: vi.fn(async () => [{ status: "something_new", date: 1_650_000_000 }]),
    });
    const [inv] = await provider.listInvoices("sub_fake_created");
    expect(inv).toEqual({
      id: "",
      number: null,
      status: "issued", // unknown provider status falls back to issued, not dropped
      amount: 0,
      currency: "INR",
      issuedAt: 1_650_000_000, // read from `date` when `issued_at` is absent
      pdfUrl: null,
    });
  });

  it("maps each non-paid status to its own value", async () => {
    const { provider } = makeProvider({
      listInvoices: vi.fn(async () => [
        { id: "a", status: "partially_paid", amount: 1, currency: "INR", issued_at: 1 },
        { id: "b", status: "cancelled", amount: 1, currency: "INR", issued_at: 1 },
        { id: "c", status: "expired", amount: 1, currency: "INR", issued_at: 1 },
      ]),
    });
    const got = (await provider.listInvoices("sub_fake_created")).map((i) => i.status);
    expect(got).toEqual(["partially_paid", "cancelled", "expired"]);
  });
});

describe("NoneBillingProvider — billing off", () => {
  it("is disabled and verifies nothing", () => {
    const none = new NoneBillingProvider();
    expect(none.enabled).toBe(false);
    expect(none.name).toBe("none");
    expect(none.verifyWebhook("{}", "anything")).toBeNull();
  });

  it("throws on every write path", async () => {
    const none = new NoneBillingProvider();
    await expect(
      none.createCheckout({ planKey: "pro", interval: "monthly", workspaceId: "w", customerEmail: "e" }),
    ).rejects.toThrow();
    await expect(none.cancel("s", true)).rejects.toThrow();
    await expect(
      none.updateSubscription({ providerSubscriptionId: "s", planKey: "pro", interval: "monthly", when: "now" }),
    ).rejects.toThrow();
    await expect(none.refund("p")).rejects.toThrow();
  });

  it("#988 lists no invoices when billing is off (returns [], never throws)", async () => {
    const none = new NoneBillingProvider();
    expect(await none.listInvoices("sub_x")).toEqual([]);
  });
});


/* #1023 — classify a raw provider error into a kind, and confirm the three
   billing WRITE methods (cancel, updateSubscription, refund) turn a provider
   failure into a typed BillingProviderError that carries NO provider body/id. */
describe("#1023 classifyRazorpayError", () => {
  it("a provider 4xx (except 429) is `rejected`", () => {
    expect(classifyRazorpayError({ statusCode: 400, error: { code: "BAD_REQUEST_ERROR" } })).toBe("rejected");
    expect(classifyRazorpayError({ statusCode: 404 })).toBe("rejected");
    expect(classifyRazorpayError({ statusCode: 409 })).toBe("rejected");
    expect(classifyRazorpayError({ status: 422 })).toBe("rejected");
  });

  it("a provider 5xx is `unavailable`", () => {
    expect(classifyRazorpayError({ statusCode: 500 })).toBe("unavailable");
    expect(classifyRazorpayError({ statusCode: 502 })).toBe("unavailable");
    expect(classifyRazorpayError({ status: 503 })).toBe("unavailable");
  });

  it("a 429 rate-limit is `unavailable` (transient, a retry can succeed)", () => {
    expect(classifyRazorpayError({ statusCode: 429 })).toBe("unavailable");
  });

  it("a network / timeout system error is `unavailable`", () => {
    expect(classifyRazorpayError({ code: "ECONNREFUSED" })).toBe("unavailable");
    expect(classifyRazorpayError({ code: "ENOTFOUND" })).toBe("unavailable");
    expect(classifyRazorpayError({ code: "ECONNRESET" })).toBe("unavailable");
    expect(classifyRazorpayError({ code: "EAI_AGAIN" })).toBe("unavailable");
    expect(classifyRazorpayError({ code: "ETIMEDOUT" })).toBe("unavailable");
    expect(classifyRazorpayError({ code: "ECONNABORTED" })).toBe("unavailable");
    expect(classifyRazorpayError({ name: "AbortError" })).toBe("unavailable");
    expect(classifyRazorpayError({ name: "TimeoutError" })).toBe("unavailable");
  });

  it("an unreadable / unknown error fails safe to `unavailable` (never a false `rejected`)", () => {
    expect(classifyRazorpayError(new Error("boom"))).toBe("unavailable");
    expect(classifyRazorpayError("just a string")).toBe("unavailable");
    expect(classifyRazorpayError(null)).toBe("unavailable");
    expect(classifyRazorpayError(undefined)).toBe("unavailable");
    expect(classifyRazorpayError({ nonsense: true })).toBe("unavailable");
  });
});

describe("#1023 provider WRITE methods turn a failure into a typed BillingProviderError", () => {
  /** A Razorpay-shaped 4xx error whose body echoes request-ish fields — exactly
   *  what must NOT reach the client. */
  const razorpay400 = Object.assign(new Error("Request failed"), {
    statusCode: 400,
    error: {
      code: "BAD_REQUEST_ERROR",
      description: "Can't update subscription when subscription is not in Authenticated or Active state",
      field: "status",
    },
  });
  const razorpay500 = Object.assign(new Error("Server error"), { statusCode: 500 });
  const network = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });

  it("cancel: a provider 4xx becomes a `rejected` BillingProviderError with no provider body", async () => {
    const { provider } = makeProvider({ cancelSubscription: vi.fn(async () => { throw razorpay400; }) });
    const err = await provider.cancel("sub_fake_created", true).catch((e) => e);
    expect(err).toBeInstanceOf(BillingProviderError);
    expect(err.kind).toBe("rejected");
    expect(err.operation).toBe("cancel");
    // The honest message leaks none of the provider's body/description/field.
    expect(err.message).not.toMatch(/BAD_REQUEST_ERROR/);
    expect(err.message).not.toMatch(/Authenticated or Active/);
    expect(JSON.stringify(err)).not.toMatch(/Authenticated or Active/);
  });

  it("updateSubscription: the issue's repro (provider 4xx) becomes a `rejected` error", async () => {
    const { provider } = makeProvider({ updateSubscription: vi.fn(async () => { throw razorpay400; }) });
    const err = await provider
      .updateSubscription({ providerSubscriptionId: "sub_fake_created", planKey: "pro", interval: "monthly", when: "now" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(BillingProviderError);
    expect(err.kind).toBe("rejected");
    expect(err.operation).toBe("updateSubscription");
  });

  it("updateSubscription: a provider 5xx becomes an `unavailable` error", async () => {
    const { provider } = makeProvider({ updateSubscription: vi.fn(async () => { throw razorpay500; }) });
    const err = await provider
      .updateSubscription({ providerSubscriptionId: "sub_fake_created", planKey: "pro", interval: "monthly", when: "now" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(BillingProviderError);
    expect(err.kind).toBe("unavailable");
  });

  it("refund: a network failure becomes an `unavailable` error", async () => {
    const { provider } = makeProvider({ refundPayment: vi.fn(async () => { throw network; }) });
    const err = await provider.refund("pay_fake_1").catch((e) => e);
    expect(err).toBeInstanceOf(BillingProviderError);
    expect(err.kind).toBe("unavailable");
    expect(err.operation).toBe("refund");
  });

  it("a PlanNotConfiguredError on updateSubscription is NOT swallowed into a provider error", async () => {
    // The target plan has no configured id — a clean 400 domain error, thrown
    // before the provider call, must stay a PlanNotConfiguredError.
    const { provider } = makeProvider();
    const err = await provider
      .updateSubscription({ providerSubscriptionId: "sub_fake_created", planKey: "team", interval: "monthly", when: "now" })
      .catch((e) => e);
    expect(err).toBeInstanceOf(PlanNotConfiguredError);
    expect(err).not.toBeInstanceOf(BillingProviderError);
  });
});

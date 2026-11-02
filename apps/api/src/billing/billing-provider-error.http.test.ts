import { HttpException } from "@nestjs/common";
import { describe, expect, it } from "vitest";
import { BillingProviderErrorBody } from "@snapurl/contract";
import { providerErrorToHttpException, rethrowIfProviderError } from "./billing-provider-error.http.js";
import { BillingProviderError } from "./razorpay.provider.js";

/* #1023 — the single mapping from a provider-error kind to an HTTP response.
   The body it produces must validate against the contract's
   BillingProviderErrorBody (so the wire shape is pinned), carry the stable
   reason code, never be a 500, and never leak a provider body. */
describe("#1023 providerErrorToHttpException", () => {
  it("rejected → 409 Conflict with reason provider_rejected (default)", () => {
    const ex = providerErrorToHttpException("rejected");
    expect(ex).toBeInstanceOf(HttpException);
    expect(ex.getStatus()).toBe(409);
    const body = ex.getResponse();
    expect(BillingProviderErrorBody.parse(body)).toMatchObject({
      statusCode: 409,
      error: "Conflict",
      reason: "provider_rejected",
    });
  });

  it("rejected → 422 Unprocessable Entity when rejectedStatus is 422", () => {
    const ex = providerErrorToHttpException("rejected", { rejectedStatus: 422 });
    expect(ex.getStatus()).toBe(422);
    const body = ex.getResponse() as Record<string, unknown>;
    expect(body.error).toBe("Unprocessable Entity");
    expect(body.reason).toBe("provider_rejected");
    expect(BillingProviderErrorBody.safeParse(body).success).toBe(true);
  });

  it("rejected uses the caller's honest message when supplied", () => {
    const ex = providerErrorToHttpException("rejected", {
      rejectedMessage: "This subscription can't be changed right now because its first payment isn't complete.",
    });
    const body = ex.getResponse() as Record<string, unknown>;
    expect(body.message).toBe("This subscription can't be changed right now because its first payment isn't complete.");
  });

  it("unavailable → 503 with reason provider_unavailable and the stable message", () => {
    const ex = providerErrorToHttpException("unavailable");
    expect(ex.getStatus()).toBe(503);
    const body = ex.getResponse() as Record<string, unknown>;
    expect(body.error).toBe("Service Unavailable");
    expect(body.reason).toBe("provider_unavailable");
    expect(body.message).toMatch(/unavailable/i);
    expect(body.message).toMatch(/nothing was changed/i);
    expect(BillingProviderErrorBody.safeParse(body).success).toBe(true);
  });

  it("unavailable IGNORES a rejectedMessage / rejectedStatus (always 503, never implies client fault)", () => {
    const ex = providerErrorToHttpException("unavailable", {
      rejectedStatus: 422,
      rejectedMessage: "your request was wrong",
    });
    expect(ex.getStatus()).toBe(503);
    const body = ex.getResponse() as Record<string, unknown>;
    expect(body.message).not.toBe("your request was wrong");
  });

  it("never produces a 500 for either kind", () => {
    expect(providerErrorToHttpException("rejected").getStatus()).not.toBe(500);
    expect(providerErrorToHttpException("unavailable").getStatus()).not.toBe(500);
  });
});

describe("#1023 rethrowIfProviderError", () => {
  it("throws the mapped HttpException for a BillingProviderError", () => {
    const provErr = new BillingProviderError("rejected", "updateSubscription");
    expect(() => rethrowIfProviderError(provErr)).toThrow(HttpException);
    try {
      rethrowIfProviderError(provErr, { rejectedMessage: "no can do" });
    } catch (e) {
      expect(e).toBeInstanceOf(HttpException);
      expect((e as HttpException).getStatus()).toBe(409);
      expect(((e as HttpException).getResponse() as Record<string, unknown>).message).toBe("no can do");
    }
  });

  it("maps an `unavailable` BillingProviderError to a 503", () => {
    try {
      rethrowIfProviderError(new BillingProviderError("unavailable", "refund"));
      expect.unreachable("should have thrown");
    } catch (e) {
      expect((e as HttpException).getStatus()).toBe(503);
    }
  });

  it("returns (does NOT throw) for any non-provider error, so the caller keeps handling", () => {
    expect(() => rethrowIfProviderError(new Error("domain error"))).not.toThrow();
    expect(() => rethrowIfProviderError(null)).not.toThrow();
    expect(() => rethrowIfProviderError({ kind: "rejected" })).not.toThrow(); // look-alike, not an instance
  });
});

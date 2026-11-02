import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { ForbiddenException } from "@nestjs/common";
import { BillingController } from "./billing.controller.js";
import type { BillingService } from "./billing.service.js";
import type { RequestActor } from "../auth/auth.guard.js";

/* ============================================================
   #988 — billing is the WORKSPACE OWNER's to manage.

   The issue's acceptance: "Only workspace owners can see or change billing."

   This is enforced INSIDE each handler (assertOwner), NOT with @Roles("owner").
   The ordering is the whole point: the global AuthGuard evaluates @Roles BEFORE
   the controller-scoped BillingEnabledGuard, so an owner-only @Roles would hand
   a non-owner a 403 even when billing is OFF — leaking that the route exists on
   a `none` build where the honest answer is 404 (and the real-stack access-matrix
   oracle, run with billing off, asserts 404 for every authed principal). By
   asserting the role in the handler, billing-off stays 404 for everyone (the
   BillingEnabledGuard runs first) and owner-only 403 applies only once billing
   is on.

   These tests drive the REAL controller methods with a stub service so the
   owner check runs exactly as in production. RED-ON-BROKEN: drop the assertOwner
   call from any handler and that handler's "non-owner is refused" case reds.
   ============================================================ */

/** A service stub whose methods would succeed — so a non-owner being refused
 *  proves the refusal is the role check, not a service failure. */
function serviceStub(): BillingService {
  const sub = {
    planKey: "pro" as const,
    interval: "monthly" as const,
    status: "active" as const,
    currentPeriodEnd: "2026-12-01T00:00:00.000Z",
    cancelAtPeriodEnd: false,
  };
  return {
    startCheckout: async () => ({
      provider: "razorpay" as const,
      subscriptionId: "sub_x",
      keyId: "rzp_test_x",
      planKey: "pro" as const,
      interval: "monthly" as const,
    }),
    currentSubscription: async () => sub,
    listInvoices: async () => [],
    cancelSubscription: async () => sub,
    changePlan: async () => sub,
  } as unknown as BillingService;
}

function actor(role: RequestActor["role"]): RequestActor {
  return { userId: "u1", workspaceId: "ws1", role, email: "x@example.com", label: "x@example.com" };
}

const NON_OWNERS: ReadonlyArray<RequestActor["role"]> = ["admin", "editor", "viewer"];

describe("#988 — billing is owner-only (enforced in the handler, after the reachability gate)", () => {
  it("the owner may reach every session route", async () => {
    const c = new BillingController(serviceStub());
    const owner = actor("owner");
    await expect(c.startCheckout(owner, { planKey: "pro", interval: "monthly" })).resolves.toBeDefined();
    await expect(c.currentSubscription(owner)).resolves.toBeDefined();
    await expect(c.invoices(owner)).resolves.toBeDefined();
    await expect(c.cancel(owner, { atPeriodEnd: true })).resolves.toBeDefined();
    await expect(c.change(owner, { planKey: "team", interval: "monthly" })).resolves.toBeDefined();
  });

  it("every non-owner role is refused on every session route with a ForbiddenException", async () => {
    const c = new BillingController(serviceStub());
    for (const role of NON_OWNERS) {
      const a = actor(role);
      await expect(c.startCheckout(a, { planKey: "pro", interval: "monthly" })).rejects.toBeInstanceOf(ForbiddenException);
      await expect(c.currentSubscription(a)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(c.invoices(a)).rejects.toBeInstanceOf(ForbiddenException);
      await expect(c.cancel(a, { atPeriodEnd: true })).rejects.toBeInstanceOf(ForbiddenException);
      await expect(c.change(a, { planKey: "team", interval: "monthly" })).rejects.toBeInstanceOf(ForbiddenException);
    }
  });
});

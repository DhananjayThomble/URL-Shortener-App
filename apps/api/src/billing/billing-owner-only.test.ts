import "reflect-metadata";
import { describe, expect, it } from "vitest";
import { Reflector } from "@nestjs/core";
import { BillingController } from "./billing.controller.js";
import { REQUIRED_ROLES, satisfiesRole } from "../auth/auth.guard.js";

/* ============================================================
   #988 — billing is the WORKSPACE OWNER's to manage.

   The issue's acceptance: "Only workspace owners can see or change billing."
   That is enforced by @Roles("owner") on the BillingController, which the real
   AuthGuard reads (REQUIRED_ROLES via Reflector.getAllAndOverride over
   [handler, class]) and compares with satisfiesRole. This proves the two halves
   of that wiring directly, without standing up the whole TokenService + DB auth
   stack:

   1. The controller class carries @Roles("owner"), and because a class-level
      decorator is inherited by every handler, EVERY billing session route is
      owner-gated — checkout, subscription, invoices, cancel, change. A @Public
      route (the webhook) is exempt by IS_PUBLIC, which the guard checks first.
   2. satisfiesRole("owner", ["owner"]) allows; admin / editor / viewer are all
      denied against an owner-only requirement (the role ranking is strict here,
      not "admin can do anything").

   RED-ON-BROKEN: remove @Roles("owner") from the controller and assertion (1)
   reds (no REQUIRED_ROLES metadata); loosen satisfiesRole so admin satisfies an
   owner-only route and assertion (2) reds. Either regression would silently let
   a non-owner manage billing — exactly what the issue forbids.
   ============================================================ */

describe("#988 — billing is owner-only", () => {
  const reflector = new Reflector();

  it("the BillingController class carries @Roles(\"owner\")", () => {
    const roles = reflector.get<string[]>(REQUIRED_ROLES, BillingController);
    expect(roles).toEqual(["owner"]);
  });

  it("the owner-only requirement is read by getAllAndOverride for every handler (class-level inheritance)", () => {
    // The AuthGuard reads [handler, class]; the class value is what applies to
    // every route, so a handler with no own @Roles still inherits owner-only.
    const fromClass = reflector.getAllAndOverride<string[]>(REQUIRED_ROLES, [
      BillingController.prototype.startCheckout,
      BillingController,
    ]);
    expect(fromClass).toEqual(["owner"]);
    const onInvoices = reflector.getAllAndOverride<string[]>(REQUIRED_ROLES, [
      BillingController.prototype.invoices,
      BillingController,
    ]);
    expect(onInvoices).toEqual(["owner"]);
  });

  it("satisfiesRole gates owner-only to the owner: admin/editor/viewer are denied", () => {
    expect(satisfiesRole("owner", ["owner"])).toBe(true);
    expect(satisfiesRole("admin", ["owner"])).toBe(false);
    expect(satisfiesRole("editor", ["owner"])).toBe(false);
    expect(satisfiesRole("viewer", ["owner"])).toBe(false);
  });
});

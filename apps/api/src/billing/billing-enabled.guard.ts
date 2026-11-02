import { CanActivate, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { BillingService } from "./billing.service.js";

/* ============================================================
   #986 — the reachability gate for the whole billing surface.

   "Billing off = unreachable" has to hold BEFORE any body/query pipe runs: a
   guard runs ahead of the pipes, so when BILLING_PROVIDER=none (or billing is
   half-configured) this 404s before zod ever validates the body. That is what
   keeps POST /billing/checkout a 404 rather than a 400 (body-validation) when
   billing is off — the oracle in access-matrix.expected.ts asserts 404, and
   the invariant is unreachability, not "reachable but rejects the body".

   A 404 (not 403) because the honest answer is "this route does not exist on
   this deployment", which is exactly how a self-hosted / open-source build
   without billing should look. Applied at the controller via @UseGuards, so
   it covers every billing route including the @Public webhook.

   The global AuthGuard still runs first (it is an APP_GUARD), so an
   unauthenticated caller on a session route is 401 before this guard is
   reached — matching the oracle (anon 401, authed-but-billing-off 404). The
   @Public webhook skips AuthGuard, so this guard is its first gate and it 404s
   straight away when billing is off.
   ============================================================ */
@Injectable()
export class BillingEnabledGuard implements CanActivate {
  // Explicit @Inject by token: the vitest esbuild transform does not emit
  // design:paramtypes, so without this Nest cannot resolve this param by type
  // in the stack/HTTP tests and it arrives undefined — the same reason
  // ProxyAwareThrottlerGuard token-injects its deps. A no-op under `nest build`
  // (tsc + emitDecoratorMetadata), required under the test transform.
  constructor(@Inject(BillingService) private readonly billing: BillingService) {}

  canActivate(): boolean {
    if (!this.billing.enabled) {
      throw new NotFoundException("Not found.");
    }
    return true;
  }
}

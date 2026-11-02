import type { EntitlementsService } from "./entitlements.service.js";

/* ============================================================
   Test-only EntitlementsService stubs.

   DomainsService (and any other service that gates on entitlements) takes an
   EntitlementsService. A unit/integration test that is NOT exercising the plan
   gate — it works on a paid/unlimited workspace and only cares about the OTHER
   behaviour — passes one of these so it does not have to stand up PlansService
   and a seeded catalogue just to let the gated call through.

   `openEntitlementsStub()` grants every feature and leaves every limit
   unlimited, so a gated path never refuses. A test that wants to assert the
   refusal itself uses the real EntitlementsService over the DB instead (see
   domains.plan-gate.integration.test.ts).
   ============================================================ */

/** A permissive stub: every feature on, every limit unlimited. */
export function openEntitlementsStub(): EntitlementsService {
  return {
    hasFeature: async () => true,
    limitFor: async () => null,
    assertFeature: async () => undefined,
    assertWithinLimit: async () => undefined,
  } as unknown as EntitlementsService;
}

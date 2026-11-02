/**
 * Access-matrix oracle — DRAFT for maintainer approval (issue #891).
 *
 * One row per controller route (71 routes, Appendix A of
 * .kiro/specs/api-stack-tests/design.md). The `expect` values were
 * **observed** by sending each route once per principal against the local
 * staging stack (pnpm staging:up) — they were NOT read off the `@Roles` /
 * `@Scope` decorators. qa-oracles.md §1 forbids using the implementation as
 * its own oracle, so this file records what the running API *did*, and the
 * maintainer decides what it *should* do.
 *
 * APPROVED: the maintainer reviewed all 71 observed rows against intended
 * policy and approved them wholesale (every row `status: "approved"`). The
 * three policy questions in the PR body were each confirmed intended:
 *   (1) editor can create/edit content (links, forms, bio-pages) but is 403
 *       on workspace administration (domains, members, api-keys, webhooks);
 *   (2) viewer is read-only except POST /conversions and the read-scoped
 *       export routes, which are intended;
 *   (3) API keys — even full-scope — are fenced out of admin surfaces (403)
 *       and reach only links/forms/conversions/reports/analytics.
 * No row carries `intended`/`issue`: observed == intended for all 71.
 *
 * Excluded from the production build (apps/api/tsconfig.json). Consumed only
 * by the access-matrix stack suite (M2–M5), which is a follow-up (#892).
 *
 * `Expect` grammar (design §7):
 *   "allow"    status not in {401, 403}; for an {id} route, not a 404 on the
 *              principal's own-workspace resource. A 400 validation error on
 *              a write still counts as "allow": the guard runs before the body
 *              pipe, so a 400 means authorization passed.
 *   401        unauthenticated / no valid credential.
 *   403        authenticated but denied by @Roles or @Scope (API keys fail
 *              closed: a route with no @Scope is 403 for any key).
 *   404        cross-tenant {id} probe — another workspace's resource is
 *              indistinguishable from a nonexistent id (see the ADR in
 *              docs/DECISIONS.md).
 *   "own-only" a list that returns only the caller's workspace rows, never
 *              another workspace's.
 *   any        a @Public row (observed for anon and ownerA only).
 */

export type Expect = "allow" | 401 | 403 | 404 | "own-only";

export type Principal =
  | "anon"
  | "ownerA"
  | "adminA"
  | "editorA"
  | "viewerA"
  | "ownerB"
  | "keyA-all"
  | "keyA-links-read"
  | "keyB-all";

export interface Row {
  route: `${"GET" | "POST" | "PUT" | "PATCH" | "DELETE"} /api/v1/${string}`;
  /** `any` applies to @Public rows (observed for anon and ownerA only). */
  expect: Partial<Record<Principal, Expect>> & { any?: Expect };
  status: "observed" | "approved";
  /** The maintainer's answer, when it differs from the observed behaviour. */
  intended?: Partial<Record<Principal, Expect>>;
  /** Required when `intended` is set. */
  issue?: number;
  note?: string;
}

export const ACCESS_MATRIX: Row[] = [
  // ── auth ──
  { route: "POST /api/v1/auth/register", expect: { any: "allow" }, status: "approved",
    note: "First probe hit the route's own 5/min throttle (consumed by principal seeding); re-probed after the window to 400 (validation). @Public, reachable by anyone." },
  { route: "POST /api/v1/auth/login", expect: { any: "allow" }, status: "approved" },
  { route: "POST /api/v1/auth/oauth", expect: { any: "allow" }, status: "approved" },
  { route: "POST /api/v1/auth/refresh", expect: { any: "allow" }, status: "approved" },
  { route: "POST /api/v1/auth/invite/accept", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: "allow", viewerA: "allow", ownerB: "allow", "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "approved" },
  { route: "GET /api/v1/auth/workspaces", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: "allow", viewerA: "allow", ownerB: "allow", "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "approved" },
  { route: "POST /api/v1/auth/logout", expect: { any: "allow" }, status: "approved" },
  { route: "POST /api/v1/auth/password-reset/request", expect: { any: "allow" }, status: "approved" },
  { route: "POST /api/v1/auth/password-reset/confirm", expect: { any: "allow" }, status: "approved" },
  { route: "POST /api/v1/auth/email/verify", expect: { any: "allow" }, status: "approved" },
  { route: "POST /api/v1/auth/email/resend", expect: { any: "allow" }, status: "approved" },
  { route: "GET /api/v1/auth/me", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: "allow", viewerA: "allow", ownerB: "allow", "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "approved" },
  { route: "POST /api/v1/auth/2fa/setup", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: "allow", viewerA: "allow", ownerB: "allow", "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "approved" },
  { route: "POST /api/v1/auth/2fa/enable", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: "allow", viewerA: "allow", ownerB: "allow", "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "approved" },
  { route: "POST /api/v1/auth/2fa/verify", expect: { any: "allow" }, status: "approved" },
  { route: "POST /api/v1/auth/2fa/disable", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: "allow", viewerA: "allow", ownerB: "allow", "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "approved" },
  // ── public ──
  { route: "GET /api/v1/public/links/{slug}/preview", expect: { any: "allow" }, status: "approved" },
  { route: "GET /api/v1/public/links/{slug}/lock", expect: { any: "allow" }, status: "approved" },
  { route: "POST /api/v1/public/links/{slug}/unlock", expect: { any: "allow" }, status: "approved" },
  { route: "GET /api/v1/public/forms/{slug}", expect: { any: 404 }, status: "approved",
    note: "Observed 404: the public form endpoint answers 404 unless the form status is \"live\" (forms.service.ts:182). The seeded form was a draft, so this records resource-state, not an authz denial. @Public route — reachable by anyone." },
  { route: "GET /api/v1/public/bio-pages/by-domain/{domain}/{slug}", expect: { any: "allow" }, status: "approved" },
  { route: "GET /api/v1/public/bio-pages/{slug}", expect: { any: "allow" }, status: "approved" },
  { route: "POST /api/v1/public/bio-pages/by-domain/{domain}/{slug}/view", expect: { any: "allow" }, status: "approved" },
  { route: "POST /api/v1/public/bio-pages/by-domain/{domain}/{slug}/blocks/{blockId}/click", expect: { any: 404 }, status: "approved",
    note: "Observed 404: no block existed at the probed blockId (the seeded bio page had no blocks). Records resource-state, not an authz denial. @Public." },
  { route: "POST /api/v1/public/bio-pages/{slug}/view", expect: { any: "allow" }, status: "approved" },
  { route: "POST /api/v1/public/bio-pages/{slug}/blocks/{blockId}/click", expect: { any: 404 }, status: "approved",
    note: "Observed 404: no block existed at the probed blockId. Records resource-state, not an authz denial. @Public." },
  { route: "POST /api/v1/public/forms/{slug}", expect: { any: "allow" }, status: "approved",
    note: "Observed 400 (validation) for a live-route body; @Public, reachable by anyone." },
  { route: "POST /api/v1/public/links/{slug}/report", expect: { any: "allow" }, status: "approved" },
  // #972 — the site-wide banner, @Public so reachable by anyone (signed-in or
  // not); it returns the public banner shape only, never anything gated.
  { route: "GET /api/v1/public/platform/banner", expect: { any: "allow" }, status: "approved" },
  // ── health ──
  { route: "GET /api/v1/health", expect: { any: "allow" }, status: "approved" },
  // ── links ──
  { route: "GET /api/v1/links", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: "allow", viewerA: "allow", ownerB: "own-only", "keyA-all": "allow", "keyA-links-read": "allow", "keyB-all": "own-only" }, status: "approved" },
  { route: "GET /api/v1/links/export", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: "allow", viewerA: "allow", ownerB: "own-only", "keyA-all": "allow", "keyA-links-read": "allow", "keyB-all": "own-only" }, status: "approved" },
  { route: "GET /api/v1/links/{id}", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: "allow", viewerA: "allow", ownerB: 404, "keyA-all": "allow", "keyA-links-read": "allow", "keyB-all": 404 }, status: "approved" },
  { route: "POST /api/v1/links", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: "allow", viewerA: 403, ownerB: "allow", "keyA-all": "allow", "keyA-links-read": 403, "keyB-all": "allow" }, status: "approved" },
  { route: "POST /api/v1/links/bulk", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: "allow", viewerA: 403, ownerB: "allow", "keyA-all": "allow", "keyA-links-read": 403, "keyB-all": "allow" }, status: "approved" },
  { route: "POST /api/v1/links/{id}/clone", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: "allow", viewerA: 403, ownerB: 404, "keyA-all": "allow", "keyA-links-read": 403, "keyB-all": 404 }, status: "approved" },
  { route: "PATCH /api/v1/links/{id}", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: "allow", viewerA: 403, ownerB: 404, "keyA-all": "allow", "keyA-links-read": 403, "keyB-all": 404 }, status: "approved" },
  { route: "DELETE /api/v1/links/{id}", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: "allow", viewerA: 403, ownerB: 404, "keyA-all": "allow", "keyA-links-read": 403, "keyB-all": 404 }, status: "approved" },
  // ── forms ──
  { route: "GET /api/v1/forms", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: "allow", viewerA: "allow", ownerB: "own-only", "keyA-all": "allow", "keyA-links-read": "allow", "keyB-all": "own-only" }, status: "approved" },
  { route: "GET /api/v1/forms/{id}", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: "allow", viewerA: "allow", ownerB: 404, "keyA-all": "allow", "keyA-links-read": "allow", "keyB-all": 404 }, status: "approved" },
  { route: "GET /api/v1/forms/{id}/responses", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: "allow", viewerA: "allow", ownerB: 404, "keyA-all": "allow", "keyA-links-read": "allow", "keyB-all": 404 }, status: "approved" },
  { route: "GET /api/v1/forms/{id}/responses.csv", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: "allow", viewerA: "allow", ownerB: 404, "keyA-all": "allow", "keyA-links-read": "allow", "keyB-all": 404 }, status: "approved" },
  { route: "POST /api/v1/forms", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: "allow", viewerA: 403, ownerB: "allow", "keyA-all": "allow", "keyA-links-read": 403, "keyB-all": "allow" }, status: "approved" },
  { route: "PATCH /api/v1/forms/{id}", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: "allow", viewerA: 403, ownerB: 404, "keyA-all": "allow", "keyA-links-read": 403, "keyB-all": 404 }, status: "approved" },
  { route: "DELETE /api/v1/forms/{id}", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: "allow", viewerA: 403, ownerB: 404, "keyA-all": "allow", "keyA-links-read": 403, "keyB-all": 404 }, status: "approved" },
  // ── domains ──
  { route: "GET /api/v1/domains", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: "allow", viewerA: "allow", ownerB: "own-only", "keyA-all": "allow", "keyA-links-read": 403, "keyB-all": "own-only" }, status: "approved" },
  { route: "POST /api/v1/domains", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: 403, viewerA: 403, ownerB: "allow", "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "approved" },
  { route: "POST /api/v1/domains/{id}/verify", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: 403, viewerA: 403, ownerB: 404, "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "approved" },
  { route: "PATCH /api/v1/domains/{id}", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: 403, viewerA: 403, ownerB: "allow", "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "approved" },
  { route: "DELETE /api/v1/domains/{id}", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: 403, viewerA: 403, ownerB: 404, "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "approved" },
  // ── members ──
  { route: "GET /api/v1/members", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: "allow", viewerA: "allow", ownerB: "own-only", "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "approved" },
  { route: "POST /api/v1/members", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: 403, viewerA: 403, ownerB: "allow", "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "approved" },
  { route: "PATCH /api/v1/members/{id}", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: 403, viewerA: 403, ownerB: "allow", "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "approved" },
  { route: "POST /api/v1/members/{id}/resend", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: 403, viewerA: 403, ownerB: 404, "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "approved" },
  { route: "DELETE /api/v1/members/{id}", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: 403, viewerA: 403, ownerB: 404, "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "approved" },
  { route: "GET /api/v1/audit", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: "allow", viewerA: "allow", ownerB: "own-only", "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "approved" },
  // ── developers ──
  { route: "GET /api/v1/api-keys", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: 403, viewerA: 403, ownerB: "allow", "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "approved" },
  { route: "POST /api/v1/api-keys", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: 403, viewerA: 403, ownerB: "allow", "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "approved" },
  { route: "DELETE /api/v1/api-keys/{id}", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: 403, viewerA: 403, ownerB: 404, "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "approved" },
  { route: "GET /api/v1/webhooks", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: 403, viewerA: 403, ownerB: "allow", "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "approved" },
  { route: "POST /api/v1/webhooks", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: 403, viewerA: 403, ownerB: "allow", "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "approved" },
  { route: "DELETE /api/v1/webhooks/{id}", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: 403, viewerA: 403, ownerB: 404, "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "approved" },
  // ── bio-pages ──
  { route: "GET /api/v1/bio-pages", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: "allow", viewerA: "allow", ownerB: "own-only", "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "approved" },
  { route: "PUT /api/v1/bio-pages", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: "allow", viewerA: 403, ownerB: "allow", "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "approved" },
  { route: "DELETE /api/v1/bio-pages/{id}", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: "allow", viewerA: 403, ownerB: 404, "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "approved" },
  // ── workspaces ──
  { route: "GET /api/v1/workspaces/current", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: "allow", viewerA: "allow", ownerB: "allow", "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "approved" },
  { route: "PATCH /api/v1/workspaces/current", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: 403, viewerA: 403, ownerB: "allow", "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "approved" },
  // ── conversions ──
  { route: "GET /api/v1/conversions", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: "allow", viewerA: "allow", ownerB: "own-only", "keyA-all": "allow", "keyA-links-read": 403, "keyB-all": "own-only" }, status: "approved" },
  { route: "POST /api/v1/conversions", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: "allow", viewerA: "allow", ownerB: "allow", "keyA-all": "allow", "keyA-links-read": 403, "keyB-all": "allow" }, status: "approved" },
  // ── reports ──
  { route: "GET /api/v1/reports", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: "allow", viewerA: "allow", ownerB: "own-only", "keyA-all": "allow", "keyA-links-read": "allow", "keyB-all": "own-only" }, status: "approved" },
  { route: "PATCH /api/v1/reports/{id}", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: "allow", viewerA: 403, ownerB: "allow", "keyA-all": "allow", "keyA-links-read": 403, "keyB-all": "allow" }, status: "approved" },
  // ── analytics ──
  { route: "GET /api/v1/analytics", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: "allow", viewerA: "allow", ownerB: "allow", "keyA-all": "allow", "keyA-links-read": 403, "keyB-all": "allow" }, status: "approved" },
  // ── admin (#968) ──
  // The platform-admin gate. None of the matrix principals is a platform admin:
  // admin is derived from PLATFORM_ADMIN_EMAILS (unset in the staging stack, so
  // the allowlist is empty) AND a verified email AND 2FA — none of the seeded
  // principals clears that, so every authenticated principal is 403 (AdminGuard
  // fail-closed), anon is 401, and API keys are 403 (no user behind the key, so
  // never an admin). `adminA` here is a WORKSPACE admin role, which is unrelated
  // to platform admin and correctly denied.
  { route: "GET /api/v1/admin/me", expect: { anon: 401, ownerA: 403, adminA: 403, editorA: 403, viewerA: 403, ownerB: 403, "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "approved" },
  // #972 — runtime platform settings. Same AdminGuard as every /admin/* route:
  // no matrix principal is a platform admin, so each authed principal is 403,
  // anon 401, API keys 403. The PATCH write never reaches its handler for these.
  { route: "GET /api/v1/admin/settings", expect: { anon: 401, ownerA: 403, adminA: 403, editorA: 403, viewerA: 403, ownerB: 403, "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "approved" },
  { route: "PATCH /api/v1/admin/settings", expect: { anon: 401, ownerA: 403, adminA: 403, editorA: 403, viewerA: 403, ownerB: 403, "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "approved" },
  // #974 — system health and operations. Same gate as every /admin/* route:
  // AdminGuard fails closed, so none of the matrix principals (none is a
  // platform admin) reaches any of these — anon 401, every authed principal
  // 403, every API key 403.
  { route: "GET /api/v1/admin/health/services", expect: { anon: 401, ownerA: 403, adminA: 403, editorA: 403, viewerA: 403, ownerB: 403, "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "approved" },
  { route: "GET /api/v1/admin/health/backlogs", expect: { anon: 401, ownerA: 403, adminA: 403, editorA: 403, viewerA: 403, ownerB: 403, "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "approved" },
  { route: "POST /api/v1/admin/health/backlogs/projection-outbox/retry", expect: { anon: 401, ownerA: 403, adminA: 403, editorA: 403, viewerA: 403, ownerB: 403, "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "approved" },
  { route: "POST /api/v1/admin/health/backlogs/webhook-deliveries/retry", expect: { anon: 401, ownerA: 403, adminA: 403, editorA: 403, viewerA: 403, ownerB: 403, "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "approved" },
  { route: "POST /api/v1/admin/health/backlogs/job-leases/{name}/release", expect: { anon: 401, ownerA: 403, adminA: 403, editorA: 403, viewerA: 403, ownerB: 403, "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "approved" },
  { route: "GET /api/v1/admin/audit", expect: { anon: 401, ownerA: 403, adminA: 403, editorA: 403, viewerA: 403, ownerB: 403, "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "approved" },
  { route: "GET /api/v1/admin/workspaces/{workspaceId}/audit", expect: { anon: 401, ownerA: 403, adminA: 403, editorA: 403, viewerA: 403, ownerB: 403, "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "approved" },
  // #969 — the users-and-workspaces admin surface. Every route sits behind the
  // same AdminGuard as GET /admin/me, so the oracle is identical for all of
  // them: no matrix principal is a platform admin (empty allowlist in staging),
  // so each authenticated principal is 403, anon is 401, and API keys are 403
  // (no user behind the key). A write route (suspend/delete/etc.) never reaches
  // its body for these principals — the guard denies before the handler runs.
  { route: "GET /api/v1/admin/users", expect: { anon: 401, ownerA: 403, adminA: 403, editorA: 403, viewerA: 403, ownerB: 403, "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "approved" },
  { route: "GET /api/v1/admin/users/{id}", expect: { anon: 401, ownerA: 403, adminA: 403, editorA: 403, viewerA: 403, ownerB: 403, "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "approved" },
  { route: "POST /api/v1/admin/users/{id}/suspend", expect: { anon: 401, ownerA: 403, adminA: 403, editorA: 403, viewerA: 403, ownerB: 403, "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "approved" },
  { route: "POST /api/v1/admin/users/{id}/unsuspend", expect: { anon: 401, ownerA: 403, adminA: 403, editorA: 403, viewerA: 403, ownerB: 403, "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "approved" },
  { route: "POST /api/v1/admin/users/{id}/signout-everywhere", expect: { anon: 401, ownerA: 403, adminA: 403, editorA: 403, viewerA: 403, ownerB: 403, "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "approved" },
  { route: "POST /api/v1/admin/users/{id}/resend-verification", expect: { anon: 401, ownerA: 403, adminA: 403, editorA: 403, viewerA: 403, ownerB: 403, "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "approved" },
  { route: "DELETE /api/v1/admin/users/{id}", expect: { anon: 401, ownerA: 403, adminA: 403, editorA: 403, viewerA: 403, ownerB: 403, "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "approved" },
  { route: "GET /api/v1/admin/workspaces", expect: { anon: 401, ownerA: 403, adminA: 403, editorA: 403, viewerA: 403, ownerB: 403, "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "approved" },
  { route: "GET /api/v1/admin/workspaces/{id}", expect: { anon: 401, ownerA: 403, adminA: 403, editorA: 403, viewerA: 403, ownerB: 403, "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "approved" },
  { route: "PATCH /api/v1/admin/workspaces/{id}", expect: { anon: 401, ownerA: 403, adminA: 403, editorA: 403, viewerA: 403, ownerB: 403, "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "approved" },
  { route: "GET /api/v1/admin/workspaces/{id}/view-as", expect: { anon: 401, ownerA: 403, adminA: 403, editorA: 403, viewerA: 403, ownerB: 403, "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "approved" },
  // #971 — moderation and abuse. Same AdminGuard fail-closed gate as every
  // other /admin/* route: none of the matrix principals is a platform admin
  // (PLATFORM_ADMIN_EMAILS is empty in the staging stack), so anon is 401,
  // every authenticated principal is 403, and every API key is 403 (no user
  // behind the key, so never an admin).
  { route: "GET /api/v1/admin/abuse-reports", expect: { anon: 401, ownerA: 403, adminA: 403, editorA: 403, viewerA: 403, ownerB: 403, "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "approved" },
  { route: "POST /api/v1/admin/abuse-reports/{id}/action", expect: { anon: 401, ownerA: 403, adminA: 403, editorA: 403, viewerA: 403, ownerB: 403, "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "approved" },
  { route: "GET /api/v1/admin/links", expect: { anon: 401, ownerA: 403, adminA: 403, editorA: 403, viewerA: 403, ownerB: 403, "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "approved" },
  { route: "POST /api/v1/admin/links/{id}/disable", expect: { anon: 401, ownerA: 403, adminA: 403, editorA: 403, viewerA: 403, ownerB: 403, "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "approved" },
  { route: "GET /api/v1/admin/blocked-domains", expect: { anon: 401, ownerA: 403, adminA: 403, editorA: 403, viewerA: 403, ownerB: 403, "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "approved" },
  { route: "POST /api/v1/admin/blocked-domains", expect: { anon: 401, ownerA: 403, adminA: 403, editorA: 403, viewerA: 403, ownerB: 403, "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "approved" },
  { route: "DELETE /api/v1/admin/blocked-domains/{id}", expect: { anon: 401, ownerA: 403, adminA: 403, editorA: 403, viewerA: 403, ownerB: 403, "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "approved" },
  { route: "GET /api/v1/admin/flagged-links", expect: { anon: 401, ownerA: 403, adminA: 403, editorA: 403, viewerA: 403, ownerB: 403, "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "approved" },
  { route: "GET /api/v1/admin/custom-domains", expect: { anon: 401, ownerA: 403, adminA: 403, editorA: 403, viewerA: 403, ownerB: 403, "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "approved" },
  // #973 — platform-wide analytics + its CSV export. Same platform-admin gate:
  // AdminGuard fails closed, so every authenticated principal is 403, anon is
  // 401, and API keys are 403 (no user behind the key). The CSV export is a
  // read behind the same guard, so it shares the row shape.
  { route: "GET /api/v1/admin/analytics", expect: { anon: 401, ownerA: 403, adminA: 403, editorA: 403, viewerA: 403, ownerB: 403, "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "approved" },
  { route: "GET /api/v1/admin/analytics/export/{view}", expect: { anon: 401, ownerA: 403, adminA: 403, editorA: 403, viewerA: 403, ownerB: 403, "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "approved" },
  // #986 — billing. OBSERVED with BILLING_PROVIDER unset in the staging stack,
  // i.e. the default `none`: the controller 404s EVERY billing route for every
  // caller, so the whole surface is unreachable. This records that observed
  // billing-OFF behaviour — a 404 here is "billing disabled on this
  // deployment", not the cross-tenant {id} probe the grammar's 404 usually
  // means (there is no {id} on any billing route). The webhook is @Public, so
  // the suite probes it for anon and ownerA only (`any`); it too 404s while
  // billing is off, and the signature check only runs once billing is on.
  { route: "POST /api/v1/billing/checkout", expect: { anon: 401, ownerA: 404, adminA: 404, editorA: 404, viewerA: 404, ownerB: 404, "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "approved",
    note: "Billing off (BILLING_PROVIDER=none) in staging: a session principal gets 404 — BillingEnabledGuard 404s at the controller BEFORE the body pipe runs, so even a malformed body is 404 (unreachable), never a 400 validation error. anon is 401 (the global auth guard runs before the controller guard); API keys are 403 (no @Scope, fail closed). With billing ON this is a session write (owner/admin/editor allow, viewer 403)." },
  { route: "GET /api/v1/billing/subscription", expect: { anon: 401, ownerA: 404, adminA: 404, editorA: 404, viewerA: 404, ownerB: 404, "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "approved",
    note: "Billing off: 404 for every authed principal (route unreachable), 401 anon, 403 API keys (no @Scope)." },
  { route: "POST /api/v1/billing/webhook", expect: { any: 404 }, status: "approved",
    note: "@Public: Razorpay signs the body, there is no session. Billing off in staging, so it 404s; with billing on it is a signature-verified endpoint (400 on a bad/absent signature, 200 on a verified event)." },
];

// Sanity: one row per inventory route (71 at #891 + 1 for #968's GET /admin/me
// + 7 for #974's system-health routes + 11 for #969's users-and-workspaces
// + 9 for #971's moderation routes + 2 for #973's GET /admin/analytics and its
// CSV export + 2 for #972's admin settings routes + 1 for #972's public banner
// route + 3 for #986's billing checkout/subscription/webhook).
export const EXPECTED_ROUTE_COUNT = 107;

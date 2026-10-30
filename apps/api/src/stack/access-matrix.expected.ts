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
 * EVERY row is `status: "observed"`. No row is `"approved"` — flipping a row
 * to "approved" (or setting `intended`/`issue`) is a follow-up human session
 * that runs after the maintainer answers the questions in the PR body.
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
  { route: "POST /api/v1/auth/register", expect: { any: "allow" }, status: "observed",
    note: "First probe hit the route's own 5/min throttle (consumed by principal seeding); re-probed after the window to 400 (validation). @Public, reachable by anyone." },
  { route: "POST /api/v1/auth/login", expect: { any: "allow" }, status: "observed" },
  { route: "POST /api/v1/auth/oauth", expect: { any: "allow" }, status: "observed" },
  { route: "POST /api/v1/auth/refresh", expect: { any: "allow" }, status: "observed" },
  { route: "POST /api/v1/auth/invite/accept", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: "allow", viewerA: "allow", ownerB: "allow", "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "observed" },
  { route: "GET /api/v1/auth/workspaces", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: "allow", viewerA: "allow", ownerB: "allow", "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "observed" },
  { route: "POST /api/v1/auth/logout", expect: { any: "allow" }, status: "observed" },
  { route: "POST /api/v1/auth/password-reset/request", expect: { any: "allow" }, status: "observed" },
  { route: "POST /api/v1/auth/password-reset/confirm", expect: { any: "allow" }, status: "observed" },
  { route: "POST /api/v1/auth/email/verify", expect: { any: "allow" }, status: "observed" },
  { route: "POST /api/v1/auth/email/resend", expect: { any: "allow" }, status: "observed" },
  { route: "GET /api/v1/auth/me", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: "allow", viewerA: "allow", ownerB: "allow", "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "observed" },
  { route: "POST /api/v1/auth/2fa/setup", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: "allow", viewerA: "allow", ownerB: "allow", "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "observed" },
  { route: "POST /api/v1/auth/2fa/enable", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: "allow", viewerA: "allow", ownerB: "allow", "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "observed" },
  { route: "POST /api/v1/auth/2fa/verify", expect: { any: "allow" }, status: "observed" },
  { route: "POST /api/v1/auth/2fa/disable", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: "allow", viewerA: "allow", ownerB: "allow", "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "observed" },
  // ── public ──
  { route: "GET /api/v1/public/links/{slug}/preview", expect: { any: "allow" }, status: "observed" },
  { route: "GET /api/v1/public/links/{slug}/lock", expect: { any: "allow" }, status: "observed" },
  { route: "POST /api/v1/public/links/{slug}/unlock", expect: { any: "allow" }, status: "observed" },
  { route: "GET /api/v1/public/forms/{slug}", expect: { any: 404 }, status: "observed",
    note: "Observed 404: the public form endpoint answers 404 unless the form status is \"live\" (forms.service.ts:182). The seeded form was a draft, so this records resource-state, not an authz denial. @Public route — reachable by anyone." },
  { route: "GET /api/v1/public/bio-pages/by-domain/{domain}/{slug}", expect: { any: "allow" }, status: "observed" },
  { route: "GET /api/v1/public/bio-pages/{slug}", expect: { any: "allow" }, status: "observed" },
  { route: "POST /api/v1/public/bio-pages/by-domain/{domain}/{slug}/view", expect: { any: "allow" }, status: "observed" },
  { route: "POST /api/v1/public/bio-pages/by-domain/{domain}/{slug}/blocks/{blockId}/click", expect: { any: 404 }, status: "observed",
    note: "Observed 404: no block existed at the probed blockId (the seeded bio page had no blocks). Records resource-state, not an authz denial. @Public." },
  { route: "POST /api/v1/public/bio-pages/{slug}/view", expect: { any: "allow" }, status: "observed" },
  { route: "POST /api/v1/public/bio-pages/{slug}/blocks/{blockId}/click", expect: { any: 404 }, status: "observed",
    note: "Observed 404: no block existed at the probed blockId. Records resource-state, not an authz denial. @Public." },
  { route: "POST /api/v1/public/forms/{slug}", expect: { any: "allow" }, status: "observed",
    note: "Observed 400 (validation) for a live-route body; @Public, reachable by anyone." },
  { route: "POST /api/v1/public/links/{slug}/report", expect: { any: "allow" }, status: "observed" },
  // ── health ──
  { route: "GET /api/v1/health", expect: { any: "allow" }, status: "observed" },
  // ── links ──
  { route: "GET /api/v1/links", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: "allow", viewerA: "allow", ownerB: "own-only", "keyA-all": "allow", "keyA-links-read": "allow", "keyB-all": "own-only" }, status: "observed" },
  { route: "GET /api/v1/links/export", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: "allow", viewerA: "allow", ownerB: "own-only", "keyA-all": "allow", "keyA-links-read": "allow", "keyB-all": "own-only" }, status: "observed" },
  { route: "GET /api/v1/links/{id}", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: "allow", viewerA: "allow", ownerB: 404, "keyA-all": "allow", "keyA-links-read": "allow", "keyB-all": 404 }, status: "observed" },
  { route: "POST /api/v1/links", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: "allow", viewerA: 403, ownerB: "allow", "keyA-all": "allow", "keyA-links-read": 403, "keyB-all": "allow" }, status: "observed" },
  { route: "POST /api/v1/links/bulk", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: "allow", viewerA: 403, ownerB: "allow", "keyA-all": "allow", "keyA-links-read": 403, "keyB-all": "allow" }, status: "observed" },
  { route: "POST /api/v1/links/{id}/clone", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: "allow", viewerA: 403, ownerB: 404, "keyA-all": "allow", "keyA-links-read": 403, "keyB-all": 404 }, status: "observed" },
  { route: "PATCH /api/v1/links/{id}", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: "allow", viewerA: 403, ownerB: 404, "keyA-all": "allow", "keyA-links-read": 403, "keyB-all": 404 }, status: "observed" },
  { route: "DELETE /api/v1/links/{id}", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: "allow", viewerA: 403, ownerB: 404, "keyA-all": "allow", "keyA-links-read": 403, "keyB-all": 404 }, status: "observed" },
  // ── forms ──
  { route: "GET /api/v1/forms", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: "allow", viewerA: "allow", ownerB: "own-only", "keyA-all": "allow", "keyA-links-read": "allow", "keyB-all": "own-only" }, status: "observed" },
  { route: "GET /api/v1/forms/{id}", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: "allow", viewerA: "allow", ownerB: 404, "keyA-all": "allow", "keyA-links-read": "allow", "keyB-all": 404 }, status: "observed" },
  { route: "GET /api/v1/forms/{id}/responses", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: "allow", viewerA: "allow", ownerB: 404, "keyA-all": "allow", "keyA-links-read": "allow", "keyB-all": 404 }, status: "observed" },
  { route: "GET /api/v1/forms/{id}/responses.csv", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: "allow", viewerA: "allow", ownerB: 404, "keyA-all": "allow", "keyA-links-read": "allow", "keyB-all": 404 }, status: "observed" },
  { route: "POST /api/v1/forms", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: "allow", viewerA: 403, ownerB: "allow", "keyA-all": "allow", "keyA-links-read": 403, "keyB-all": "allow" }, status: "observed" },
  { route: "PATCH /api/v1/forms/{id}", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: "allow", viewerA: 403, ownerB: 404, "keyA-all": "allow", "keyA-links-read": 403, "keyB-all": 404 }, status: "observed" },
  { route: "DELETE /api/v1/forms/{id}", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: "allow", viewerA: 403, ownerB: 404, "keyA-all": "allow", "keyA-links-read": 403, "keyB-all": 404 }, status: "observed" },
  // ── domains ──
  { route: "GET /api/v1/domains", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: "allow", viewerA: "allow", ownerB: "own-only", "keyA-all": "allow", "keyA-links-read": 403, "keyB-all": "own-only" }, status: "observed" },
  { route: "POST /api/v1/domains", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: 403, viewerA: 403, ownerB: "allow", "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "observed" },
  { route: "POST /api/v1/domains/{id}/verify", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: 403, viewerA: 403, ownerB: 404, "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "observed" },
  { route: "PATCH /api/v1/domains/{id}", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: 403, viewerA: 403, ownerB: "allow", "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "observed" },
  { route: "DELETE /api/v1/domains/{id}", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: 403, viewerA: 403, ownerB: 404, "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "observed" },
  // ── members ──
  { route: "GET /api/v1/members", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: "allow", viewerA: "allow", ownerB: "own-only", "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "observed" },
  { route: "POST /api/v1/members", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: 403, viewerA: 403, ownerB: "allow", "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "observed" },
  { route: "PATCH /api/v1/members/{id}", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: 403, viewerA: 403, ownerB: "allow", "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "observed" },
  { route: "POST /api/v1/members/{id}/resend", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: 403, viewerA: 403, ownerB: 404, "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "observed" },
  { route: "DELETE /api/v1/members/{id}", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: 403, viewerA: 403, ownerB: 404, "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "observed" },
  { route: "GET /api/v1/audit", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: "allow", viewerA: "allow", ownerB: "own-only", "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "observed" },
  // ── developers ──
  { route: "GET /api/v1/api-keys", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: 403, viewerA: 403, ownerB: "allow", "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "observed" },
  { route: "POST /api/v1/api-keys", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: 403, viewerA: 403, ownerB: "allow", "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "observed" },
  { route: "DELETE /api/v1/api-keys/{id}", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: 403, viewerA: 403, ownerB: 404, "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "observed" },
  { route: "GET /api/v1/webhooks", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: 403, viewerA: 403, ownerB: "allow", "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "observed" },
  { route: "POST /api/v1/webhooks", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: 403, viewerA: 403, ownerB: "allow", "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "observed" },
  { route: "DELETE /api/v1/webhooks/{id}", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: 403, viewerA: 403, ownerB: 404, "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "observed" },
  // ── bio-pages ──
  { route: "GET /api/v1/bio-pages", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: "allow", viewerA: "allow", ownerB: "own-only", "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "observed" },
  { route: "PUT /api/v1/bio-pages", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: "allow", viewerA: 403, ownerB: "allow", "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "observed" },
  { route: "DELETE /api/v1/bio-pages/{id}", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: "allow", viewerA: 403, ownerB: 404, "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "observed" },
  // ── workspaces ──
  { route: "GET /api/v1/workspaces/current", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: "allow", viewerA: "allow", ownerB: "allow", "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "observed" },
  { route: "PATCH /api/v1/workspaces/current", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: 403, viewerA: 403, ownerB: "allow", "keyA-all": 403, "keyA-links-read": 403, "keyB-all": 403 }, status: "observed" },
  // ── conversions ──
  { route: "GET /api/v1/conversions", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: "allow", viewerA: "allow", ownerB: "own-only", "keyA-all": "allow", "keyA-links-read": 403, "keyB-all": "own-only" }, status: "observed" },
  { route: "POST /api/v1/conversions", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: "allow", viewerA: "allow", ownerB: "allow", "keyA-all": "allow", "keyA-links-read": 403, "keyB-all": "allow" }, status: "observed" },
  // ── reports ──
  { route: "GET /api/v1/reports", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: "allow", viewerA: "allow", ownerB: "own-only", "keyA-all": "allow", "keyA-links-read": "allow", "keyB-all": "own-only" }, status: "observed" },
  { route: "PATCH /api/v1/reports/{id}", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: "allow", viewerA: 403, ownerB: "allow", "keyA-all": "allow", "keyA-links-read": 403, "keyB-all": "allow" }, status: "observed" },
  // ── analytics ──
  { route: "GET /api/v1/analytics", expect: { anon: 401, ownerA: "allow", adminA: "allow", editorA: "allow", viewerA: "allow", ownerB: "allow", "keyA-all": "allow", "keyA-links-read": 403, "keyB-all": "allow" }, status: "observed" },
];

// Sanity: one row per inventory route.
export const EXPECTED_ROUTE_COUNT = 71;

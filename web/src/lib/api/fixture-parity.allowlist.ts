/*
 * Intentional gaps for the fixture-parity test (issue #354). An API route listed
 * here is deliberately NOT backed by a fixture branch — because no dashboard hook
 * in fixtures mode calls it. Every entry MUST carry a non-empty `reason`; the test
 * rejects a reason-less entry, so a gap cannot be waved through silently.
 *
 * An entry suppresses BOTH directions for that method+path: a missing fixture
 * branch (direction 1) and a stale branch (direction 2).
 */
export type AllowlistEntry = { method: string; path: string; reason: string };

export const FIXTURE_PARITY_ALLOWLIST: ReadonlyArray<AllowlistEntry> = [
  {
    method: "POST",
    path: "/auth/refresh",
    reason:
      "Token refresh is handled entirely inside the API client (client.ts rotates tokens); no hook calls it, so fixtures mode never exercises it.",
  },
  {
    method: "GET",
    path: "/links/export",
    reason: "CSV export is a direct browser download (anchor href), not a hook request routed through fixtureRequest.",
  },
  {
    method: "GET",
    path: "/forms/{id}/responses.csv",
    reason: "Form-responses CSV is a direct browser download, not a hook request routed through fixtureRequest.",
  },
  {
    method: "GET",
    path: "/health",
    reason: "Liveness endpoint for the load balancer; no dashboard hook calls it.",
  },
];

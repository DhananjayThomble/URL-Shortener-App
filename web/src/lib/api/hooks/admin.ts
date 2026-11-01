"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AdminAuditPage,
  AdminBacklogs,
  AdminMe,
  AdminRetryResult,
  AdminServiceHealth,
  PlatformAnalytics,
  type AdminAnalyticsCsvView,
  type AdminAnalyticsRange,
  type AdminAuditQuery,
} from "@snapurl/contract";
import { API_URL, ApiError, request, tokens } from "../client";
import { qk } from "./keys";

/* #968 — the platform-admin area.

   GET /admin/me is the single gate: the API answers 200 with the admin's
   identity only when the caller is a confirmed platform admin (verified
   allow-listed email + 2FA), and 403 otherwise. The /admin layout reads this
   to decide between the admin shell and the "not authorised" page, so the
   decision is the SERVER's — the client never inspects the token itself. */
export function useAdminMe(opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: qk.adminMe,
    queryFn: () => request("/admin/me", AdminMe),
    // A 403 (not an admin) is a final answer, not a transient error — never
    // retry it, or every non-admin visit hammers the endpoint before the gate
    // can render the refusal.
    retry: false,
    staleTime: 5 * 60_000,
    enabled: opts.enabled ?? true,
  });
}


/* ============================================================
   #974 — system health and operations.

   Every endpoint here is behind the same platform-admin gate as /admin/me, so
   these hooks run only inside the admin shell (AdminGate has already confirmed
   the caller). The three retries are mutations that invalidate the backlog and
   audit views, so the panel reflects the re-queue and its new audit row at
   once.
   ============================================================ */

/** Build the query-string for an audit viewer from its filters. */
function auditQueryString(q: Partial<AdminAuditQuery> = {}): string {
  const params = new URLSearchParams();
  if (q.action) params.set("action", q.action);
  if (q.actor) params.set("actor", q.actor);
  if (q.targetId) params.set("targetId", q.targetId);
  if (q.after) params.set("after", q.after);
  if (q.before) params.set("before", q.before);
  if (q.limit != null) params.set("limit", String(q.limit));
  if (q.offset != null) params.set("offset", String(q.offset));
  const s = params.toString();
  return s ? `?${s}` : "";
}

/** The state of the api, database, redirect edge and background worker. */
export function useAdminServices() {
  return useQuery({
    queryKey: qk.adminServices,
    queryFn: () => request("/admin/health/services", AdminServiceHealth),
    // Health is a live reading; refresh it periodically while the panel is open.
    refetchInterval: 30_000,
  });
}

/** Real counts for the three operational backlogs. */
export function useAdminBacklogs() {
  return useQuery({
    queryKey: qk.adminBacklogs,
    queryFn: () => request("/admin/health/backlogs", AdminBacklogs),
    refetchInterval: 30_000,
  });
}

/** The platform-admin audit trail, with filters. */
export function useAdminAudit(q: Partial<AdminAuditQuery> = {}) {
  const qs = auditQueryString(q);
  return useQuery({
    queryKey: qk.adminAudit(qs),
    queryFn: () => request(`/admin/audit${qs}`, AdminAuditPage),
  });
}

/** A single workspace's audit trail, with filters. */
export function useAdminWorkspaceAudit(workspaceId: string | null, q: Partial<AdminAuditQuery> = {}) {
  const qs = auditQueryString(q);
  return useQuery({
    queryKey: qk.adminWorkspaceAudit(workspaceId ?? "", qs),
    queryFn: () => request(`/admin/workspaces/${workspaceId}/audit${qs}`, AdminAuditPage),
    enabled: !!workspaceId,
  });
}

/** One retry mutation shared by all three backlogs — they return the same
 *  shape and invalidate the same two views, so they differ only by path. */
function useBacklogRetry(path: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => request(path, AdminRetryResult, { method: "POST" }),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: qk.adminBacklogs }),
        qc.invalidateQueries({ queryKey: qk.adminServices }),
        qc.invalidateQueries({ queryKey: qk.adminAudit() }),
      ]),
  });
}

/** Re-queue every dead-lettered edge update (audited). */
export function useRetryProjectionOutbox() {
  return useBacklogRetry("/admin/health/backlogs/projection-outbox/retry");
}

/** Re-queue every failed webhook delivery (audited). */
export function useRetryWebhookDeliveries() {
  return useBacklogRetry("/admin/health/backlogs/webhook-deliveries/retry");
}

/** Release a stuck job lease by name (audited). */
export function useReleaseJobLease() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      request(`/admin/health/backlogs/job-leases/${encodeURIComponent(name)}/release`, AdminRetryResult, {
        method: "POST",
      }),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: qk.adminBacklogs }),
        qc.invalidateQueries({ queryKey: qk.adminServices }),
        qc.invalidateQueries({ queryKey: qk.adminAudit() }),
      ]),
  });
}

/* #973 — platform-wide analytics.

   GET /admin/analytics returns the operator's whole-platform figures (growth,
   usage, business, email, abuse) for a range, from the daily summary tables.
   The route is behind the same AdminGuard as /admin/me, so a non-admin never
   receives a body. `compare` asks the API to also return the previous window's
   headline figures for a period-over-period view. */
export function useAdminAnalytics(
  range: AdminAnalyticsRange,
  compare: boolean,
  opts: { enabled?: boolean } = {},
) {
  return useQuery({
    queryKey: qk.adminAnalytics(range, compare),
    queryFn: () => request(`/admin/analytics?range=${range}&compare=${compare}`, PlatformAnalytics),
    retry: false,
    staleTime: 60_000,
    enabled: opts.enabled ?? true,
  });
}

/**
 * Download the CSV for one analytics view.
 *
 * The session token lives in localStorage, not a cookie, so a bare `<a href>`
 * would reach the API unauthenticated and 401. This fetches with the same auth
 * header the rest of the client uses, then triggers a client-side download from
 * the returned blob. Throws ApiError on a non-OK response so the caller can
 * surface it. */
export async function downloadAdminAnalyticsCsv(
  view: AdminAnalyticsCsvView,
  range: AdminAnalyticsRange,
): Promise<void> {
  const res = await fetch(`${API_URL}/admin/analytics/export/${view}?range=${range}`, {
    headers: tokens.access ? { Authorization: `Bearer ${tokens.access}` } : {},
  });
  if (!res.ok) throw new ApiError(res.status, `Could not export ${view} (${res.status}).`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = `snapurl-admin-${view}-${range}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

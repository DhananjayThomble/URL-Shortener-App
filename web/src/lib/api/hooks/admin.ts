"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AddBlockedDomainInput,
  AdminAbuseQueuePage,
  AdminActionResult,
  AdminAuditPage,
  AdminBacklogs,
  AdminBlockedDomain,
  AdminBlockedDomains,
  AdminCustomDomains,
  AdminFlaggedLinks,
  AdminLinkPage,
  AdminMe,
  AdminRetryResult,
  AdminServiceHealth,
  AdminUserDetail,
  AdminUserList,
  AdminViewAsWorkspace,
  AdminWorkspaceDetail,
  AdminWorkspaceList,
  KillSwitchesView,
  PlatformAnalytics,
  PlatformSettings,
  type AdminAbuseQueueQuery,
  type AdminAbuseReportAction,
  type AdminAnalyticsCsvView,
  type AdminAnalyticsRange,
  type AdminAuditQuery,
  type AdminLinkDisableInput,
  type AdminLinkSearchQuery,
  type AdminUpdateWorkspaceInput,
  type KillSwitchesPatchBody,
  type PlatformSettingsInput,
} from "@snapurl/contract";
import { z } from "zod";
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
   #969 — users & workspaces management.

   All of these sit behind the same AdminGuard as GET /admin/me, so a non-admin
   never reaches them (the /admin layout's gate refuses first). The mutations
   invalidate the affected user/workspace detail and the list prefix so a change
   is reflected without a manual refetch.
   ============================================================ */

function toQuery(search?: string): string {
  const params = new URLSearchParams();
  if (search && search.trim()) params.set("search", search.trim());
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function useAdminUsers(search?: string) {
  return useQuery({
    queryKey: qk.adminUsers(toQuery(search) || "all"),
    queryFn: () => request(`/admin/users${toQuery(search)}`, AdminUserList),
  });
}

export function useAdminUser(id: string) {
  return useQuery({
    queryKey: qk.adminUser(id),
    queryFn: () => request(`/admin/users/${id}`, AdminUserDetail),
    enabled: Boolean(id),
  });
}

export function useAdminWorkspaces(search?: string) {
  return useQuery({
    queryKey: qk.adminWorkspaces(toQuery(search) || "all"),
    queryFn: () => request(`/admin/workspaces${toQuery(search)}`, AdminWorkspaceList),
  });
}

export function useAdminWorkspace(id: string) {
  return useQuery({
    queryKey: qk.adminWorkspace(id),
    queryFn: () => request(`/admin/workspaces/${id}`, AdminWorkspaceDetail),
    enabled: Boolean(id),
  });
}

/** The read-only "view as" snapshot. Fetched on demand (the detail page opens
 *  it in a panel), and every fetch records an audit row on the server. */
export function useAdminViewAs(id: string, opts: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: qk.adminWorkspaceViewAs(id),
    queryFn: () => request(`/admin/workspaces/${id}/view-as`, AdminViewAsWorkspace),
    enabled: Boolean(id) && (opts.enabled ?? false),
    // A view is an action; don't silently re-fetch (and re-audit) in the
    // background. The panel refetches explicitly when reopened.
    staleTime: Infinity,
  });
}

/** One hook for the four POST user actions, keyed by the action's path segment.
 *  Each returns the uniform AdminActionResult and invalidates the user + list. */
function useUserAction(segment: string, method: "POST" | "DELETE" = "POST") {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      request(`/admin/users/${id}${segment}`, AdminActionResult, { method }),
    onSuccess: (_res, id) => {
      qc.invalidateQueries({ queryKey: qk.adminUser(id) });
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    },
  });
}

export const useAdminSuspendUser = () => useUserAction("/suspend");
export const useAdminUnsuspendUser = () => useUserAction("/unsuspend");
export const useAdminSignOutEverywhere = () => useUserAction("/signout-everywhere");
export const useAdminResendVerification = () => useUserAction("/resend-verification");
export const useAdminDeleteUser = () => useUserAction("", "DELETE");

/** The manual plan/limit edit. Returns the updated workspace detail. */
export function useAdminUpdateWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: AdminUpdateWorkspaceInput & { id: string }) =>
      request(`/admin/workspaces/${id}`, AdminWorkspaceDetail, { method: "PATCH", body: input }),
    onSuccess: (ws) => {
      qc.setQueryData(qk.adminWorkspace(ws.id), ws);
      qc.invalidateQueries({ queryKey: ["admin-workspaces"] });
    },
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

/* ============================================================
   #972 — runtime platform settings.

   GET /admin/settings returns the effective values, the defaults and the
   per-setting "last changed by". PATCH applies a partial change and returns the
   fresh state, which we write straight back into the cache so the page reflects
   it without a refetch. A settings change can affect the rate limit and the
   banner, so the mutation also drops the public banner query (read elsewhere).
   ============================================================ */

export function useAdminSettings() {
  return useQuery({
    queryKey: qk.adminSettings,
    queryFn: () => request("/admin/settings", PlatformSettings),
  });
}

export function useAdminUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: PlatformSettingsInput) =>
      request("/admin/settings", PlatformSettings, { method: "PATCH", body: input }),
    onSuccess: (settings) => {
      qc.setQueryData(qk.adminSettings, settings);
      qc.invalidateQueries({ queryKey: qk.platformBanner });
      qc.invalidateQueries({ queryKey: qk.adminAudit() });
    },
  });
}

/* #1020 — runtime kill switches. Read the effective state (values, defaults,
   provenance, cache TTL); PATCH folds a partial change + a required reason and
   records an audit row. The audit viewer is invalidated so its change history
   refreshes. */
export function useAdminKillSwitches() {
  return useQuery({
    queryKey: qk.adminKillSwitches,
    queryFn: () => request("/admin/killswitches", KillSwitchesView),
  });
}

export function useAdminUpdateKillSwitches() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: KillSwitchesPatchBody) =>
      request("/admin/killswitches", KillSwitchesView, { method: "PATCH", body: input }),
    onSuccess: (view) => {
      qc.setQueryData(qk.adminKillSwitches, view);
      qc.invalidateQueries({ queryKey: qk.adminAudit() });
    },
  });
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

/* ============================================================
   #971 — moderation and abuse.

   Same platform-admin gate as every /admin/* hook above. The abuse-queue,
   link-search, disable and blocklist mutations invalidate the views they
   change so the panel (and the admin audit log) reflect the action at once.
   ============================================================ */

/** The global abuse queue, including reports with no workspace. */
export function useAdminAbuseQueue(q: Partial<AdminAbuseQueueQuery> = {}) {
  const params = new URLSearchParams();
  if (q.status) params.set("status", q.status);
  if (q.orphaned != null) params.set("orphaned", String(q.orphaned));
  if (q.limit != null) params.set("limit", String(q.limit));
  if (q.offset != null) params.set("offset", String(q.offset));
  const qs = params.toString() ? `?${params.toString()}` : "";
  return useQuery({
    queryKey: qk.adminAbuseQueue(qs),
    queryFn: () => request(`/admin/abuse-reports${qs}`, AdminAbuseQueuePage),
  });
}

/** Act on one abuse report: move its status and/or disable its link. */
export function useActOnAbuseReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; input: AdminAbuseReportAction }) =>
      request(`/admin/abuse-reports/${vars.id}/action`, z.undefined(), { method: "POST", body: vars.input }),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: qk.adminAbuseQueue() }),
        qc.invalidateQueries({ queryKey: qk.adminLinkSearch() }),
        qc.invalidateQueries({ queryKey: qk.adminAudit() }),
      ]),
  });
}

/** Platform link search — by slug, destination or owner. */
export function useAdminLinkSearch(q: Partial<AdminLinkSearchQuery> = {}) {
  const params = new URLSearchParams();
  if (q.q) params.set("q", q.q);
  if (q.disabled != null) params.set("disabled", String(q.disabled));
  if (q.limit != null) params.set("limit", String(q.limit));
  if (q.offset != null) params.set("offset", String(q.offset));
  const qs = params.toString() ? `?${params.toString()}` : "";
  return useQuery({
    queryKey: qk.adminLinkSearch(qs),
    queryFn: () => request(`/admin/links${qs}`, AdminLinkPage),
  });
}

/** Disable or re-enable a link platform-wide. */
export function useAdminDisableLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; input: AdminLinkDisableInput }) =>
      request(`/admin/links/${vars.id}/disable`, z.undefined(), { method: "POST", body: vars.input }),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: qk.adminLinkSearch() }),
        qc.invalidateQueries({ queryKey: qk.adminAbuseQueue() }),
        qc.invalidateQueries({ queryKey: qk.adminFlaggedLinks }),
        qc.invalidateQueries({ queryKey: qk.adminAudit() }),
      ]),
  });
}

/** The destination blocklist. */
export function useAdminBlockedDomains() {
  return useQuery({
    queryKey: qk.adminBlockedDomains,
    queryFn: () => request("/admin/blocked-domains", AdminBlockedDomains),
  });
}

/** Add a destination host to the blocklist. */
export function useAddBlockedDomain() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AddBlockedDomainInput) =>
      request("/admin/blocked-domains", AdminBlockedDomain, { method: "POST", body: input }),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: qk.adminBlockedDomains }),
        qc.invalidateQueries({ queryKey: qk.adminAudit() }),
      ]),
  });
}

/** Remove a destination host from the blocklist. */
export function useRemoveBlockedDomain() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => request(`/admin/blocked-domains/${id}`, z.undefined(), { method: "DELETE" }),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: qk.adminBlockedDomains }),
        qc.invalidateQueries({ queryKey: qk.adminAudit() }),
      ]),
  });
}

/** Links Safe Browsing has flagged, platform-wide. */
export function useAdminFlaggedLinks() {
  return useQuery({
    queryKey: qk.adminFlaggedLinks,
    queryFn: () => request("/admin/flagged-links", AdminFlaggedLinks),
  });
}

/** Every custom domain with its verification and SSL status. */
export function useAdminCustomDomains() {
  return useQuery({
    queryKey: qk.adminCustomDomains,
    queryFn: () => request("/admin/custom-domains", AdminCustomDomains),
  });
}

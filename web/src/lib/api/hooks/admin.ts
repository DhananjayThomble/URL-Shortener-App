"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AdminActionResult,
  AdminMe,
  AdminUserDetail,
  AdminUserList,
  AdminViewAsWorkspace,
  AdminWorkspaceDetail,
  AdminWorkspaceList,
  type AdminUpdateWorkspaceInput,
} from "@snapurl/contract";
import { request } from "../client";
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

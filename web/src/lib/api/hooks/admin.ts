"use client";

import { useQuery } from "@tanstack/react-query";
import {
  AdminMe,
  PlatformAnalytics,
  type AdminAnalyticsCsvView,
  type AdminAnalyticsRange,
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

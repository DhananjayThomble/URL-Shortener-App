"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FeedbackDetail,
  FeedbackPage,
  SubmitFeedbackResult,
  type FeedbackListQuery,
  type SubmitFeedbackInput,
  type UpdateFeedbackInput,
} from "@snapurl/contract";
import { request } from "../client";
import { qk } from "./keys";

/* ============================================================
   #997 — in-app "Report a problem".

   Two surfaces share this file: the PUBLIC intake (the shell/error-page button,
   usable signed in or out) and the platform-admin INBOX (behind AdminGate).
   ============================================================ */

/**
 * Submit a problem report (public intake).
 *
 * The default options (not `anonymous`) are exactly right here: the client
 * attaches the bearer WHEN ONE IS PRESENT, so the API can read the signed-in
 * submitter's context from the session; when signed out there is simply no
 * token to attach and the `@Public` route accepts the request. The endpoint
 * never 401s, so the refresh-and-retry path is never taken. No cache write — a
 * report is a fire-and-forget write, not page data.
 */
export function useSubmitFeedback() {
  return useMutation({
    mutationFn: (input: SubmitFeedbackInput) =>
      request("/public/feedback", SubmitFeedbackResult, { method: "POST", body: input }),
  });
}

/* ---- admin inbox ---- */

/** The feedback inbox, newest first, optionally filtered by status. */
export function useAdminFeedback(q: Partial<FeedbackListQuery> = {}) {
  const params = new URLSearchParams();
  if (q.status) params.set("status", q.status);
  if (q.limit != null) params.set("limit", String(q.limit));
  if (q.offset != null) params.set("offset", String(q.offset));
  const qs = params.toString() ? `?${params.toString()}` : "";
  return useQuery({
    queryKey: qk.adminFeedback(qs),
    queryFn: () => request(`/admin/feedback${qs}`, FeedbackPage),
  });
}

/** One feedback report in full, including its screenshot. */
export function useAdminFeedbackItem(id: string, enabled = true) {
  return useQuery({
    queryKey: qk.adminFeedbackItem(id),
    queryFn: () => request(`/admin/feedback/${id}`, FeedbackDetail),
    enabled: Boolean(id) && enabled,
  });
}

/** Move a report's status and/or set operator notes. Invalidates the list and
 *  the item so the inbox and the admin audit log reflect the change at once. */
export function useUpdateFeedback() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: string; input: UpdateFeedbackInput }) =>
      request(`/admin/feedback/${vars.id}`, FeedbackDetail, { method: "PATCH", body: vars.input }),
    onSuccess: (_data, vars) =>
      Promise.all([
        qc.invalidateQueries({ queryKey: qk.adminFeedback() }),
        qc.invalidateQueries({ queryKey: qk.adminFeedbackItem(vars.id) }),
        qc.invalidateQueries({ queryKey: qk.adminAudit() }),
      ]),
  });
}

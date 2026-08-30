"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { AbuseReport, type UpdateAbuseReportInput } from "@snapurl/contract";
import { request } from "../client";
import { qk } from "./keys";

/* ============================================================
   Operator-side abuse-report review — #291 (FEAT-003).

   The authed queue an operator uses to see reports filed against their own
   links and act on them: move a report through its status, and/or flag the
   underlying link (which sets safeBrowsingStatus='flagged' server-side, the
   exact value the redirect gate blocks on).
   ============================================================ */

export function useReports() {
  return useQuery({ queryKey: qk.reports, queryFn: () => request("/reports", z.array(AbuseReport)) });
}

export function useReviewReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateAbuseReportInput & { id: string }) =>
      request(`/reports/${id}`, AbuseReport, { method: "PATCH", body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.reports }),
  });
}

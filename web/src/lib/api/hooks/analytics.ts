"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Analytics,
  ConversionsReport,
  RecordConversionResult,
  type AnalyticsRange,
  type RecordConversionInput,
} from "@snapurl/contract";
import { request } from "../client";
import { qk } from "./keys";

/** `range` is typed to the five windows the API actually serves, so a typo in a
 *  range selector is a compile error rather than a silently empty chart. */
export function useAnalytics(range: AnalyticsRange = "30d", linkId?: string) {
  return useQuery({
    queryKey: qk.analytics(range, linkId),
    queryFn: () => request(`/analytics?range=${range}${linkId ? `&linkId=${linkId}` : ""}`, Analytics),
  });
}

export function useConversions(range: AnalyticsRange = "30d") {
  return useQuery({
    queryKey: qk.conversions(range),
    queryFn: () => request(`/conversions?range=${range}`, ConversionsReport),
  });
}

/**
 * Report a conversion.
 *
 * Normally called server-to-server with an API key rather than from this app,
 * which is why it carries its own `conversions:write` scope. The hook exists so
 * the dashboard can record test conversions while someone is wiring up their
 * integration. `recorded: false` means externalId matched an existing row and
 * the ingest deduplicated it — not a failure.
 */
export function useRecordConversion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: RecordConversionInput) =>
      request("/conversions", RecordConversionResult, { method: "POST", body: input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conversions"] });
      qc.invalidateQueries({ queryKey: ["analytics"] });
    },
  });
}

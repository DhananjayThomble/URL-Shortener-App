"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Workspace, type UpdateWorkspaceInput } from "@snapurl/contract";
import { request } from "../client";
import { qk } from "./keys";

export function useWorkspace() {
  return useQuery({
    queryKey: qk.workspace,
    queryFn: () => request("/workspaces/current", Workspace),
    staleTime: 5 * 60_000,
  });
}

/**
 * Save workspace settings.
 *
 * The input is fully partial, so a single toggle sends one field rather than
 * re-submitting the whole form and racing another tab's change.
 */
export function useUpdateWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpdateWorkspaceInput) =>
      request("/workspaces/current", Workspace, { method: "PATCH", body: input }),
    onSuccess: (workspace) => {
      qc.setQueryData(qk.workspace, workspace);
      // Retention and the privacy toggles change what the dashboards report.
      qc.invalidateQueries({ queryKey: ["analytics"] });
      qc.invalidateQueries({ queryKey: ["conversions"] });
    },
  });
}

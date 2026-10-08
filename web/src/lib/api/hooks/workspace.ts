"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  UserWorkspace,
  Workspace,
  WorkspaceSession,
  type AcceptInviteInput,
  type UpdateWorkspaceInput,
} from "@snapurl/contract";
import { request, tokens } from "../client";
import { qk } from "./keys";

export function useWorkspace() {
  return useQuery({
    queryKey: qk.workspace,
    queryFn: () => request("/workspaces/current", Workspace),
    staleTime: 5 * 60_000,
  });
}

/* ── #668: multi-workspace ─────────────────────────────────────────────────
   An access token is bound to one workspace, so entering another (accepting
   an invitation, or picking it in the switcher) swaps the access token and
   throws away every cached query — each one was answered for the old
   workspace, and showing it under the new name would be a cross-tenant leak
   on screen even though the API itself never mixes them. */

function enterWorkspace(qc: ReturnType<typeof useQueryClient>, session: WorkspaceSession) {
  tokens.setAccess(session.accessToken);
  qc.clear();
  qc.setQueryData(qk.me, session.user);
}

/** Workspaces the signed-in user is an active member of, for the switcher. */
export function useMyWorkspaces() {
  return useQuery({
    queryKey: qk.myWorkspaces,
    queryFn: () => request("/auth/workspaces", z.array(UserWorkspace)),
    staleTime: 60_000,
  });
}

export function useSwitchWorkspace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (workspaceId: string) =>
      request("/auth/workspace", WorkspaceSession, { method: "POST", body: { workspaceId } }),
    onSuccess: (session) => enterWorkspace(qc, session),
  });
}

/** Accept a team invitation; on success this session is in the joined workspace. */
export function useAcceptInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AcceptInviteInput) =>
      request("/auth/invite/accept", WorkspaceSession, { method: "POST", body }),
    onSuccess: (session) => enterWorkspace(qc, session),
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

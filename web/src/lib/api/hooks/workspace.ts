"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { z } from "zod";
import {
  AcceptedInvite,
  UserWorkspace,
  Workspace,
  type AcceptInviteInput,
  type AuthUser,
  type UpdateWorkspaceInput,
} from "@snapurl/contract";
import {
  ACCESS_TOKEN_STORAGE_KEY,
  WORKSPACE_CHANGED_EVENT,
  checkWorkspaceCoherence,
  enterWorkspace,
  noteRenderedWorkspace,
  request,
  workspaceIdOf,
} from "../client";
import { qk } from "./keys";

/** How fresh the live usage figure is kept (#771). The click rollup lands about every
 *  30 s, so asking more often than that cannot show anything newer. */
export const LIVE_WORKSPACE_STALE_MS = 30_000;
/** Poll cadence for the live usage figure. React Query pauses it in a hidden tab. */
export const LIVE_WORKSPACE_REFETCH_MS = 60_000;

/**
 * The current workspace.
 *
 * `live` is for the one reader that shows `clicksUsed` and stays mounted for the
 * whole session (the sidebar). Every other field changes only through the user's
 * own Settings save, which writes the cache, so the 5-minute staleTime is right
 * for them; but `clicksUsed` moves server-side while the page is open, and
 * without this the sidebar kept the first value until a full reload (#771).
 * `live` re-requests on focus (once stale) and on a slow interval; the query is
 * shared, so Settings → Usage catches up through the same fetch.
 */
export function useWorkspace(options?: { live?: boolean }) {
  const live = options?.live ?? false;
  return useQuery({
    queryKey: qk.workspace,
    queryFn: async () => {
      const workspace = await request("/workspaces/current", Workspace);
      // #699 — this answer is what the sidebar and settings render from.
      noteRenderedWorkspace(workspace.id);
      return workspace;
    },
    staleTime: live ? LIVE_WORKSPACE_STALE_MS : 5 * 60_000,
    ...(live ? { refetchInterval: LIVE_WORKSPACE_REFETCH_MS, refetchOnWindowFocus: true } : {}),
  });
}

/* ── #668: multi-workspace ─────────────────────────────────────────────────
   An access token is bound to one workspace, so entering another (accepting
   an invitation, or picking it in the switcher) swaps the access token and
   throws away every cached query — each one was answered for the old
   workspace, and showing it under the new name would be a cross-tenant leak
   on screen even though the API itself never mixes them.

   #699: the new access token comes from POST /auth/refresh with the target
   workspace (enterWorkspace in client.ts), never from an access token alone,
   so a revoked session cannot use this to stay alive. Other tabs, and a
   refresh that falls back elsewhere, are handled by WorkspaceChangeGuard. */

async function moveInto(qc: ReturnType<typeof useQueryClient>, workspaceId: string, user?: AuthUser) {
  await enterWorkspace(workspaceId);
  qc.clear();
  if (user) qc.setQueryData(qk.me, user);
}

/**
 * #699 — keep this tab's screen in the workspace its token is actually in.
 *
 * Tokens live in localStorage, shared by every tab, and each request reads the
 * token when it is sent. So when another tab switches workspace (or accepts an
 * invitation), this tab's next request already goes to the NEW workspace while
 * its sidebar and cached lists still show the OLD one — a save on the Settings
 * page would write the old workspace's values into the new one. The same
 * happens in this tab when a refresh falls back to the default workspace
 * because the membership it was in has gone.
 *
 * On either signal, every cached query is reset (data dropped, active ones
 * refetched with the current token) and the tab is routed to /links.
 *
 * The comparison is against the workspace this tab RENDERED (see
 * noteRenderedWorkspace in client.ts), not the token's previous value: a
 * sign-out then sign-in in another tab arrives here as two events, A → none
 * and none → B, and neither one alone carries both workspaces.
 */
export function useWorkspaceChangeGuard() {
  const qc = useQueryClient();
  const router = useRouter();
  useEffect(() => {
    const moved = () => {
      void qc.resetQueries();
      router.replace("/links");
    };
    const onStorage = (event: StorageEvent) => {
      if (event.storageArea && typeof window !== "undefined" && event.storageArea !== window.localStorage) return;
      if (event.key !== ACCESS_TOKEN_STORAGE_KEY && event.key !== null) return;
      // Dispatches WORKSPACE_CHANGED_EVENT (handled below) on a mismatch.
      checkWorkspaceCoherence(workspaceIdOf(event.oldValue));
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(WORKSPACE_CHANGED_EVENT, moved);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(WORKSPACE_CHANGED_EVENT, moved);
    };
  }, [qc, router]);
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
    mutationFn: (workspaceId: string) => moveInto(qc, workspaceId),
  });
}

/** Accept a team invitation; on success this session is in the joined workspace. */
export function useAcceptInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: AcceptInviteInput) => {
      const accepted = await request("/auth/invite/accept", AcceptedInvite, { method: "POST", body });
      await moveInto(qc, accepted.workspaceId, accepted.user);
      return accepted;
    },
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

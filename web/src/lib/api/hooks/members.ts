"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { AuditEntry, Member, type InviteMemberInput, type MemberRole } from "@snapurl/contract";
import { request } from "../client";
import { qk } from "./keys";

export function useMembers() {
  return useQuery({ queryKey: qk.members, queryFn: () => request("/members", z.array(Member)) });
}

export function useAudit() {
  return useQuery({ queryKey: qk.audit, queryFn: () => request("/audit", z.array(AuditEntry)) });
}

export function useInviteMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: InviteMemberInput) => request("/members", Member, { method: "POST", body: input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.members });
      qc.invalidateQueries({ queryKey: qk.audit });
    },
  });
}

/** `owner` is excluded by the contract's InviteMemberInput but allowed here:
 *  transferring ownership is a role change on an existing member, not an invite. */
export function useChangeMemberRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, role }: { id: string; role: MemberRole }) =>
      request(`/members/${id}`, z.undefined(), { method: "PATCH", body: { role } }),
    /* Returned, so the mutation stays pending until the refetch lands: the team
       page reads the new role from the list, and without this it would show the
       old one for a beat after the change succeeded (#781). */
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: qk.members }),
        qc.invalidateQueries({ queryKey: qk.audit }),
        // The caller may have just changed their own role, which gates the UI.
        qc.invalidateQueries({ queryKey: qk.me }),
      ]),
  });
}

export function useRemoveMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => request(`/members/${id}`, z.undefined(), { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.members });
      qc.invalidateQueries({ queryKey: qk.audit });
    },
  });
}

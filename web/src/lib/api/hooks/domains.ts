"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { Domain, type AddDomainInput } from "@snapurl/contract";
import { request } from "../client";
import { qk } from "./keys";

export function useDomains() {
  return useQuery({ queryKey: qk.domains, queryFn: () => request("/domains", z.array(Domain)) });
}

export function useAddDomain() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: AddDomainInput) => request("/domains", Domain, { method: "POST", body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.domains }),
  });
}

/**
 * Re-check a domain's DNS.
 *
 * Returns the domain with its refreshed status rather than 204, so the row can
 * update in place — a verification that just succeeded should not need a manual
 * refresh to show as live.
 */
export function useVerifyDomain() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => request(`/domains/${id}/verify`, Domain, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.domains }),
  });
}

export function useDeleteDomain() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => request(`/domains/${id}`, z.undefined(), { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.domains });
      // Links live on domains; removing one changes what the list can resolve.
      qc.invalidateQueries({ queryKey: ["links"] });
    },
  });
}

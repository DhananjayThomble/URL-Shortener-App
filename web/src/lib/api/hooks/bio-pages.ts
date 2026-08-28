"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { BioPage, type UpsertBioPageInput } from "@snapurl/contract";
import { request } from "../client";
import { qk } from "./keys";

export function useBioPages() {
  return useQuery({ queryKey: qk.bioPages, queryFn: () => request("/bio-pages", z.array(BioPage)) });
}

/** PUT, not POST: the endpoint is keyed on (domain, slug), so saving an existing
 *  page and creating a new one are the same call. */
export function useUpsertBioPage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: UpsertBioPageInput) => request("/bio-pages", BioPage, { method: "PUT", body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.bioPages }),
  });
}

export function useDeleteBioPage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => request(`/bio-pages/${id}`, z.undefined(), { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.bioPages }),
  });
}

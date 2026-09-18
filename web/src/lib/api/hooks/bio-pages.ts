"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { BioPage, PublicBioPage, type UpsertBioPageInput } from "@snapurl/contract";
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

/* ---------------- public ---------------- */

/** What a signed-out visitor at /b/<slug> sees. No auth, and no workspace
 *  analytics — only the profile and the blocks meant to be clicked. */
export function usePublicBioPage(slug: string) {
  return useQuery({
    queryKey: qk.publicBioPage(slug),
    queryFn: () => request(`/public/bio-pages/${encodeURIComponent(slug)}`, PublicBioPage, { anonymous: true }),
    enabled: Boolean(slug),
    retry: false,
  });
}

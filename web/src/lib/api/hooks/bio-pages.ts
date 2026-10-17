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

/** What a signed-out visitor at /b/<slug> sees — the backward-compatible slug
 *  alias (#650). Resolves on the shared/system domain only. No auth, and no
 *  workspace analytics — only the profile and the blocks meant to be clicked. */
export function usePublicBioPage(slug: string) {
  return useQuery({
    queryKey: qk.publicBioPage(slug),
    queryFn: () => request(`/public/bio-pages/${encodeURIComponent(slug)}`, PublicBioPage, { anonymous: true }),
    enabled: Boolean(slug),
    retry: false,
  });
}

/** What a visitor at /b/<domain>/<slug> sees — the per-domain route (#650) the
 *  managed link 302s to. */
export function usePublicBioPageByDomain(domain: string, slug: string) {
  return useQuery({
    queryKey: qk.publicBioPageByDomain(domain, slug),
    queryFn: () =>
      request(
        `/public/bio-pages/by-domain/${encodeURIComponent(domain)}/${encodeURIComponent(slug)}`,
        PublicBioPage,
        { anonymous: true },
      ),
    enabled: Boolean(domain && slug),
    retry: false,
  });
}

/** Counts one view of a published page via the slug alias. Fire-and-forget: a
 *  visitor's page must never break because a counter could not be written. */
export function recordBioView(slug: string) {
  return request(`/public/bio-pages/${encodeURIComponent(slug)}/view`, z.undefined(), {
    method: "POST",
    anonymous: true,
  }).catch(() => undefined);
}

/** Counts one view via the per-domain route. */
export function recordBioViewByDomain(domain: string, slug: string) {
  return request(
    `/public/bio-pages/by-domain/${encodeURIComponent(domain)}/${encodeURIComponent(slug)}/view`,
    z.undefined(),
    { method: "POST", anonymous: true },
  ).catch(() => undefined);
}

/** Counts one click on a block via the slug alias. `keepalive`, because the
 *  visitor is navigating away in the same instant and the browser would
 *  otherwise cancel it. */
export function recordBioClick(slug: string, blockId: string) {
  return request(
    `/public/bio-pages/${encodeURIComponent(slug)}/blocks/${encodeURIComponent(blockId)}/click`,
    z.undefined(),
    { method: "POST", anonymous: true, keepalive: true },
  ).catch(() => undefined);
}

/** Counts one click on a block via the per-domain route. */
export function recordBioClickByDomain(domain: string, slug: string, blockId: string) {
  return request(
    `/public/bio-pages/by-domain/${encodeURIComponent(domain)}/${encodeURIComponent(slug)}/blocks/${encodeURIComponent(blockId)}/click`,
    z.undefined(),
    { method: "POST", anonymous: true, keepalive: true },
  ).catch(() => undefined);
}

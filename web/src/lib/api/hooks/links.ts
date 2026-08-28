"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { Link, LinkList, type CreateLinkInput, type ListLinksQuery, type UpdateLinkInput } from "@snapurl/contract";
import { request } from "../client";
import { qk } from "./keys";

/**
 * What `useLinks` accepts.
 *
 * A bare string is the original signature — several pages call `useLinks(filter)`
 * with a status tab — and it keeps working. The object form exposes the search,
 * tag, folder, domain and cursor parameters that LinksService.list has always
 * implemented but the UI had no way to reach.
 */
export type LinksFilter = string | Partial<ListLinksQuery>;

function normalise(filter?: LinksFilter): Partial<ListLinksQuery> {
  if (!filter) return {};
  if (typeof filter === "string") return filter === "all" ? {} : { status: filter as ListLinksQuery["status"] };
  const { status, ...rest } = filter;
  return status && status !== "all" ? { status, ...rest } : rest;
}

function toSearchParams(query: Partial<ListLinksQuery>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export function useLinks(filter?: LinksFilter) {
  const query = normalise(filter);
  return useQuery({
    // Serialised so that two different filter objects with the same meaning
    // share a cache entry, and a mutation invalidating ["links"] clears them all.
    queryKey: qk.links(toSearchParams(query) || "all"),
    queryFn: () => request(`/links${toSearchParams(query)}`, LinkList),
  });
}

export function useLink(id: string) {
  return useQuery({
    queryKey: qk.link(id),
    queryFn: () => request(`/links/${id}`, Link),
    enabled: Boolean(id),
  });
}

export function useCreateLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateLinkInput) => request("/links", Link, { method: "POST", body: input }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["links"] });
      qc.invalidateQueries({ queryKey: ["analytics"] });
    },
  });
}

/**
 * Edit a link in place (G1).
 *
 * This is the hook behind "print it once, change where it points forever" —
 * without it PATCH /links/:id is unreachable and the QR feature is dishonest.
 * `domain` and `slug` are deliberately not editable: moving a link to a new
 * slug 404s every printed code that already points at the old one, so it is a
 * separate operation rather than a field in a partial update.
 */
export function useUpdateLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateLinkInput & { id: string }) =>
      request(`/links/${id}`, Link, { method: "PATCH", body: input }),
    onSuccess: (link) => {
      qc.setQueryData(qk.link(link.id), link);
      qc.invalidateQueries({ queryKey: ["links"] });
      qc.invalidateQueries({ queryKey: ["analytics"] });
    },
  });
}

export function useDeleteLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => request(`/links/${id}`, z.undefined(), { method: "DELETE" }),
    onSuccess: (_result, id) => {
      qc.removeQueries({ queryKey: qk.link(id) });
      qc.invalidateQueries({ queryKey: ["links"] });
      qc.invalidateQueries({ queryKey: ["analytics"] });
    },
  });
}

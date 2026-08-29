"use client";

import { useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  Link,
  LinkList,
  type CloneLinkInput,
  type CreateLinkInput,
  type ListLinksQuery,
  type UpdateLinkInput,
} from "@snapurl/contract";
import { request, API_URL, tokens } from "../client";
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

/**
 * Duplicate a link under a new back-half.
 *
 * Sending an empty body is the ordinary case: the server generates a slug and
 * carries everything else over, including the password. Passing `password:
 * null` is the only way to drop protection, which is deliberate — a clone that
 * silently lost its password would be a link the workspace believes is private
 * and is not.
 */
export function useCloneLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: CloneLinkInput & { id: string }) =>
      request(`/links/${id}/clone`, Link, { method: "POST", body: input }),
    onSuccess: () => {
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

/**
 * Download the workspace's links as CSV.
 *
 * Not a plain `<a href>`: the endpoint needs an Authorization header, and an
 * anchor cannot send one. So this fetches with the token, turns the response
 * into a blob URL, and clicks a synthetic link.
 *
 * `request()` is deliberately bypassed — it parses JSON against a zod schema,
 * and this response is neither JSON nor a shape the contract describes.
 */
export function useExportLinks() {
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (filter?: string) => {
    setExporting(true);
    setError(null);
    let url: string | null = null;
    try {
      const qs = filter && filter !== "all" ? `?status=${encodeURIComponent(filter)}` : "";
      const res = await fetch(`${API_URL}/links/export${qs}`, {
        headers: tokens.access ? { Authorization: `Bearer ${tokens.access}` } : {},
      });
      if (!res.ok) throw new Error(`Export failed (${res.status})`);

      url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `snapurl-links-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed");
    } finally {
      // Revoking frees the blob; without it the file stays in memory for the
      // lifetime of the tab, which for a large export is real memory.
      if (url) URL.revokeObjectURL(url);
      setExporting(false);
    }
  };

  return { run, exporting, error };
}

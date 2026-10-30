"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import {
  PublicLinkLock,
  PublicLinkPreview,
  SubmitReportResult,
  UnlockLinkResult,
  type SubmitReportInput,
  type UnlockLinkInput,
} from "@snapurl/contract";
import { request } from "../client";
import { qk } from "./keys";

/* #800 — the host the slug was resolved on, carried through from the redirect's
   /p/<slug>?host= bounce. One slug can live on several domains (uniqueness is
   (domain_id, lower(slug))), so a hostless lookup can pick the wrong domain's
   link. The query is scoped by host, and the host is part of the cache key so
   two domains' same slug do not share a cached answer. An empty host sends no
   parameter — the API falls back to a slug-only lookup, so older links still
   work (deploy skew). */
function withHost(path: string, host?: string): string {
  return host ? `${path}?host=${encodeURIComponent(host)}` : path;
}

export function useLinkPreview(slug: string, host?: string) {
  return useQuery({
    queryKey: qk.preview(slug, host),
    queryFn: () => request(withHost(`/public/links/${slug}/preview`, host), PublicLinkPreview, { anonymous: true }),
    enabled: Boolean(slug),
  });
}

/**
 * Whether a password guards a link (#762), for the unlock form when the preview
 * was refused because the owner turned public previews off. Carries the short
 * URL and the flag, never the destination. Only fetched when `enabled` — the
 * page asks for it on a previews-off 403, nowhere else. Scoped to the resolved
 * host (#800), so a same-slug link on another domain is never consulted.
 */
export function useLinkLock(slug: string, enabled: boolean, host?: string) {
  return useQuery({
    queryKey: qk.lock(slug, host),
    queryFn: () => request(withHost(`/public/links/${slug}/lock`, host), PublicLinkLock, { anonymous: true }),
    enabled: Boolean(slug) && enabled,
  });
}

/**
 * Submit the password for a protected link (G3).
 *
 * Returns a short-lived token to append to the short URL as `?k=…` rather than
 * the destination itself. Handing back the destination would skip click
 * recording, so password-protected links would report zero analytics; a cookie
 * would break the "no cookies set" promise this very page makes. The token
 * lives five minutes and is bound to one link id, because a query string is
 * visible in browser history.
 *
 * Deliberately no cache write: an unlock token is a credential, not page data.
 */
export function useUnlockLink(slug: string, host?: string) {
  return useMutation({
    mutationFn: (input: UnlockLinkInput) =>
      request(withHost(`/public/links/${slug}/unlock`, host), UnlockLinkResult, {
        method: "POST",
        body: input,
        anonymous: true,
      }),
  });
}

/**
 * Report an abusive link (#291).
 *
 * Unauthenticated, like preview and unlock. The server always answers
 * { ok: true } whether or not the slug resolves, so this cannot be used to
 * probe which short codes exist. No cache write — a report is a fire-and-forget
 * write, not page data. Carries the resolved host (#738) so a slug that exists
 * on several domains is attributed to the right one.
 */
export function useReportLink(slug: string, host?: string) {
  return useMutation({
    mutationFn: (input: SubmitReportInput) =>
      request(withHost(`/public/links/${slug}/report`, host), SubmitReportResult, { method: "POST", body: input, anonymous: true }),
  });
}

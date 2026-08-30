"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import {
  PublicLinkPreview,
  SubmitReportResult,
  UnlockLinkResult,
  type SubmitReportInput,
  type UnlockLinkInput,
} from "@snapurl/contract";
import { request } from "../client";
import { qk } from "./keys";

export function useLinkPreview(slug: string) {
  return useQuery({
    queryKey: qk.preview(slug),
    queryFn: () => request(`/public/links/${slug}/preview`, PublicLinkPreview, { anonymous: true }),
    enabled: Boolean(slug),
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
export function useUnlockLink(slug: string) {
  return useMutation({
    mutationFn: (input: UnlockLinkInput) =>
      request(`/public/links/${slug}/unlock`, UnlockLinkResult, { method: "POST", body: input, anonymous: true }),
  });
}

/**
 * Report an abusive link (#291).
 *
 * Unauthenticated, like preview and unlock. The server always answers
 * { ok: true } whether or not the slug resolves, so this cannot be used to
 * probe which short codes exist. No cache write — a report is a fire-and-forget
 * write, not page data.
 */
export function useReportLink(slug: string) {
  return useMutation({
    mutationFn: (input: SubmitReportInput) =>
      request(`/public/links/${slug}/report`, SubmitReportResult, { method: "POST", body: input, anonymous: true }),
  });
}

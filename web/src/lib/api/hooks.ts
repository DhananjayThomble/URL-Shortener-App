"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { request, tokens } from "./client";
import {
  Analytics,
  ApiKey,
  AuditEntry,
  AuthSession,
  AuthUser,
  BioPage,
  ConversionsReport,
  CreateLinkInput,
  Domain,
  Link,
  Member,
  PublicLinkPreview,
  Webhook,
  Workspace,
} from "./types";

/* Query keys live in one place so invalidation can't drift from fetching. */
export const qk = {
  me: ["me"] as const,
  workspace: ["workspace"] as const,
  links: (filter?: string) => ["links", filter ?? "all"] as const,
  link: (id: string) => ["link", id] as const,
  analytics: (range: string, linkId?: string) => ["analytics", range, linkId ?? "workspace"] as const,
  domains: ["domains"] as const,
  members: ["members"] as const,
  audit: ["audit"] as const,
  apiKeys: ["api-keys"] as const,
  webhooks: ["webhooks"] as const,
  bioPages: ["bio-pages"] as const,
  conversions: (range: string) => ["conversions", range] as const,
  preview: (slug: string) => ["preview", slug] as const,
};

const LinkList = z.object({ items: z.array(Link), total: z.number() });

export function useMe() {
  return useQuery({
    queryKey: qk.me,
    queryFn: () => request("/auth/me", AuthUser),
    retry: false,
    staleTime: 5 * 60_000,
  });
}

export function useWorkspace() {
  return useQuery({
    queryKey: qk.workspace,
    queryFn: () => request("/workspaces/current", Workspace),
    staleTime: 5 * 60_000,
  });
}

export function useLinks(filter?: string) {
  return useQuery({
    queryKey: qk.links(filter),
    queryFn: () => request(`/links${filter && filter !== "all" ? `?status=${filter}` : ""}`, LinkList),
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

export function useDeleteLink() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => request(`/links/${id}`, z.undefined(), { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["links"] }),
  });
}

export function useAnalytics(range = "30d", linkId?: string) {
  return useQuery({
    queryKey: qk.analytics(range, linkId),
    queryFn: () =>
      request(`/analytics?range=${range}${linkId ? `&linkId=${linkId}` : ""}`, Analytics),
  });
}

export const useDomains = () => useQuery({ queryKey: qk.domains, queryFn: () => request("/domains", z.array(Domain)) });
export const useMembers = () => useQuery({ queryKey: qk.members, queryFn: () => request("/members", z.array(Member)) });
export const useAudit = () => useQuery({ queryKey: qk.audit, queryFn: () => request("/audit", z.array(AuditEntry)) });
export const useApiKeys = () => useQuery({ queryKey: qk.apiKeys, queryFn: () => request("/api-keys", z.array(ApiKey)) });
export const useWebhooks = () => useQuery({ queryKey: qk.webhooks, queryFn: () => request("/webhooks", z.array(Webhook)) });
export const useBioPages = () => useQuery({ queryKey: qk.bioPages, queryFn: () => request("/bio-pages", z.array(BioPage)) });

export const useConversions = (range = "30d") =>
  useQuery({ queryKey: qk.conversions(range), queryFn: () => request(`/conversions?range=${range}`, ConversionsReport) });

export const useLinkPreview = (slug: string) =>
  useQuery({
    queryKey: qk.preview(slug),
    queryFn: () => request(`/public/links/${slug}/preview`, PublicLinkPreview, { anonymous: true }),
    enabled: Boolean(slug),
  });

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { email: string; password: string }) =>
      request("/auth/login", AuthSession, { method: "POST", body, anonymous: true }),
    onSuccess: (session) => {
      tokens.set(session.accessToken, session.refreshToken);
      qc.setQueryData(qk.me, session.user);
    },
  });
}

export function useRegister() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; email: string; password: string }) =>
      request("/auth/register", AuthSession, { method: "POST", body, anonymous: true }),
    onSuccess: (session) => {
      tokens.set(session.accessToken, session.refreshToken);
      qc.setQueryData(qk.me, session.user);
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return () => {
    tokens.clear();
    qc.clear();
  };
}

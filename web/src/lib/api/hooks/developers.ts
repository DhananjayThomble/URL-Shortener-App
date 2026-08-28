"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import {
  ApiKey,
  CreatedApiKey,
  CreatedWebhook,
  Webhook,
  type CreateApiKeyInput,
  type CreateWebhookInput,
} from "@snapurl/contract";
import { request } from "../client";
import { qk } from "./keys";

export function useApiKeys() {
  return useQuery({ queryKey: qk.apiKeys, queryFn: () => request("/api-keys", z.array(ApiKey)) });
}

/**
 * Mint an API key.
 *
 * The response carries the full key — this is the only time it is ever
 * returned, because the server stores a hash. Show it once and mean it; the
 * list endpoint only ever gives back the masked form.
 */
export function useCreateApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateApiKeyInput) => request("/api-keys", CreatedApiKey, { method: "POST", body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.apiKeys }),
  });
}

export function useRevokeApiKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => request(`/api-keys/${id}`, z.undefined(), { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.apiKeys }),
  });
}

export function useWebhooks() {
  return useQuery({ queryKey: qk.webhooks, queryFn: () => request("/webhooks", z.array(Webhook)) });
}

/** Like an API key, the signing secret comes back exactly once. */
export function useCreateWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateWebhookInput) => request("/webhooks", CreatedWebhook, { method: "POST", body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.webhooks }),
  });
}

export function useDeleteWebhook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => request(`/webhooks/${id}`, z.undefined(), { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.webhooks }),
  });
}

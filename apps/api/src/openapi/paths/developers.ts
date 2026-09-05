import { z } from "zod";
import { IdParam, refs, route } from "../registry.js";

route({
  method: "get",
  path: "/api-keys",
  tag: "API keys",
  summary: "List API keys",
  responses: { 200: { description: "API keys (never the raw key again)", schema: z.array(refs.ApiKey) } },
});

route({
  method: "post",
  path: "/api-keys",
  tag: "API keys",
  summary: "Create an API key",
  body: refs.CreateApiKeyInput,
  responses: {
    201: { description: "The only response that ever includes the raw key", schema: refs.CreatedApiKey },
  },
});

route({
  method: "delete",
  path: "/api-keys/{id}",
  tag: "API keys",
  summary: "Revoke an API key",
  params: IdParam,
  responses: { 204: { description: "Revoked" } },
});

route({
  method: "get",
  path: "/webhooks",
  tag: "Webhooks",
  summary: "List webhooks",
  responses: { 200: { description: "Webhooks (never the signing secret again)", schema: z.array(refs.Webhook) } },
});

route({
  method: "post",
  path: "/webhooks",
  tag: "Webhooks",
  summary: "Create a webhook",
  body: refs.CreateWebhookInput,
  responses: {
    201: { description: "The only response that ever includes the signing secret", schema: refs.CreatedWebhook },
  },
});

route({
  method: "delete",
  path: "/webhooks/{id}",
  tag: "Webhooks",
  summary: "Delete a webhook",
  params: IdParam,
  responses: { 204: { description: "Deleted" } },
});

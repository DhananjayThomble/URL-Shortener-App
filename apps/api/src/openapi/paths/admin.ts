import { z } from "zod";
import { refs, route } from "../registry.js";

/* #968 — platform-admin routes. GET /admin/me was the foundation; #974 added
   system health + operations; #973 adds the platform-wide analytics read + its
   per-view CSV export. Later parts of the epic (#975) register their routes
   here as they land. */
route({
  method: "get",
  path: "/admin/me",
  tag: "Admin",
  summary: "The current platform admin",
  responses: {
    200: { description: "The confirmed platform admin", schema: refs.AdminMe },
    403: { description: "The caller is not a platform admin" },
  },
});

/* #974 — system health and operations. */

route({
  method: "get",
  path: "/admin/health/services",
  tag: "Admin",
  summary: "Status of the api, database, redirect edge and background worker",
  responses: {
    200: { description: "Per-component health", schema: refs.AdminServiceHealth },
    403: { description: "The caller is not a platform admin" },
  },
});

route({
  method: "get",
  path: "/admin/health/backlogs",
  tag: "Admin",
  summary: "Counts for the projection_outbox, job_leases and webhook_deliveries backlogs",
  responses: {
    200: { description: "Real counts against the live tables", schema: refs.AdminBacklogs },
    403: { description: "The caller is not a platform admin" },
  },
});

route({
  method: "post",
  path: "/admin/health/backlogs/projection-outbox/retry",
  tag: "Admin",
  summary: "Re-queue every dead-lettered edge update (audited)",
  responses: {
    200: { description: "How many rows were re-queued", schema: refs.AdminRetryResult },
    403: { description: "The caller is not a platform admin" },
  },
});

route({
  method: "post",
  path: "/admin/health/backlogs/webhook-deliveries/retry",
  tag: "Admin",
  summary: "Re-queue every failed webhook delivery (audited)",
  responses: {
    200: { description: "How many deliveries were re-queued", schema: refs.AdminRetryResult },
    403: { description: "The caller is not a platform admin" },
  },
});

route({
  method: "post",
  path: "/admin/health/backlogs/job-leases/{name}/release",
  tag: "Admin",
  summary: "Release a stuck job lease held past its expiry (audited)",
  params: z.object({ name: z.string().describe("The job lease name, e.g. click_events_prune_retention") }),
  responses: {
    200: { description: "1 when a stuck lease was released, 0 otherwise", schema: refs.AdminRetryResult },
    403: { description: "The caller is not a platform admin" },
  },
});

route({
  method: "get",
  path: "/admin/audit",
  tag: "Admin",
  summary: "The platform-admin audit trail, with filters",
  query: refs.AdminAuditQuery,
  responses: {
    200: { description: "A page of audit rows", schema: refs.AdminAuditPage },
    403: { description: "The caller is not a platform admin" },
  },
});

route({
  method: "get",
  path: "/admin/workspaces/{workspaceId}/audit",
  tag: "Admin",
  summary: "Any single workspace's audit trail, with filters",
  params: z.object({ workspaceId: z.string().describe("The workspace id (UUID)") }),
  query: refs.AdminAuditQuery,
  responses: {
    200: { description: "A page of audit rows", schema: refs.AdminAuditPage },
    403: { description: "The caller is not a platform admin" },
  },
});

/* #973 — platform-wide analytics. */

route({
  method: "get",
  path: "/admin/analytics",
  tag: "Admin",
  summary: "Platform-wide analytics (growth, usage, business, email, abuse)",
  query: refs.AdminAnalyticsQuery,
  responses: {
    200: { description: "Platform analytics for the range", schema: refs.PlatformAnalytics },
    403: { description: "The caller is not a platform admin" },
  },
});

route({
  method: "get",
  path: "/admin/analytics/export/{view}",
  tag: "Admin",
  summary: "CSV export of one platform-analytics view",
  params: z.object({
    view: z
      .enum(["growth", "usage", "business", "abuse", "topWorkspaces", "topLinks"])
      .describe("Which view to export"),
  }),
  query: refs.AdminAnalyticsQuery,
  responses: {
    200: { description: "CSV export", contentType: "text/csv", schema: z.string() },
    403: { description: "The caller is not a platform admin" },
  },
});

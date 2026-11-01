import { refs, route } from "../registry.js";

import { z } from "zod";

/* #968 — platform-admin routes. Only GET /admin/me for now; later parts of the
   epic (#975) register their routes here as they land. */
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


/* #971 — moderation and abuse. */

route({
  method: "get",
  path: "/admin/abuse-reports",
  tag: "Admin",
  summary: "The global abuse queue, including reports with no workspace",
  query: refs.AdminAbuseQueueQuery,
  responses: {
    200: { description: "A page of abuse-queue rows", schema: refs.AdminAbuseQueuePage },
    403: { description: "The caller is not a platform admin" },
  },
});

route({
  method: "post",
  path: "/admin/abuse-reports/{id}/action",
  tag: "Admin",
  summary: "Act on an abuse report: move its status and/or disable its link (audited)",
  params: z.object({ id: z.string().describe("The abuse report id (UUID)") }),
  body: refs.AdminAbuseReportAction,
  responses: {
    204: { description: "Applied" },
    400: { description: "Neither a status nor disableLink was given" },
    403: { description: "The caller is not a platform admin" },
    404: { description: "No such report" },
  },
});

route({
  method: "get",
  path: "/admin/links",
  tag: "Admin",
  summary: "Platform link search — by slug, destination or owner",
  query: refs.AdminLinkSearchQuery,
  responses: {
    200: { description: "A page of links across the platform", schema: refs.AdminLinkPage },
    403: { description: "The caller is not a platform admin" },
  },
});

route({
  method: "post",
  path: "/admin/links/{id}/disable",
  tag: "Admin",
  summary: "Disable or re-enable a link platform-wide (stops/starts edge redirect; audited)",
  params: z.object({ id: z.string().describe("The link id (UUID)") }),
  body: refs.AdminLinkDisableInput,
  responses: {
    204: { description: "Applied" },
    403: { description: "The caller is not a platform admin" },
    404: { description: "No such link" },
  },
});

route({
  method: "get",
  path: "/admin/blocked-domains",
  tag: "Admin",
  summary: "The destination blocklist",
  responses: {
    200: { description: "Every blocked destination host", schema: refs.AdminBlockedDomains },
    403: { description: "The caller is not a platform admin" },
  },
});

route({
  method: "post",
  path: "/admin/blocked-domains",
  tag: "Admin",
  summary: "Add a destination host to the blocklist (audited)",
  body: refs.AddBlockedDomainInput,
  responses: {
    201: { description: "The blocked domain", schema: refs.AdminBlockedDomain },
    400: { description: "The domain was empty or not a bare host" },
    403: { description: "The caller is not a platform admin" },
    409: { description: "The host is already blocked" },
  },
});

route({
  method: "delete",
  path: "/admin/blocked-domains/{id}",
  tag: "Admin",
  summary: "Remove a destination host from the blocklist (audited)",
  params: z.object({ id: z.string().describe("The blocked-domain id (UUID)") }),
  responses: {
    204: { description: "Removed" },
    403: { description: "The caller is not a platform admin" },
    404: { description: "No such blocked domain" },
  },
});

route({
  method: "get",
  path: "/admin/flagged-links",
  tag: "Admin",
  summary: "Links Safe Browsing has flagged, platform-wide",
  responses: {
    200: { description: "Flagged links", schema: refs.AdminFlaggedLinks },
    403: { description: "The caller is not a platform admin" },
  },
});

route({
  method: "get",
  path: "/admin/custom-domains",
  tag: "Admin",
  summary: "Every custom domain with its verification and SSL status",
  responses: {
    200: { description: "Custom domains and their status", schema: refs.AdminCustomDomains },
    403: { description: "The caller is not a platform admin" },
  },
});

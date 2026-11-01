import { z } from "zod";
import { IdParam, refs, route } from "../registry.js";

/* #968 + #974 + #969 — platform-admin routes. #968 shipped GET /admin/me; #974
   adds system health and operations; #969 adds the users-and-workspaces tools.
   Later parts of the epic (#975) register their routes here as they land. Every
   route is behind AdminGuard (403 for a non-admin), so each entry documents the
   403 alongside its success shape. */

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

/* ── runtime platform settings (#972) ── */

route({
  method: "get",
  path: "/admin/settings",
  tag: "Admin",
  summary: "The platform settings, their defaults, and who last changed each",
  responses: {
    200: { description: "Effective values, defaults and per-setting provenance", schema: refs.PlatformSettings },
    403: { description: "The caller is not a platform admin" },
  },
});

route({
  method: "patch",
  path: "/admin/settings",
  tag: "Admin",
  summary: "Change one or more platform settings (audited, applies without a redeploy)",
  body: refs.PlatformSettingsInput,
  responses: {
    200: { description: "The updated settings", schema: refs.PlatformSettings },
    400: { description: "No setting was provided, or a value was out of range" },
    403: { description: "The caller is not a platform admin" },
  },
});

/* ── system health and operations (#974) ── */

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

/* ── users (#969) ── */

route({
  method: "get",
  path: "/admin/users",
  tag: "Admin",
  summary: "List and search users across the platform",
  query: refs.AdminListQuery,
  responses: {
    200: { description: "A page of users", schema: refs.AdminUserList },
    403: { description: "The caller is not a platform admin" },
  },
});

route({
  method: "get",
  path: "/admin/users/{id}",
  tag: "Admin",
  summary: "One user with the workspaces they belong to",
  params: IdParam,
  responses: {
    200: { description: "The user detail", schema: refs.AdminUserDetail },
    403: { description: "The caller is not a platform admin" },
    404: { description: "No such user" },
  },
});

route({
  method: "post",
  path: "/admin/users/{id}/suspend",
  tag: "Admin",
  summary: "Suspend an account (blocks sign-in, revokes sessions)",
  params: IdParam,
  responses: {
    201: { description: "The account was suspended", schema: refs.AdminActionResult },
    403: { description: "The caller is not a platform admin" },
    404: { description: "No such user" },
  },
});

route({
  method: "post",
  path: "/admin/users/{id}/unsuspend",
  tag: "Admin",
  summary: "Lift an account suspension",
  params: IdParam,
  responses: {
    201: { description: "The suspension was lifted", schema: refs.AdminActionResult },
    403: { description: "The caller is not a platform admin" },
    404: { description: "No such user" },
  },
});

route({
  method: "post",
  path: "/admin/users/{id}/signout-everywhere",
  tag: "Admin",
  summary: "Revoke every session for a user",
  params: IdParam,
  responses: {
    201: { description: "All sessions were revoked", schema: refs.AdminActionResult },
    403: { description: "The caller is not a platform admin" },
    404: { description: "No such user" },
  },
});

route({
  method: "post",
  path: "/admin/users/{id}/resend-verification",
  tag: "Admin",
  summary: "Resend the email-verification mail for a user",
  params: IdParam,
  responses: {
    201: { description: "A verification email was requested", schema: refs.AdminActionResult },
    403: { description: "The caller is not a platform admin" },
    404: { description: "No such user" },
  },
});

route({
  method: "delete",
  path: "/admin/users/{id}",
  tag: "Admin",
  summary: "Delete an account on request",
  params: IdParam,
  responses: {
    200: { description: "The account was deleted", schema: refs.AdminActionResult },
    403: { description: "The caller is not a platform admin" },
    404: { description: "No such user" },
  },
});

/* ── workspaces (#969) ── */

route({
  method: "get",
  path: "/admin/workspaces",
  tag: "Admin",
  summary: "List and search workspaces across the platform",
  query: refs.AdminListQuery,
  responses: {
    200: { description: "A page of workspaces", schema: refs.AdminWorkspaceList },
    403: { description: "The caller is not a platform admin" },
  },
});

route({
  method: "get",
  path: "/admin/workspaces/{id}",
  tag: "Admin",
  summary: "One workspace with members and usage",
  params: IdParam,
  responses: {
    200: { description: "The workspace detail", schema: refs.AdminWorkspaceDetail },
    403: { description: "The caller is not a platform admin" },
    404: { description: "No such workspace" },
  },
});

route({
  method: "patch",
  path: "/admin/workspaces/{id}",
  tag: "Admin",
  summary: "Manually set a workspace's plan and included clicks",
  params: IdParam,
  body: refs.AdminUpdateWorkspaceInput,
  responses: {
    200: { description: "The updated workspace", schema: refs.AdminWorkspaceDetail },
    400: { description: "Neither plan nor clicksIncluded was provided" },
    403: { description: "The caller is not a platform admin" },
    404: { description: "No such workspace" },
  },
});

route({
  method: "get",
  path: "/admin/workspaces/{id}/view-as",
  tag: "Admin",
  summary: "Read-only view of a workspace as its owner sees it (audited)",
  params: IdParam,
  responses: {
    200: { description: "A read-only workspace snapshot", schema: refs.AdminViewAsWorkspace },
    403: { description: "The caller is not a platform admin" },
    404: { description: "No such workspace" },
  },
});

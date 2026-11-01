import { IdParam, refs, route } from "../registry.js";

/* #968 + #969 — platform-admin routes. #968 shipped GET /admin/me; #969 adds the
   users-and-workspaces tools below. Later parts of the epic (#975) register
   their routes here as they land. Every route is behind AdminGuard (403 for a
   non-admin), so each entry documents the 403 alongside its success shape. */

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

/* ── users ── */

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

/* ── workspaces ── */

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

import { z } from "zod";

/* ============================================================
   #968 — the platform-admin area (/api/v1/admin/*).

   Foundation for the admin-panel epic (#975). The only shape here for now is
   the answer to GET /admin/me: who the admin is, confirmed by the server after
   the three-part check (verified email ∈ PLATFORM_ADMIN_EMAILS, 2FA enabled).
   Later parts of the epic add their own shapes to this file.
   ============================================================ */

export const AdminMe = z.object({
  /** The admin's user id. */
  id: z.string(),
  /** Their name, for the admin shell's header. */
  name: z.string(),
  /** Their verified, allow-listed email. */
  email: z.string(),
  /** Always true on a successful GET /admin/me — the route is only reachable by
   *  a confirmed platform admin, so this is a convenience for the client rather
   *  than a flag it has to interpret. */
  isPlatformAdmin: z.literal(true),
});
export type AdminMe = z.infer<typeof AdminMe>;

/* ============================================================
   #969 — users and workspaces management (admin panel 2/7).

   Shapes for the cross-platform user and workspace tools: list/search,
   detail, the user actions (suspend, sign out, resend verification, delete),
   the manual workspace plan/limit edit, and the read-only "view as". Every
   write behind these shapes records a row in the platform admin audit log.
   ============================================================ */

/** Shared cursor-paginated query for the two admin lists. `search` matches the
 *  user's email/name or the workspace's name/slug (case-insensitive substring).
 *  Cursor is the last row's id (UUIDv7, so time-ordered); omit for the first
 *  page. Mirrors ListLinksQuery's limit bounds so the two feel the same. */
export const AdminListQuery = z.object({
  search: z.string().trim().max(255).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().optional(),
});
export type AdminListQuery = z.infer<typeof AdminListQuery>;

/** One row in the admin users list. A platform-wide view of the account, not a
 *  workspace-scoped one: no role here, because a user has a role per workspace. */
export const AdminUserRow = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  /** True once the account's email is verified. */
  emailVerified: z.boolean(),
  /** True when two-factor login is enabled. */
  twoFactorEnabled: z.boolean(),
  /** When the admin suspended the account, or null when it is active. */
  suspendedAt: z.string().nullable(),
  /** How many workspaces the user is an active member of. */
  workspaceCount: z.number().int(),
  createdAt: z.string(),
  lastActiveAt: z.string().nullable(),
});
export type AdminUserRow = z.infer<typeof AdminUserRow>;

export const AdminUserList = z.object({
  items: z.array(AdminUserRow),
  total: z.number(),
  nextCursor: z.string().nullable().optional(),
});
export type AdminUserList = z.infer<typeof AdminUserList>;

/** A workspace this user belongs to, with their role in it. */
export const AdminUserWorkspace = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  role: z.string(),
  plan: z.string(),
});
export type AdminUserWorkspace = z.infer<typeof AdminUserWorkspace>;

/** The user detail page: the account plus the workspaces it is a member of. */
export const AdminUserDetail = AdminUserRow.extend({
  workspaces: z.array(AdminUserWorkspace),
});
export type AdminUserDetail = z.infer<typeof AdminUserDetail>;

/** One row in the admin workspaces list. */
export const AdminWorkspaceRow = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  plan: z.string(),
  clicksIncluded: z.number().int(),
  memberCount: z.number().int(),
  linkCount: z.number().int(),
  domainCount: z.number().int(),
  createdAt: z.string(),
});
export type AdminWorkspaceRow = z.infer<typeof AdminWorkspaceRow>;

export const AdminWorkspaceList = z.object({
  items: z.array(AdminWorkspaceRow),
  total: z.number(),
  nextCursor: z.string().nullable().optional(),
});
export type AdminWorkspaceList = z.infer<typeof AdminWorkspaceList>;

/** A member of a workspace, shown on the workspace detail page. */
export const AdminWorkspaceMember = z.object({
  userId: z.string().nullable(),
  email: z.string(),
  name: z.string().nullable(),
  role: z.string(),
  status: z.string(),
});
export type AdminWorkspaceMember = z.infer<typeof AdminWorkspaceMember>;

/** The workspace detail page: the workspace, its members, and usage this month
 *  (clicks so far against the included allowance). */
export const AdminWorkspaceDetail = AdminWorkspaceRow.extend({
  currency: z.string(),
  retentionYears: z.number().int(),
  members: z.array(AdminWorkspaceMember),
  /** Clicks recorded in the current calendar month, from the daily summary. */
  clicksThisMonth: z.number().int(),
});
export type AdminWorkspaceDetail = z.infer<typeof AdminWorkspaceDetail>;

/** PATCH /admin/workspaces/{id}: the manual plan/limit edit. Both optional so
 *  an admin can change one without the other, but at least one must be present.
 *  `clicksIncluded` is bounded by the same Postgres-integer ceiling the column
 *  uses. Enforcement of the limit is a later issue (#970); this only sets it. */
export const AdminUpdateWorkspaceInput = z
  .object({
    plan: z.string().trim().min(1).max(40).optional(),
    clicksIncluded: z.number().int().min(0).max(2_147_483_647).optional(),
  })
  .refine((v) => v.plan !== undefined || v.clicksIncluded !== undefined, {
    message: "Change the plan, the included clicks, or both.",
  });
export type AdminUpdateWorkspaceInput = z.infer<typeof AdminUpdateWorkspaceInput>;

/** A read-only snapshot of a workspace, assembled for the admin's "view as".
 *  It is exactly what the owner would see on their dashboard, with no control
 *  that changes anything — the endpoint is a GET and returns data only, so
 *  "view as" is read-only by construction. Each fetch records an audit row. */
export const AdminViewAsWorkspace = z.object({
  workspace: AdminWorkspaceDetail,
  /** A few recent links, newest first, as the owner's dashboard lists them. */
  recentLinks: z.array(
    z.object({
      id: z.string(),
      slug: z.string(),
      domain: z.string(),
      destination: z.string(),
      clicks: z.number().int(),
      createdAt: z.string(),
    }),
  ),
  /** Marks the payload as a read-only admin view, so the web client renders the
   *  banner and never offers an edit control. */
  readOnly: z.literal(true),
});
export type AdminViewAsWorkspace = z.infer<typeof AdminViewAsWorkspace>;

/** The uniform result of a user action that has no richer body to return
 *  (suspend/unsuspend, sign out everywhere, resend verification, delete). It
 *  echoes the acted-on id and what was done, so the client can confirm. */
export const AdminActionResult = z.object({
  id: z.string(),
  action: z.string(),
  ok: z.literal(true),
});
export type AdminActionResult = z.infer<typeof AdminActionResult>;

/* ============================================================
   #974 — system health and operations (admin panel 7/7).

   Three read views and three audited retry actions, all behind AdminGuard:
     • service status (api, database, redirect edge, background worker),
     • backlog counts (projection_outbox, job_leases, webhook_deliveries),
     • retry actions that are admin-only and audited,
   plus the two audit-log viewers (the platform admin trail and any single
   workspace's trail), each with filters.

   Everything here is additive to the #968 foundation above. Later or sibling
   parts of the epic keep adding their own shapes to this same file.
   ============================================================ */

/** The health of one of the platform's moving parts. `ok` means it is doing
 *  its job; `degraded` means it answered but something is wrong (a growing
 *  backlog, a lease held past its clock); `down` means no sign of life. */
export const AdminServiceState = z.enum(["ok", "degraded", "down"]);
export type AdminServiceState = z.infer<typeof AdminServiceState>;

export const AdminServiceStatus = z.object({
  /** The component name, e.g. "api", "database", "redirect", "worker". */
  name: z.string(),
  state: AdminServiceState,
  /** A short human line on why it is in this state, for the panel. */
  detail: z.string(),
});
export type AdminServiceStatus = z.infer<typeof AdminServiceStatus>;

/** GET /admin/health/services — the status of every component at a glance. */
export const AdminServiceHealth = z.object({
  services: z.array(AdminServiceStatus),
});
export type AdminServiceHealth = z.infer<typeof AdminServiceHealth>;

/** One backlog's counts. `pending` is work still waiting to be done; `stuck`
 *  is work that has given up or is overdue and needs a human's attention
 *  (the retryable part). */
export const AdminBacklog = z.object({
  /** The backlog key: "projection_outbox" | "job_leases" | "webhook_deliveries". */
  name: z.string(),
  /** Items still in flight (unprocessed outbox rows, held leases, pending
   *  deliveries) — not themselves a problem. */
  pending: z.number().int(),
  /** Items that need attention: outbox rows that exhausted their attempts,
   *  leases held past their expiry, deliveries that failed for good. This is
   *  what a retry acts on. */
  stuck: z.number().int(),
});
export type AdminBacklog = z.infer<typeof AdminBacklog>;

/** GET /admin/health/backlogs — real counts against the live tables. */
export const AdminBacklogs = z.object({
  backlogs: z.array(AdminBacklog),
});
export type AdminBacklogs = z.infer<typeof AdminBacklogs>;

/** The result of a retry action: how many rows it moved back into the queue.
 *  Zero is a normal answer (nothing was stuck), not an error. */
export const AdminRetryResult = z.object({
  /** How many items the action re-queued / released. */
  retried: z.number().int(),
});
export type AdminRetryResult = z.infer<typeof AdminRetryResult>;

/** One row of an audit trail (platform-admin or workspace), shaped for reading
 *  by a person. Both viewers return this same row so the panel renders them the
 *  same way. */
export const AdminAuditRow = z.object({
  id: z.string(),
  /** ISO-8601 timestamp of the action. */
  at: z.string(),
  /** Who did it — the actor's retained label (email), never null in the trail. */
  actor: z.string(),
  /** The dotted action key, e.g. "admin.webhook_deliveries.retry". */
  action: z.string(),
  /** What kind of thing was acted on, or null for a platform-level action. */
  targetType: z.string().nullable(),
  /** The target's id, or null. */
  targetId: z.string().nullable(),
});
export type AdminAuditRow = z.infer<typeof AdminAuditRow>;

/** A page of audit rows plus whether more exist beyond this page. */
export const AdminAuditPage = z.object({
  rows: z.array(AdminAuditRow),
  /** True when the trail has more rows older than the last one here. */
  hasMore: z.boolean(),
});
export type AdminAuditPage = z.infer<typeof AdminAuditPage>;

/** Filters for an audit viewer, as query params. All optional; strings arrive
 *  as strings and the numeric ones are coerced (see zodQuery). `before`/`after`
 *  are ISO-8601 instants bounding `at`. */
export const AdminAuditQuery = z.object({
  /** Exact match on the dotted action key. */
  action: z.string().min(1).max(80).optional(),
  /** Substring match on the actor label (case-insensitive). */
  actor: z.string().min(1).max(255).optional(),
  /** Exact match on the acted-on target id. */
  targetId: z.string().min(1).max(255).optional(),
  /** Only rows at or after this instant. */
  after: z.string().datetime().optional(),
  /** Only rows strictly before this instant. */
  before: z.string().datetime().optional(),
  /** Page size, 1..200, default 50. */
  limit: z.coerce.number().int().min(1).max(200).default(50),
  /** How many rows to skip, for paging. */
  offset: z.coerce.number().int().min(0).default(0),
});
export type AdminAuditQuery = z.infer<typeof AdminAuditQuery>;

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



/* ============================================================
   #971 — platform moderation and abuse (admin panel 4/7).

   The platform-admin surface for handling abuse across the WHOLE platform,
   not one workspace:
     • a global abuse queue, including reports whose slug resolved to no
       workspace (which the workspace-scoped queue in report.ts can never show);
     • platform link search (by slug, destination or owner);
     • disable / enable a link (stops it redirecting at the edge);
     • a destination blocklist, enforced on link create and update;
     • the Safe Browsing flagged-link list and the custom-domain status list.

   Every write behind these shapes goes through AdminGuard and is recorded in
   the platform-admin audit trail. Additive to the #968/#974 shapes above.
   ============================================================ */

/* ---- global abuse queue ---- */

/** One row of the GLOBAL abuse queue. Unlike report.ts's workspace-scoped
 *  AbuseReport, this carries the resolved workspace/owner context an operator
 *  needs to act platform-wide, and surfaces reports with NO workspace (an
 *  unresolved slug) — which the workspace queue intentionally hides. */
export const AdminAbuseReportRow = z.object({
  id: z.string(),
  slug: z.string(),
  reason: z.string(),
  reporterContact: z.string().nullable(),
  status: z.enum(["open", "reviewed", "dismissed", "actioned"]),
  /** The resolved link id, or null when the slug named nothing (or several). */
  linkId: z.string().nullable(),
  /** The link's current destination, when it resolved — so an operator can
   *  judge the report without a second lookup. Null for an unresolved slug. */
  destination: z.string().nullable(),
  /** The owning workspace id, or null for a report that belongs to no
   *  workspace. A null here is exactly the case the workspace queue drops. */
  workspaceId: z.string().nullable(),
  /** The owning workspace's name, when resolved. */
  workspaceName: z.string().nullable(),
  /** Whether the resolved link is currently disabled by an admin. */
  linkDisabled: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type AdminAbuseReportRow = z.infer<typeof AdminAbuseReportRow>;

/** A page of global abuse-queue rows plus whether more exist. */
export const AdminAbuseQueuePage = z.object({
  rows: z.array(AdminAbuseReportRow),
  hasMore: z.boolean(),
});
export type AdminAbuseQueuePage = z.infer<typeof AdminAbuseQueuePage>;

/** Filters for the global abuse queue. `status` narrows by review state;
 *  `orphaned=true` restricts to reports with no workspace (the ones nobody
 *  else can see). */
export const AdminAbuseQueueQuery = z.object({
  status: z.enum(["open", "reviewed", "dismissed", "actioned"]).optional(),
  /** When true, only reports whose slug resolved to no workspace. Parsed with
   *  z.stringbool so "false" is false — a plain z.coerce.boolean() reads any
   *  non-empty string, including "false", as true. */
  orphaned: z.stringbool().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type AdminAbuseQueueQuery = z.infer<typeof AdminAbuseQueueQuery>;

/** Act on one abuse report. `status` moves the report; `disableLink` disables
 *  the link behind it (if it resolved) in the same action. A request with
 *  neither is a no-op the service rejects. */
export const AdminAbuseReportAction = z.object({
  status: z.enum(["open", "reviewed", "dismissed", "actioned"]).optional(),
  /** Disable the report's resolved link (stops it redirecting at the edge). */
  disableLink: z.boolean().optional(),
});
export type AdminAbuseReportAction = z.infer<typeof AdminAbuseReportAction>;

/* ---- platform link search + disable/enable ---- */

/** One link in a platform-wide search or moderation result. */
export const AdminLinkRow = z.object({
  id: z.string(),
  slug: z.string(),
  domain: z.string(),
  destination: z.string(),
  workspaceId: z.string(),
  workspaceName: z.string().nullable(),
  /** The link owner's email/name, when known. */
  owner: z.string().nullable(),
  /** True once a platform admin has disabled the link. */
  disabled: z.boolean(),
  /** 'clean' | 'flagged' | 'pending' — the Safe Browsing state. */
  safeBrowsingStatus: z.string(),
  createdAt: z.string(),
});
export type AdminLinkRow = z.infer<typeof AdminLinkRow>;

/** A page of platform link rows plus whether more exist. */
export const AdminLinkPage = z.object({
  rows: z.array(AdminLinkRow),
  hasMore: z.boolean(),
});
export type AdminLinkPage = z.infer<typeof AdminLinkPage>;

/** Platform link search. At least one of the term fields narrows the result;
 *  with none it lists the most recent links across the platform. */
export const AdminLinkSearchQuery = z.object({
  /** Free-text match on slug, destination or owner. */
  q: z.string().min(1).max(255).optional(),
  /** Only disabled (true) or only enabled (false) links. Parsed with
   *  z.stringbool so "false" is false (see AdminAbuseQueueQuery.orphaned). */
  disabled: z.stringbool().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type AdminLinkSearchQuery = z.infer<typeof AdminLinkSearchQuery>;

/** The disable/enable toggle for a link. `disabled: true` turns it off,
 *  `false` turns it back on; `reason` is recorded in the audit trail. */
export const AdminLinkDisableInput = z.object({
  disabled: z.boolean(),
  reason: z.string().max(500).optional(),
});
export type AdminLinkDisableInput = z.infer<typeof AdminLinkDisableInput>;

/* ---- destination blocklist ---- */

/** One blocked destination host. */
export const AdminBlockedDomain = z.object({
  id: z.string(),
  domain: z.string(),
  reason: z.string().nullable(),
  /** The admin who added it (email label). */
  addedBy: z.string(),
  createdAt: z.string(),
});
export type AdminBlockedDomain = z.infer<typeof AdminBlockedDomain>;

/** The whole blocklist. */
export const AdminBlockedDomains = z.object({
  domains: z.array(AdminBlockedDomain),
});
export type AdminBlockedDomains = z.infer<typeof AdminBlockedDomains>;

/** Add a host to the blocklist. The host is a bare registrable name (no
 *  scheme, no path): a link whose destination is this host or a sub-domain of
 *  it is refused on create and update. */
export const AddBlockedDomainInput = z.object({
  domain: z
    .string()
    .min(1, "Enter a domain to block.")
    .max(253)
    // A bare host only — reject a scheme, a slash, a space or an @, so an admin
    // cannot paste a full URL and silently block nothing it was meant to.
    .refine((v) => !/[\s/@]/.test(v) && !v.includes("://"), {
      error: "Enter a bare domain like evil.example, not a URL.",
    }),
  reason: z.string().max(500).optional(),
});
export type AddBlockedDomainInput = z.infer<typeof AddBlockedDomainInput>;

/* ---- Safe Browsing flagged list ---- */

/** One Safe-Browsing-flagged link, platform-wide. */
export const AdminFlaggedLinkRow = z.object({
  id: z.string(),
  slug: z.string(),
  domain: z.string(),
  destination: z.string(),
  workspaceId: z.string(),
  workspaceName: z.string().nullable(),
  safeBrowsingStatus: z.string(),
  /** When Safe Browsing last checked it. */
  checkedAt: z.string().nullable(),
  /** Whether an admin has also disabled it. */
  disabled: z.boolean(),
});
export type AdminFlaggedLinkRow = z.infer<typeof AdminFlaggedLinkRow>;

export const AdminFlaggedLinks = z.object({
  rows: z.array(AdminFlaggedLinkRow),
  hasMore: z.boolean(),
});
export type AdminFlaggedLinks = z.infer<typeof AdminFlaggedLinks>;

/* ---- custom-domain status list ---- */

/** One custom domain with its verification and SSL state. */
export const AdminCustomDomainRow = z.object({
  id: z.string(),
  domain: z.string(),
  workspaceId: z.string().nullable(),
  workspaceName: z.string().nullable(),
  /** The verification state machine: "verifying" | "live" | … */
  status: z.string(),
  /** The certificate state machine: "pending" | "issued" | … */
  ssl: z.string(),
  verifiedAt: z.string().nullable(),
  sslRenewsAt: z.string().nullable(),
  createdAt: z.string(),
});
export type AdminCustomDomainRow = z.infer<typeof AdminCustomDomainRow>;

export const AdminCustomDomains = z.object({
  rows: z.array(AdminCustomDomainRow),
});
export type AdminCustomDomains = z.infer<typeof AdminCustomDomains>;

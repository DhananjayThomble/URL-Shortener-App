import { z } from "zod";
import { KillSwitchesSetting } from "./kill-switches.js";

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
    /** #993 — lift (true) or re-apply (false) the brand-new-account link caps
     *  for this workspace. true stamps workspaces.new_account_limits_lifted_at
     *  so the per-day/per-hour link caps stop applying to a legitimate new
     *  account that hit them; false clears the stamp so the caps apply again
     *  (while the account is still inside its new-account window). Omitted
     *  leaves the lift state unchanged. The change is audited. */
    liftNewAccountLimits: z.boolean().optional(),
  })
  .refine(
    (v) =>
      v.plan !== undefined || v.clicksIncluded !== undefined || v.liftNewAccountLimits !== undefined,
    {
      message: "Change the plan, the included clicks, or the new-account limits.",
    },
  );
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

/* ============================================================
   #972 — runtime platform settings (admin panel 5/7).

   The settings an operator changes from the panel WITHOUT a redeploy: whether
   signups are open, the request rate-limit values, the reserved slugs, feature
   on/off switches, and a site-wide banner. The API reads them at runtime
   through a short cache, so a change applies within about a minute without a
   restart.

   OUT OF SCOPE on purpose (issue #972): secrets, database and JWT config, and
   AWS infrastructure. None of those is representable here — there is no schema
   for them — so the admin surface physically cannot change them.

   The shapes below are shared three ways: the API validates a PATCH body
   against PlatformSettingsInput, stores each value as jsonb, and returns the
   current state as PlatformSettings (every setting with its value, its default,
   and who last changed it). PlatformBanner is the small public read the web app
   polls so the banner shows for every user, not only admins.
   ============================================================ */

/** How new sign-ups are handled platform-wide.
 *   - "open": anyone can register (the default, today's behaviour).
 *   - "invite_only": registration is refused unless the person holds a
 *     workspace invitation — the invite-accept path still works, the open
 *     register and first-time OAuth paths do not.
 *   - "closed": no new accounts at all, by any path.
 *  Enforced on BOTH the password register and the OAuth first-sign-in path, so
 *  a new Google user cannot slip past a closed/invite-only gate. */
export const SignupMode = z.enum(["open", "invite_only", "closed"]);
export type SignupMode = z.infer<typeof SignupMode>;

/** The runtime rate-limit values the throttler reads per request. Both are
 *  bounded: a zero or absurd limit would either lock everyone out or remove the
 *  limit entirely, so the schema keeps them in a sane operating range. When a
 *  field is unset the API falls back to the THROTTLE_LIMIT / THROTTLE_TTL_SECONDS
 *  env values, so an empty store is exactly today's behaviour. */
export const RateLimitSetting = z.object({
  /** Requests allowed per window, per client IP. */
  limit: z.number().int().min(1).max(100_000),
  /** The window length in seconds. */
  ttlSeconds: z.number().int().min(1).max(86_400),
});
export type RateLimitSetting = z.infer<typeof RateLimitSetting>;

/** The site-wide banner. `message` empty (or the whole setting unset) means no
 *  banner. `level` tints it. Shown to every user, so it is also readable
 *  without admin auth through the public banner endpoint. */
export const BannerSetting = z.object({
  /** The banner text. Empty string = no banner shown. */
  message: z.string().trim().max(500),
  /** Visual severity, defaulting to an informational tint. */
  level: z.enum(["info", "warning", "critical"]).default("info"),
});
export type BannerSetting = z.infer<typeof BannerSetting>;

/* ============================================================
   #993 — launch-readiness abuse controls, the runtime-settings half.

   Three settings an operator tunes from the panel without a redeploy, added to
   the #972 store alongside the ones above:
     • newAccountLimits  — the per-day / per-hour link cap a brand-new account
       lives under for its first few days (separate from plan limits);
     • botProtection     — which invisible sign-up challenge provider is on
       (off by default: a self-hoster needs no third party to register);
     • disposableEmails  — the operator's own additions to the vendored
       throwaway-domain blocklist.

   The bot-protection SECRET is deliberately NOT here: #972 keeps secrets out of
   the settings store (there is no schema for them and the admin surface must not
   be able to read or write one). Only the provider CHOICE lives here; the secret
   key is an env/SSM value, exactly like the Safe Browsing key.
   ============================================================ */

/** The brand-new-account link cap. For the first `windowDays` days after a
 *  workspace is created, its links are capped at `perDay` in any rolling 24h
 *  and `perHour` in any rolling hour — a brake on a bot farm minting links
 *  faster than a human could, on top of (not instead of) the plan's own limit.
 *  An admin can lift it per workspace from the panel; after the window a
 *  workspace is never capped by this. All three bounded so a value cannot
 *  disable the brake by being absurd or lock every new account out at zero. */
export const NewAccountLimitsSetting = z.object({
  /** How many days a workspace counts as "new" and lives under these caps. */
  windowDays: z.number().int().min(0).max(365),
  /** Links allowed in any rolling 24 hours while new. */
  perDay: z.number().int().min(1).max(100_000),
  /** Links allowed in any rolling hour while new. */
  perHour: z.number().int().min(1).max(100_000),
});
export type NewAccountLimitsSetting = z.infer<typeof NewAccountLimitsSetting>;

/** Which bot-protection provider guards sign-up. `"none"` (the default) turns
 *  the challenge off entirely, so an open-source self-hoster can register with
 *  no third-party dependency. `"turnstile"` and `"hcaptcha"` each verify the
 *  browser widget's token with a server-side siteverify call; the matching
 *  secret is an env value, never stored here. */
export const BotProtectionProvider = z.enum(["none", "turnstile", "hcaptcha"]);
export type BotProtectionProvider = z.infer<typeof BotProtectionProvider>;

export const BotProtectionSetting = z.object({
  provider: BotProtectionProvider,
});
export type BotProtectionSetting = z.infer<typeof BotProtectionSetting>;

/** The operator's additions to the vendored disposable-email blocklist. The
 *  vendored list ships with the build; these are extra domains an admin adds
 *  from the panel when a new throwaway provider shows up before the vendored
 *  list catches it. Lower-cased, de-duped and bounded by the API on write. A
 *  bare host each (no scheme/path/@), the same shape the blocklist enforces. */
export const DisposableEmailSetting = z.object({
  /** The operator's additions to the block list — extra throwaway domains to
   *  refuse, on top of the vendored list. */
  extraDomains: z.array(z.string().trim().min(1).max(253)).max(5_000),
  /** #1007 — the operator's ALLOW list: domains that must never be refused,
   *  overriding BOTH the vendored block list AND `extraDomains`. For a real
   *  provider wrongly swept into the ~10k vendored list, an admin adds it here
   *  and the fix is live within the settings-cache window, no release needed.
   *  Beats the built-in allow list too (it is simply folded in with it). Bare
   *  hosts, lower-cased, de-duped and bounded by the API on write. */
  allowDomains: z.array(z.string().trim().min(1).max(253)).max(5_000).default([]),
});
export type DisposableEmailSetting = z.infer<typeof DisposableEmailSetting>;

/** Why a sign-up or new-account action was refused, as a stable code so the
 *  admin panel can count and filter refusals without parsing prose (#993
 *  acceptance: "every refusal is logged with a reason code"). Each is recorded
 *  on the platform audit trail with action `admin.signup.refused` and this code
 *  as a target, so an operator can see a spike of a single kind.
 *
 *   - disposable_email        — the address is on the throwaway-domain list.
 *   - bot_challenge_missing   — protection is on and the request carried no
 *                               challenge token.
 *   - bot_challenge_failed    — the token was present but siteverify rejected it.
 *   - new_account_cap_day     — the N+1th link in a new account's rolling day.
 *   - new_account_cap_hour    — the N+1th link in a new account's rolling hour.
 *   - email_domain_no_mail    — the email domain DEFINITIVELY cannot receive
 *                               mail: DNS reported no MX and no A/AAAA record
 *                               (NXDOMAIN, or NODATA for all three). A DNS
 *                               timeout or error never produces this — the
 *                               check fails open (#1007). */
export const SignupRefusalReason = z.enum([
  "disposable_email",
  "bot_challenge_missing",
  "bot_challenge_failed",
  "new_account_cap_day",
  "new_account_cap_hour",
  "email_domain_no_mail",
]);
export type SignupRefusalReason = z.infer<typeof SignupRefusalReason>;

/** The PATCH /admin/settings body: every setting is optional so an admin can
 *  change one without touching the rest, but the refine requires at least one,
 *  so an empty body is a 400 rather than a silent no-op that still writes an
 *  audit row.
 *
 *   - signupMode        — the sign-up gate (see SignupMode).
 *   - rateLimit         — the runtime throttler values (see RateLimitSetting).
 *   - reservedSlugs     — back-halves nobody may claim (lower-cased, de-duped
 *                         and bounded by the API on write).
 *   - featureFlags      — a map of feature key → on/off. Free-form keys so a
 *                         new switch needs no contract change; values are
 *                         strictly boolean.
 *   - banner            — the site-wide banner (see BannerSetting).
 *   - newAccountLimits  — the brand-new-account link caps (#993).
 *   - botProtection     — the sign-up challenge provider switch (#993).
 *   - disposableEmails  — the operator's additions to the throwaway-email
 *                         blocklist (#993). */
export const PlatformSettingsInput = z
  .object({
    signupMode: SignupMode.optional(),
    rateLimit: RateLimitSetting.optional(),
    reservedSlugs: z.array(z.string().trim().min(1).max(64)).max(500).optional(),
    featureFlags: z.record(z.string().min(1).max(64), z.boolean()).optional(),
    banner: BannerSetting.optional(),
    newAccountLimits: NewAccountLimitsSetting.optional(),
    botProtection: BotProtectionSetting.optional(),
    disposableEmails: DisposableEmailSetting.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: "Change at least one setting.",
  });
export type PlatformSettingsInput = z.infer<typeof PlatformSettingsInput>;

/** The effective value of every setting — what the API actually uses right now,
 *  env fallbacks already folded in. This is the shape the rest of the API reads
 *  from the settings cache, and the `values` half of the admin read. */
export const PlatformSettingsValues = z.object({
  signupMode: SignupMode,
  rateLimit: RateLimitSetting,
  reservedSlugs: z.array(z.string()),
  featureFlags: z.record(z.string(), z.boolean()),
  banner: BannerSetting,
  newAccountLimits: NewAccountLimitsSetting,
  botProtection: BotProtectionSetting,
  disposableEmails: DisposableEmailSetting,
  // #1020 — the typed kill-switch set, read on the hot paths (billing, custom
  // domains, mail) through the same short cache as every other setting. Its own
  // typed PATCH lives on /admin/killswitches (not PlatformSettingsInput), but
  // the effective value rides in the shared snapshot so a consumer reads one
  // cache.
  killSwitches: KillSwitchesSetting,
});
export type PlatformSettingsValues = z.infer<typeof PlatformSettingsValues>;

/** Per-setting provenance for the admin UI: when it was last changed and by
 *  whom, or null on both when the setting has never been written (it is running
 *  on its default). One entry per setting key. */
export const PlatformSettingMeta = z.object({
  /** ISO-8601 instant of the last change, or null if never set. */
  updatedAt: z.string().nullable(),
  /** The admin's label (email) who last set it, or null if never set / the
   *  admin's user row was later deleted. */
  updatedBy: z.string().nullable(),
});
export type PlatformSettingMeta = z.infer<typeof PlatformSettingMeta>;

/** GET /admin/settings — everything the settings page renders: the current
 *  effective values, the compiled-in defaults (so the UI can show "default: X"
 *  and offer a reset), and the per-setting "last changed by / at". */
export const PlatformSettings = z.object({
  /** The effective values in use right now. */
  values: PlatformSettingsValues,
  /** The compiled-in defaults, same shape, for the UI's "default" column. For
   *  the rate limit these are the env-configured values the store falls back
   *  to. */
  defaults: PlatformSettingsValues,
  /** Provenance per setting key, keyed by the same keys as `values`. */
  meta: z.record(z.string(), PlatformSettingMeta),
});
export type PlatformSettings = z.infer<typeof PlatformSettings>;

/** GET /public/platform/banner — the small unauthenticated read the web app
 *  polls so the banner shows for every visitor. `message` empty means no banner
 *  is currently set; the client renders nothing. */
export const PlatformBanner = z.object({
  message: z.string(),
  level: z.enum(["info", "warning", "critical"]),
});
export type PlatformBanner = z.infer<typeof PlatformBanner>;

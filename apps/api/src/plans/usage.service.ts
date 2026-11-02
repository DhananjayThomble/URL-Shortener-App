import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  LIMIT_LABELS,
  usageBand,
  usagePercent,
  type LimitName,
  type LimitValue,
  type UsageBand,
  type UsageRow,
  type WorkspaceUsage,
} from "@snapurl/contract";
import {
  and,
  apiKeys,
  bioPages,
  clickDaily,
  domains,
  eq,
  forms,
  gte,
  isNull,
  links,
  memberships,
  sql,
  usageWarnings,
  workspaces,
  type Database,
} from "@snapurl/database";
import { DB } from "../database/database.module.js";
import { MailService } from "../mail/mail.service.js";
import { PlansService } from "./plans.service.js";

/* ============================================================
   #970 — usage against limits, plus the owner 80%/100% warnings.

   §7: "each workspace sees its usage against limits in Settings. Owners get
   in-app and email warnings at 80% and 100%."

   usageFor(workspaceId) counts the workspace's current consumption of every
   countable limit and pairs it with the resolved limit (through the entitlement
   engine), so the Settings view shows used / limit / percent per row. The
   retention limit is a policy, not a count, so it is reported with a null
   "used" — it has no consumption to show.

   evaluateWarnings(workspaceId) re-reads usage, computes each limit's band
   (none/warn/full), and keeps the usage_warnings table in step: a row exists
   while a limit is at or above 80%, carrying the current band; crossing UP to a
   band not yet notified sends the owners one email and stamps notifiedAt, so an
   owner is warned once at 80% and once at 100%, never on every read. The rows
   ARE the in-app signal the Settings banner reads. Dropping back below 80%
   clears the row. Unlimited limits never warn.
   ============================================================ */

/** The limits that have a real consumption count. retentionYears is a policy
 *  value, not a usage count, so it is not warned on and not counted here. */
const COUNTABLE_LIMITS: LimitName[] = [
  "links",
  "clicksPerMonth",
  "customDomains",
  "teamMembers",
  "apiKeys",
  "bioPages",
  "forms",
];

function startOfMonthDay(now = new Date()): string {
  const d = new Date(now);
  d.setUTCDate(1);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

@Injectable()
export class UsageService {
  private readonly logger = new Logger(UsageService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly plans: PlansService,
    private readonly mail: MailService,
  ) {}

  /** The current count for each countable limit, in one pass. */
  async currentCounts(workspaceId: string): Promise<Record<LimitName, number>> {
    const monthStart = startOfMonthDay();
    const [row] = await this.db
      .select({
        links: sql<number>`(select count(*)::int from ${links} l where l.workspace_id = ${workspaceId} and l.managed_bio_page_id is null)`,
        clicksPerMonth: sql<number>`(select coalesce(sum(cd.clicks),0)::int from ${clickDaily} cd where cd.workspace_id = ${workspaceId} and cd.day >= ${monthStart})`,
        customDomains: sql<number>`(select count(*)::int from ${domains} d where d.workspace_id = ${workspaceId} and d.is_system = false)`,
        teamMembers: sql<number>`(select count(*)::int from ${memberships} m where m.workspace_id = ${workspaceId} and m.status = 'active')`,
        apiKeys: sql<number>`(select count(*)::int from ${apiKeys} k where k.workspace_id = ${workspaceId} and k.revoked_at is null)`,
        bioPages: sql<number>`(select count(*)::int from ${bioPages} b where b.workspace_id = ${workspaceId})`,
        forms: sql<number>`(select count(*)::int from ${forms} f where f.workspace_id = ${workspaceId})`,
      })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);

    return {
      links: row?.links ?? 0,
      clicksPerMonth: row?.clicksPerMonth ?? 0,
      customDomains: row?.customDomains ?? 0,
      teamMembers: row?.teamMembers ?? 0,
      apiKeys: row?.apiKeys ?? 0,
      bioPages: row?.bioPages ?? 0,
      forms: row?.forms ?? 0,
      retentionYears: 0,
    };
  }

  /** The Settings usage view: a row per countable limit with used / limit /
   *  percent, plus the workspace's plan key. */
  async usageFor(workspaceId: string): Promise<WorkspaceUsage> {
    const [ws] = await this.db.select({ plan: workspaces.plan }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
    const entitlements = await this.plans.resolveForWorkspace(workspaceId);
    const counts = await this.currentCounts(workspaceId);

    const rows: UsageRow[] = COUNTABLE_LIMITS.map((name) => {
      const limit = entitlements.limits[name];
      const used = counts[name];
      return {
        name,
        label: LIMIT_LABELS[name],
        used,
        limit,
        percent: usagePercent(used, limit),
      };
    });

    // Reconcile warnings on the read so the Settings banner is always current,
    // and so an owner who crosses a threshold between background checks still
    // gets the email the next time anyone opens Settings.
    const active = await this.evaluateWarnings(workspaceId);
    const warnings = active.map((w) => ({ limitName: w.limitName, label: LIMIT_LABELS[w.limitName], band: w.band as "warn" | "full" }));

    return { planKey: (ws?.plan ?? "").trim().toLowerCase(), rows, warnings };
  }

  /**
   * Re-evaluate the workspace's usage and reconcile the usage_warnings table,
   * emailing owners on a newly-crossed band. Returns the current warnings (the
   * in-app signal). Called when usage changes and on the usage read.
   */
  async evaluateWarnings(workspaceId: string): Promise<Array<{ limitName: LimitName; band: UsageBand }>> {
    const entitlements = await this.plans.resolveForWorkspace(workspaceId);
    const counts = await this.currentCounts(workspaceId);

    const existing = await this.db
      .select({ limitName: usageWarnings.limitName, band: usageWarnings.band, notifiedAt: usageWarnings.notifiedAt })
      .from(usageWarnings)
      .where(eq(usageWarnings.workspaceId, workspaceId));
    const existingByLimit = new Map(existing.map((e) => [e.limitName, e]));

    const active: Array<{ limitName: LimitName; band: UsageBand }> = [];
    const toEmail: Array<{ limit: LimitName; band: UsageBand; limitValue: LimitValue; used: number }> = [];

    for (const name of COUNTABLE_LIMITS) {
      const limit = entitlements.limits[name];
      const used = counts[name];
      const band = usageBand(used, limit);
      const prev = existingByLimit.get(name);

      if (band === "none") {
        // Dropped below 80% — clear any warning row.
        if (prev) await this.db.delete(usageWarnings).where(and(eq(usageWarnings.workspaceId, workspaceId), eq(usageWarnings.limitName, name)));
        continue;
      }

      active.push({ limitName: name, band });

      // A new band (none->warn, none->full, or warn->full) that was not already
      // recorded-and-notified warrants an email.
      const alreadyNotifiedThisBand = prev?.band === band && prev?.notifiedAt != null;
      const now = new Date();
      await this.db
        .insert(usageWarnings)
        .values({ workspaceId, limitName: name, band, notifiedAt: alreadyNotifiedThisBand ? prev!.notifiedAt : now, updatedAt: now })
        .onConflictDoUpdate({
          target: [usageWarnings.workspaceId, usageWarnings.limitName],
          set: { band, notifiedAt: alreadyNotifiedThisBand ? prev!.notifiedAt : now, updatedAt: now },
        });
      if (!alreadyNotifiedThisBand) toEmail.push({ limit: name, band, limitValue: limit, used });
    }

    if (toEmail.length > 0) await this.emailOwners(workspaceId, toEmail);
    return active;
  }

  /* ── internals ── */

  /** Email every active owner of the workspace about the crossed limits.
   *  Best-effort: a mail failure is logged, never thrown, so it cannot fail the
   *  action that triggered the check. */
  private async emailOwners(
    workspaceId: string,
    crossed: Array<{ limit: LimitName; band: UsageBand; limitValue: LimitValue; used: number }>,
  ): Promise<void> {
    const [ws] = await this.db.select({ name: workspaces.name }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
    const owners = await this.db
      .select({ email: memberships.email })
      .from(memberships)
      .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.role, "owner"), eq(memberships.status, "active")));
    if (owners.length === 0) return;

    const lines = crossed.map((c) => {
      const capText = c.limitValue === null ? "unlimited" : String(c.limitValue);
      const pct = c.band === "full" ? "100%" : "80%";
      return `• ${LIMIT_LABELS[c.limit]}: ${c.used} of ${capText} used (${pct}).`;
    });
    const anyFull = crossed.some((c) => c.band === "full");
    const subject = anyFull
      ? `You've reached a plan limit on ${ws?.name ?? "your workspace"}`
      : `You're close to a plan limit on ${ws?.name ?? "your workspace"}`;
    const body = [
      anyFull
        ? "One or more of your plan limits is now full. New items of these kinds will be refused until you upgrade or free some up:"
        : "You're approaching one or more of your plan limits:",
      "",
      ...lines,
      "",
      "Open Settings to see your usage, or upgrade your plan for higher limits.",
    ].join("\n");

    for (const o of owners) {
      try {
        await this.mail.send({ to: o.email, subject, body });
      } catch (err) {
        this.logger.warn(`Usage-warning email to ${o.email} failed: ${(err as Error).message}`);
      }
    }
  }
}

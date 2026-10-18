import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, clickDaily, domains, eq, gte, links, sql, workspaces, type Database } from "@snapurl/database";
import type { UpdateWorkspaceInput, Workspace } from "@snapurl/contract";
import { DB } from "../database/database.module.js";
import { initialsOf } from "../auth/auth.service.js";

@Injectable()
export class WorkspacesService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async current(workspaceId: string): Promise<Workspace> {
    const [row] = await this.db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
    if (!row) throw new NotFoundException("Workspace not found.");

    const [defaultDomain] = row.defaultDomainId
      ? await this.db.select({ domain: domains.domain }).from(domains).where(eq(domains.id, row.defaultDomainId)).limit(1)
      : [];

    /* clicksUsed is billed by calendar month, so it resets on the 1st rather
       than rolling. The settings screen shows it against clicksIncluded. */
    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);

    const [usage] = await this.db
      .select({ used: sql<number>`coalesce(sum(${clickDaily.clicks}), 0)::int` })
      .from(clickDaily)
      .where(and(eq(clickDaily.workspaceId, workspaceId), gte(clickDaily.day, monthStart.toISOString().slice(0, 10))));

    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      initials: initialsOf(row.name),
      plan: row.plan,
      defaultDomain: defaultDomain?.domain ?? "",
      defaultRedirect: row.defaultRedirect as Workspace["defaultRedirect"],
      clicksUsed: usage?.used ?? 0,
      clicksIncluded: row.clicksIncluded,
      retentionYears: row.retentionYears,
      cookielessAnalytics: row.cookielessAnalytics,
      scanOnCreate: row.scanOnCreate,
      publicPreviews: row.publicPreviews,
      currency: row.currency,
    };
  }

  async update(workspaceId: string, input: UpdateWorkspaceInput): Promise<Workspace> {
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.name !== undefined) patch.name = input.name;
    if (input.slug !== undefined) patch.slug = input.slug;
    if (input.defaultRedirect !== undefined) patch.defaultRedirect = input.defaultRedirect;
    if (input.retentionYears !== undefined) patch.retentionYears = input.retentionYears;
    if (input.cookielessAnalytics !== undefined) patch.cookielessAnalytics = input.cookielessAnalytics;
    if (input.scanOnCreate !== undefined) patch.scanOnCreate = input.scanOnCreate;
    if (input.publicPreviews !== undefined) patch.publicPreviews = input.publicPreviews;
    if (input.currency !== undefined) patch.currency = input.currency.toUpperCase();

    /* Resolved BEFORE anything is written: a refused domain rejects the whole
       PATCH, so a 400 never leaves the other fields half-saved (#779). */
    if (input.defaultDomain !== undefined) {
      const domainId = await this.resolveDefaultDomain(workspaceId, input.defaultDomain);
      if (domainId !== undefined) patch.defaultDomainId = domainId;
    }

    await this.db.update(workspaces).set(patch).where(eq(workspaces.id, workspaceId));
    return this.current(workspaceId);
  }

  /**
   * The id to store as the workspace's default domain, `undefined` for "leave
   * it as it is", or a 400.
   *
   * A default domain pre-fills every "new link" form, so it has to be one a
   * link can actually be created on — the same rule links.service
   * resolveDomain enforces: a domain this workspace owns or the shared system
   * domain, and one that is `live`. Anything else is refused. Another
   * workspace's domain gets exactly the same answer as an unknown one, so the
   * message does not reveal that it exists.
   *
   * The value is normalised the way a hostname compares: trimmed,
   * case-insensitive, a trailing dot ignored.
   *
   * Sending back the CURRENT default is never an error, even if it has since
   * stopped being live (or the workspace has none): clients send the whole
   * settings form, so a person changing only their currency must not be
   * blocked by a domain they did not touch.
   */
  private async resolveDefaultDomain(workspaceId: string, raw: string): Promise<string | undefined> {
    const wanted = raw.trim().toLowerCase().replace(/\.+$/, "");

    const [current] = await this.db
      .select({ id: domains.id, domain: domains.domain })
      .from(workspaces)
      .leftJoin(domains, eq(domains.id, workspaces.defaultDomainId))
      .where(eq(workspaces.id, workspaceId))
      .limit(1);
    const currentName = current?.domain?.toLowerCase().replace(/\.+$/, "") ?? "";
    if (wanted === currentName) return undefined;

    if (!wanted) throw new BadRequestException("Choose a default domain.");

    const [row] = await this.db
      .select({ id: domains.id, domain: domains.domain, status: domains.status })
      .from(domains)
      .where(
        and(
          sql`lower(${domains.domain}) = ${wanted}`,
          // Either this workspace owns it, or it is the shared system domain.
          sql`(${domains.workspaceId} = ${workspaceId} or ${domains.isSystem} = true)`,
        ),
      )
      .limit(1);

    if (!row) {
      const shown = raw.trim().length > 100 ? `${raw.trim().slice(0, 100)}…` : raw.trim();
      throw new BadRequestException(`${shown} isn't a domain in this workspace.`);
    }
    if (row.status !== "live") {
      throw new BadRequestException(`${row.domain} isn't verified yet, so links on it wouldn't resolve.`);
    }
    return row.id;
  }
}

import { Inject, Injectable, NotFoundException } from "@nestjs/common";
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

    if (input.defaultDomain !== undefined) {
      const [domain] = await this.db
        .select({ id: domains.id })
        .from(domains)
        .where(and(sql`lower(${domains.domain}) = ${input.defaultDomain.toLowerCase()}`, sql`(${domains.workspaceId} = ${workspaceId} or ${domains.isSystem} = true)`))
        .limit(1);
      if (domain) patch.defaultDomainId = domain.id;
    }

    await this.db.update(workspaces).set(patch).where(eq(workspaces.id, workspaceId));
    return this.current(workspaceId);
  }
}

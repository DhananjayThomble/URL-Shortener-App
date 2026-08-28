import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { resolveTxt } from "node:dns/promises";
import { and, domains, eq, links, sql, type Database } from "@snapurl/database";
import type { AddDomainInput, Domain } from "@snapurl/contract";
import { DB } from "../database/database.module.js";
import { recordActivity, type Actor } from "../common/activity.js";

@Injectable()
export class DomainsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  private readonly logger = new Logger(DomainsService.name);

  async list(workspaceId: string): Promise<Domain[]> {
    const rows = await this.db
      .select()
      .from(domains)
      .where(sql`(${domains.workspaceId} = ${workspaceId}::uuid or ${domains.isSystem} = true)`)
      .orderBy(domains.isSystem, domains.createdAt);

    /* Counted in a second query rather than a correlated subquery in the
       projection. The subquery version silently returned zero — a raw fragment
       referencing a table that is not in the outer FROM is easy to write and
       hard to read, and a wrong count is worse than an extra round trip. */
    const counts = await this.db
      .select({ domainId: links.domainId, n: sql<number>`count(*)::int` })
      .from(links)
      .where(eq(links.workspaceId, workspaceId))
      .groupBy(links.domainId);

    // Scoped to the caller: on a shared system domain, other workspaces'
    // links are none of their business.
    const byDomain = new Map(counts.map((c) => [c.domainId, c.n]));
    return rows.map((row) => this.toDto(row, byDomain.get(row.id) ?? 0));
  }

  async add(workspaceId: string, input: AddDomainInput): Promise<Domain> {
    const domain = input.domain.toLowerCase().trim();

    /* Globally unique, not per-workspace. Two workspaces both claiming snap.to
       would make (host, slug) ambiguous on the redirect path, which is the one
       lookup the whole product depends on being unambiguous. */
    const [taken] = await this.db
      .select({ id: domains.id })
      .from(domains)
      .where(sql`lower(${domains.domain}) = ${domain}`)
      .limit(1);
    if (taken) throw new ConflictException(`${domain} is already connected to a workspace.`);

    const [row] = await this.db
      .insert(domains)
      .values({
        workspaceId,
        domain,
        status: "verifying",
        ssl: "pending",
        verificationToken: `snapurl-verify-${randomBytes(16).toString("hex")}`,
        rootRedirect: input.rootRedirect ?? null,
        notFoundRedirect: input.notFoundRedirect ?? null,
      })
      .returning();

    return this.toDto(row!, 0);
  }

  /**
   * Check the TXT record the customer was told to add.
   *
   * Ownership first, certificate second. Requesting an ACM certificate for a
   * domain we have not proved control of is how a shared-hosting provider ends
   * up issuing certificates for other people's names.
   */
  async verify(workspaceId: string, id: string, actor: Actor): Promise<Domain> {
    const [row] = await this.db
      .select()
      .from(domains)
      .where(and(eq(domains.id, id), eq(domains.workspaceId, workspaceId)))
      .limit(1);
    if (!row) throw new NotFoundException("That domain isn't connected to this workspace.");
    if (!row.verificationToken) throw new BadRequestException("This domain has no pending verification.");

    let records: string[][] = [];
    try {
      records = await resolveTxt(`_snapurl.${row.domain}`);
    } catch {
      throw new BadRequestException(
        `Couldn't find a TXT record at _snapurl.${row.domain}. DNS changes can take a few minutes to propagate.`,
      );
    }

    const found = records.some((chunks) => chunks.join("").trim() === row.verificationToken);
    if (!found) {
      throw new BadRequestException(
        `The TXT record at _snapurl.${row.domain} doesn't match. Check for a typo, or that you copied the whole value.`,
      );
    }

    /* ssl stays "pending" here on purpose.

       Ownership is proven, but the certificate is a separate asynchronous
       process — ACM issues it, CloudFront has to accept it as an alternate
       domain name, and that takes minutes. The UI shows the two states side by
       side precisely because they diverge. The worker moves ssl to "active". */
    const [updated] = await this.db
      .update(domains)
      .set({ status: "live", verifiedAt: new Date(), updatedAt: new Date() })
      .where(eq(domains.id, id))
      .returning();

    await recordActivity(this.db, this.logger, {
      workspaceId,
      actor,
      auditAction: "domain.verified",
      webhookEvent: "domain.verified",
      targetType: "domain",
      targetId: id,
      metadata: { domain: row.domain },
    });

    return this.toDto(updated!, 0);
  }

  async remove(workspaceId: string, id: string): Promise<void> {
    const [system] = await this.db
      .select({ isSystem: domains.isSystem })
      .from(domains)
      .where(eq(domains.id, id))
      .limit(1);
    if (system?.isSystem) {
      throw new ConflictException("That's a shared SnapURL domain — it isn't yours to disconnect.");
    }

    const [count] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(links)
      .where(eq(links.domainId, id));

    /* Deleting a domain with live links would 404 every one of them, including
       printed QR codes. The FK is ON DELETE RESTRICT as a backstop; this is the
       error message that explains why. */
    if ((count?.n ?? 0) > 0) {
      throw new ConflictException(
        `${count!.n} link${count!.n === 1 ? "" : "s"} still use this domain. Move or delete them first.`,
      );
    }

    const result = await this.db
      .delete(domains)
      .where(and(eq(domains.id, id), eq(domains.workspaceId, workspaceId)))
      .returning({ id: domains.id });
    if (result.length === 0) throw new NotFoundException("That domain isn't connected to this workspace.");
  }

  private toDto(row: typeof domains.$inferSelect, linkCount: number): Domain {
    return {
      id: row.id,
      domain: row.domain,
      status: row.status as Domain["status"],
      ssl: row.ssl as Domain["ssl"],
      sslRenewsAt: row.sslRenewsAt?.toISOString() ?? null,
      links: linkCount,
      rootRedirect: row.rootRedirect,
      notFoundRedirect: row.notFoundRedirect,
      dns: row.verificationToken
        ? { type: "TXT", name: `_snapurl.${row.domain}`, value: row.verificationToken, ttl: 300 }
        : null,
    };
  }
}

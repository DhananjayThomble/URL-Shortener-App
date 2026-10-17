import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { resolveTxt } from "node:dns/promises";
import { and, domainProjectionOp, domains, eq, isNull, links, normaliseHost, projectionOutbox, sql, type Database } from "@snapurl/database";
import type { AddDomainInput, Domain, UpdateDomainInput } from "@snapurl/contract";
import { DB } from "../database/database.module.js";
import { recordActivity, type Actor } from "../common/activity.js";
import { assertNoSsrfDnsTarget } from "../common/ssrf-guard.js";
import { ProjectionNudgeService } from "../links/projection-nudge.service.js";

/**
 * Refuse a root / 404 redirect that points back at the domain it is set on
 * (#711 review, Minor-3). The redirect service would answer it with a 302 to
 * itself and the browser would loop until its redirect cap. Compared on the
 * hostname alone, case-insensitively and ignoring a trailing dot, so http vs
 * https or a different path is still the same loop. Another subdomain of the
 * same parent is a different host and is allowed.
 */
function assertNotSelfRedirect(domain: string, values: Array<string | null | undefined>): void {
  const self = normaliseHost(domain).replace(/\.$/, "");
  for (const value of values) {
    if (!value) continue;
    let host: string;
    try {
      host = new URL(value).hostname.toLowerCase().replace(/\.$/, "");
    } catch {
      continue; // the contract already refused anything unparseable
    }
    if (host === self) {
      throw new BadRequestException(
        `A redirect on ${domain} can't point back at ${domain} — visitors would loop. Use a different domain.`,
      );
    }
  }
}

/**
 * Normalise a root / 404 redirect to a header-safe href before it is stored
 * (#713 item 1).
 *
 * A redirect URL whose characters go beyond Latin-1 — an IDN host like
 * `例え.テスト`, or a CJK / emoji path or query — SAVES fine but then 500s the
 * visitor: the redirect service emits the stored string verbatim as a
 * `Location` header and Node's HTTP layer refuses non-Latin-1 header bytes.
 *
 * Links never hit this because the redirect serves a link destination through
 * packages/domain `buildDestination`, which runs `new URL(dest).toString()` and
 * emits the normalised (host punycoded to `xn--`, path/query percent-encoded)
 * href. Domains stored the raw string, so the asymmetry was the bug. Normalise
 * here, at the one write path, and the stored value — which is also what the
 * Postgres `resolveDomain()` Location header and the DynamoDB projected meta
 * item are built from — is a valid header value by construction.
 *
 * `null`/`undefined` passes straight through (an absent or cleared redirect).
 * The contract's `HttpUrl` has already proven a present value parses as http(s),
 * so `new URL` cannot throw for an accepted input; the try/catch is a defensive
 * backstop that returns the original rather than turning a stored value into a
 * 500 in the unlikely event it ever did.
 */
function normaliseRedirect(value: string | null | undefined): string | null {
  if (value == null) return null;
  try {
    return new URL(value).href;
  } catch {
    return value;
  }
}

@Injectable()
export class DomainsService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly projectionNudge: ProjectionNudgeService,
  ) {}

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
      // #650: managed bio links are infrastructure, not user links — do not
      // count them in a domain's link total (they are hidden from the list).
      .where(and(eq(links.workspaceId, workspaceId), isNull(links.managedBioPageId)))
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

    // Same DNS-resolving SSRF step update() applies; see there.
    await assertNoSsrfDnsTarget([input.rootRedirect, input.notFoundRedirect]);
    assertNotSelfRedirect(domain, [input.rootRedirect, input.notFoundRedirect]);

    const row = await this.db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(domains)
        .values({
          workspaceId,
          domain,
          status: "verifying",
          ssl: "pending",
          verificationToken: `snapurl-verify-${randomBytes(16).toString("hex")}`,
          // Store the header-safe href, not the raw string (#713 item 1).
          rootRedirect: normaliseRedirect(input.rootRedirect),
          notFoundRedirect: normaliseRedirect(input.notFoundRedirect),
        })
        .returning();
      // A redirect set at connect time must reach the dynamo projection too
      // (see update()); a domain without one has no meta item to write.
      if (inserted!.rootRedirect || inserted!.notFoundRedirect) {
        await tx.insert(projectionOutbox).values(domainProjectionOp(inserted!.id, inserted!.domain));
      }
      return inserted!;
    });
    if (row.rootRedirect || row.notFoundRedirect) this.projectionNudge.nudge();

    return this.toDto(row, 0);
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

  /**
   * Set, change or clear a domain's root and 404 redirects (#648).
   *
   * The shared system domain is refused outright. It has no owning workspace
   * (workspace_id is NULL, is_system is true) and every workspace's links sit
   * on it, so a root or 404 redirect set by one tenant would capture every
   * other tenant's bare-domain and mistyped-slug traffic. The refusal is a
   * 409 with an explanation, the same answer `remove()` gives for it, rather
   * than a 404, because the caller can see the domain in its own list.
   *
   * Everything else is scoped to the caller's workspace: another workspace's
   * custom domain is a 404, indistinguishable from one that does not exist.
   */
  async update(workspaceId: string, id: string, input: UpdateDomainInput, actor: Actor): Promise<Domain> {
    const [row] = await this.db
      .select()
      .from(domains)
      .where(
        and(
          eq(domains.id, id),
          // Visible to this caller: its own, or the shared one (to refuse it by name).
          sql`(${domains.workspaceId} = ${workspaceId}::uuid or ${domains.isSystem} = true)`,
        ),
      )
      .limit(1);
    if (!row) throw new NotFoundException("That domain isn't connected to this workspace.");
    if (row.isSystem || row.workspaceId === null) {
      throw new ConflictException(
        "That's a shared SnapURL domain used by every workspace — its root and 404 redirects can't be changed. Connect your own domain to set them.",
      );
    }

    /* The values leave as a Location header, exactly like a link destination,
       so they get the same DNS-resolving half of the SSRF guard that
       LinksService applies after the contract's literal-host check. */
    await assertNoSsrfDnsTarget([input.rootRedirect, input.notFoundRedirect]);
    assertNotSelfRedirect(row.domain, [input.rootRedirect, input.notFoundRedirect]);

    // Store the header-safe href, not the raw string (#713 item 1); an omitted
    // field stays omitted, and null still clears.
    const patch: Partial<typeof domains.$inferInsert> = { updatedAt: new Date() };
    if (input.rootRedirect !== undefined) patch.rootRedirect = normaliseRedirect(input.rootRedirect);
    if (input.notFoundRedirect !== undefined) patch.notFoundRedirect = normaliseRedirect(input.notFoundRedirect);

    const updated = await this.db.transaction(async (tx) => {
      /* The ownership predicate is repeated on the write itself (and the shared
         domain excluded) so the guard above is not the only thing standing
         between a tenant and the shared row. */
      const [u] = await tx
        .update(domains)
        .set(patch)
        .where(and(eq(domains.id, id), eq(domains.workspaceId, workspaceId), eq(domains.isSystem, false)))
        .returning();
      if (!u) throw new NotFoundException("That domain isn't connected to this workspace.");

      /* Redirect-side freshness.

         Postgres profiles (compose / single-node, CACHE_DRIVER memory or redis):
         the redirect's resolveDomain() is not cached at all — CachingLinkResolver
         passes it straight through — so the new values apply on the very next
         request with nothing to invalidate.

         LINK_PROJECTION=dynamo: the redirect reads a per-domain meta item. Enqueue
         a DOMAIN op (same transaction as the change, then the drain nudge) and
         the worker re-projects the meta item from this row. It is keyed on the
         domain, not on a link, so it works for a domain with no links — the
         case the earlier carrier-link approach missed, which also made a CLEAR
         unrevocable at the edge (#711 review, Blocker-1). */
      await tx.insert(projectionOutbox).values(domainProjectionOp(u.id, u.domain));
      return u;
    });
    this.projectionNudge.nudge();

    /* Before/after values, not just field names, so a redirect change can be
       reconstructed from the audit log alone (#711 review, Minor-6). Only
       fields the request named appear, each as {from, to}. */
    const changes: Record<string, { from: string | null; to: string | null }> = {};
    if (input.rootRedirect !== undefined) changes.rootRedirect = { from: row.rootRedirect, to: updated.rootRedirect };
    if (input.notFoundRedirect !== undefined) {
      changes.notFoundRedirect = { from: row.notFoundRedirect, to: updated.notFoundRedirect };
    }

    await recordActivity(this.db, this.logger, {
      workspaceId,
      actor,
      auditAction: "domain.updated",
      targetType: "domain",
      targetId: id,
      metadata: {
        domain: row.domain,
        fields: Object.keys(changes),
        changes,
      },
    });

    const [count] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(links)
      // #650: same predicate as list() — managed bio links are not user links.
      .where(and(eq(links.domainId, id), eq(links.workspaceId, workspaceId), isNull(links.managedBioPageId)));
    return this.toDto(updated, count?.n ?? 0);
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

    const removed = await this.db.transaction(async (tx) => {
      const result = await tx
        .delete(domains)
        .where(and(eq(domains.id, id), eq(domains.workspaceId, workspaceId)))
        .returning({ id: domains.id, domain: domains.domain });
      if (result.length === 0) throw new NotFoundException("That domain isn't connected to this workspace.");
      /* Drop the dynamo DOMAIN-META item with the domain: left behind, the
         redirect service would keep answering this host's root and missing
         slugs with the old redirects after it was disconnected. The worker
         sees the row gone and deletes the item by payload.host. */
      await tx.insert(projectionOutbox).values(domainProjectionOp(result[0]!.id, result[0]!.domain));
      return result[0]!;
    });
    if (removed) this.projectionNudge.nudge();
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
      shared: row.isSystem,
      dns: row.verificationToken
        ? { type: "TXT", name: `_snapurl.${row.domain}`, value: row.verificationToken, ttl: 300 }
        : null,
    };
  }
}

import { ForbiddenException, Inject, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import * as argon2 from "argon2";
import { and, domains, eq, links, sql, users, workspaces, type Database } from "@snapurl/database";
import type { PublicLinkPreview, UnlockLinkResult } from "@snapurl/contract";
import { DB } from "../database/database.module.js";
import { ENV, type Env } from "../config/env.js";
import { TokenService } from "../auth/token.service.js";

@Injectable()
export class PublicService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly tokens: TokenService,
  ) {}

  /**
   * The trust page at /p/[slug]. No authentication — the whole point is that
   * anyone can see where a link goes before clicking it.
   *
   * Deliberately narrow: it returns where the link goes and whether it is safe,
   * and nothing about the workspace, the tags, the click count or the routing
   * rules. Those would leak a customer's campaign structure to anyone who can
   * guess a slug.
   */
  async preview(slug: string, host?: string): Promise<PublicLinkPreview> {
    const filters = [sql`lower(${links.slug}) = ${slug.toLowerCase()}`];
    if (host) filters.push(sql`lower(${domains.domain}) = ${host.toLowerCase()}`);

    const [row] = await this.db
      .select({
        link: links,
        domain: domains,
        workspace: workspaces,
        creator: users.name,
      })
      .from(links)
      .innerJoin(domains, eq(links.domainId, domains.id))
      .innerJoin(workspaces, eq(links.workspaceId, workspaces.id))
      .leftJoin(users, eq(links.createdBy, users.id))
      .where(and(...filters))
      .limit(1);

    if (!row) throw new NotFoundException("That link doesn't exist.");

    /* Two separate switches have to be on. The workspace can turn previews off
       for everything, and an individual link can opt out. Either one off means
       no preview — the more private setting wins. */
    if (!row.workspace.publicPreviews || !row.link.publicPreview) {
      throw new ForbiddenException("The owner of this link has turned off public previews.");
    }

    return {
      shortUrl: `${row.domain.domain}/${row.link.slug}`,
      destination: row.link.destination,
      createdAt: row.link.createdAt.toISOString(),
      createdBy: row.creator ?? row.workspace.name,
      verifiedDomain: row.domain.status === "live",
      safeBrowsing: row.link.safeBrowsingStatus as PublicLinkPreview["safeBrowsing"],
      scannedAt: (row.link.safeBrowsingCheckedAt ?? row.link.createdAt).toISOString(),
      // Not a stored flag — a statement about how the redirect actually behaves.
      setsCookies: false,
      redirectType: row.link.redirectType as PublicLinkPreview["redirectType"],
    };
  }

  /* G3 — password-protected links had no way to submit a password.

     Returns a short-lived token rather than the destination itself: handing
     back the URL would skip click recording, so a password-protected link
     would report zero analytics. A cookie would break the "no cookies set"
     promise the product makes on this very page. */
  async unlock(slug: string, password: string, host?: string): Promise<UnlockLinkResult> {
    const filters = [sql`lower(${links.slug}) = ${slug.toLowerCase()}`];
    if (host) filters.push(sql`lower(${domains.domain}) = ${host.toLowerCase()}`);

    const [row] = await this.db
      .select({ id: links.id, passwordHash: links.passwordHash })
      .from(links)
      .innerJoin(domains, eq(links.domainId, domains.id))
      .where(and(...filters))
      .limit(1);

    if (!row) throw new NotFoundException("That link doesn't exist.");
    if (!row.passwordHash) throw new UnauthorizedException("That link isn't password protected.");

    const ok = await argon2.verify(row.passwordHash, password).catch(() => false);
    if (!ok) throw new UnauthorizedException("That password isn't right.");

    return { unlockToken: await this.tokens.signUnlockToken(row.id), expiresIn: 300 };
  }
}

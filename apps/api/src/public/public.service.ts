import { ForbiddenException, Inject, Injectable, NotFoundException, UnauthorizedException } from "@nestjs/common";
import * as argon2 from "argon2";
import { and, domains, eq, linkCounters, links, routingRules, sql, users, workspaces, type Database } from "@snapurl/database";
import { PREVIEWS_OFF_CODE, PREVIEWS_OFF_MESSAGE, type PublicLinkLock, type PublicLinkPreview, type UnlockLinkResult } from "@snapurl/contract";
import { lifecycleGate } from "@snapurl/domain";
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
   * anyone can see where a link goes before clicking it, except where the owner
   * put a password on it.
   *
   * Deliberately narrow: it returns where the link goes, whether it is safe
   * and whether it works right now, and nothing about the workspace, the tags,
   * the click count or the routing rules themselves. Those would leak a
   * customer's campaign structure to anyone who can guess a slug. The one
   * thing said about rules is that they exist (#764), because without it the
   * page names a destination some visitors will never reach.
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
        clicks: sql<number>`coalesce(${linkCounters.clicks}, 0)`,
        hasRules: sql<boolean>`exists (select 1 from ${routingRules} where ${routingRules.linkId} = ${links.id})`,
      })
      .from(links)
      .innerJoin(domains, eq(links.domainId, domains.id))
      .innerJoin(workspaces, eq(links.workspaceId, workspaces.id))
      .leftJoin(users, eq(links.createdBy, users.id))
      .leftJoin(linkCounters, eq(linkCounters.linkId, links.id))
      .where(and(...filters))
      .limit(1);

    if (!row) throw new NotFoundException("That link doesn't exist.");

    /* Two separate switches have to be on. The workspace can turn previews off
       for everything, and an individual link can opt out. Either one off means
       no preview — the more private setting wins. */
    if (!row.workspace.publicPreviews || !row.link.publicPreview) {
      /* The body carries a machine-readable code (#765): the trust page shows a
         deliberate "previews are turned off" state for this refusal, and the
         web client rewrites every 403's message, so only the body can say. */
      throw new ForbiddenException({
        statusCode: 403,
        message: PREVIEWS_OFF_MESSAGE,
        error: "Forbidden",
        code: PREVIEWS_OFF_CODE,
      });
    }

    /* A password guards the destination itself. Returning it here let anyone
       read where a protected link goes, and follow it without the password or
       a recorded click, from a page that needs no session. Unlock is the only
       way through for these, and it hands back a token, never the URL. */
    const passwordProtected = row.link.passwordHash != null;

    /* #764 — what a visitor gets, by the redirect's own rule, so this page can
       no longer call an expired link "safe to open". The fallback is reported
       only as a fact, never its URL, and only for the states whose gate uses
       one (a click limit and archiving answer 410). For a protected link not
       even the fact: whether its fallbacks sit behind the password is open
       (#802), so the preview neither confirms nor denies one. */
    const gate = lifecycleGate({
      archived: row.link.archivedAt != null,
      expiresAt: row.link.expiresAt,
      activatesAt: row.link.activatesAt,
      clickLimit: row.link.clickLimit,
      clicks: Number(row.clicks),
    });
    const fallback =
      gate === "expired" ? row.link.expiresTo : gate === "scheduled" ? row.link.scheduledTo : null;

    return {
      shortUrl: `${row.domain.domain}/${row.link.slug}`,
      destination: passwordProtected ? null : row.link.destination,
      passwordProtected,
      createdAt: row.link.createdAt.toISOString(),
      createdBy: row.creator ?? row.workspace.name,
      verifiedDomain: row.domain.status === "live",
      safeBrowsing: row.link.safeBrowsingStatus as PublicLinkPreview["safeBrowsing"],
      scannedAt: (row.link.safeBrowsingCheckedAt ?? row.link.createdAt).toISOString(),
      // Not a stored flag — a statement about how the redirect actually behaves.
      setsCookies: false,
      redirectType: row.link.redirectType as PublicLinkPreview["redirectType"],
      state: gate ?? "active",
      expiresAt: row.link.expiresAt?.toISOString() ?? null,
      activatesAt: row.link.activatesAt?.toISOString() ?? null,
      hasRules: Boolean(row.hasRules),
      hasFallback: passwordProtected ? null : fallback != null,
    };
  }

  /* #762 — what the unlock form needs, and only that.

     The redirect sends a protected link's visitor to /p/<slug>?unlock=1. The
     page drew the password form from preview(), which is refused when the
     owner turns public previews off — so with previews off a protected link
     could not be opened at all. Previews are a privacy setting for the "+"
     trust page; the password is what guards the destination, and turning one
     off must not turn the other off.

     Not gated by either previews switch, so it carries nothing those switches
     hide: the short URL to come back through with a token, and whether a
     password guards it. Never the destination, and nothing about the creator,
     dates or scan state. Existence is no news: the redirect itself already
     answers for the slug. */
  async lock(slug: string, host?: string): Promise<PublicLinkLock> {
    const filters = [sql`lower(${links.slug}) = ${slug.toLowerCase()}`];
    if (host) filters.push(sql`lower(${domains.domain}) = ${host.toLowerCase()}`);

    const [row] = await this.db
      .select({ slug: links.slug, domain: domains.domain, passwordHash: links.passwordHash })
      .from(links)
      .innerJoin(domains, eq(links.domainId, domains.id))
      .where(and(...filters))
      .limit(1);

    if (!row) throw new NotFoundException("That link doesn't exist.");
    return { shortUrl: `${row.domain}/${row.slug}`, passwordProtected: row.passwordHash != null };
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

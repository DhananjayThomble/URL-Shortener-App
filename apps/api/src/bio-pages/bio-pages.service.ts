import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { and, asc, bioBlocks, bioPages, domains, eq, inArray, isUniqueViolation, links, projectionOutbox, sql, type Database, type Executor } from "@snapurl/database";
import type { BioPage, PublicBioPage, UpsertBioPageInput } from "@snapurl/contract";
import { bioManagedDestination, isSlugAvailableShape } from "@snapurl/domain";
import { DB } from "../database/database.module.js";
import { ENV, type Env } from "../config/env.js";
import { LinkCacheBustService } from "../common/link-cache-bust.service.js";
import { ProjectionNudgeService } from "../links/projection-nudge.service.js";
import { initialsOf } from "../auth/auth.service.js";

@Injectable()
export class BioPagesService {
  private readonly logger = new Logger(BioPagesService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly cacheBust: LinkCacheBustService,
    private readonly projectionNudge: ProjectionNudgeService,
  ) {}

  async list(workspaceId: string): Promise<BioPage[]> {
    const pages = await this.db
      .select({ page: bioPages, domain: domains.domain })
      .from(bioPages)
      .innerJoin(domains, eq(bioPages.domainId, domains.id))
      .where(eq(bioPages.workspaceId, workspaceId))
      .orderBy(asc(bioPages.createdAt));

    if (pages.length === 0) return [];

    const blocks = await this.db
      .select()
      .from(bioBlocks)
      .where(inArray(bioBlocks.bioPageId, pages.map((p) => p.page.id)))
      .orderBy(asc(bioBlocks.position));

    const byPage = new Map<string, typeof blocks>();
    for (const block of blocks) {
      const list = byPage.get(block.bioPageId) ?? [];
      list.push(block);
      byPage.set(block.bioPageId, list);
    }

    return pages.map(({ page, domain }) => {
      const pageBlocks = byPage.get(page.id) ?? [];
      const totalClicks = pageBlocks.reduce((sum, b) => sum + b.clicks, 0);
      return {
        id: page.id,
        domain,
        slug: page.slug,
        status: page.status as BioPage["status"],
        blocks: pageBlocks.map((b) => ({
          id: b.id,
          kind: b.kind as BioPage["blocks"][number]["kind"],
          title: b.title,
          subtitle: b.subtitle,
          metric: b.clicks > 0 ? `${b.clicks.toLocaleString()} ${b.clicks === 1 ? "click" : "clicks"}` : null,
          locked: Boolean(b.locked),
          href: b.href,
        })),
        views: page.views,
        // Null rather than 0 when there is nothing to divide — a 0% CTR on a
        // page nobody has visited is a lie the UI would render as a real number.
        clickThrough: page.views > 0 ? Math.round((totalClicks / page.views) * 1000) / 10 : null,
        profile: {
          name: page.profileName,
          bio: page.profileBio,
          initials: initialsOf(page.profileName),
        },
      };
    });
  }

  async upsert(workspaceId: string, input: UpsertBioPageInput): Promise<BioPage> {
    const shape = isSlugAvailableShape(input.slug);
    if (!shape.ok) throw new BadRequestException(shape.reason);

    const [domain] = await this.db
      .select()
      .from(domains)
      .where(and(sql`lower(${domains.domain}) = ${input.domain.toLowerCase()}`, sql`(${domains.workspaceId} = ${workspaceId} or ${domains.isSystem} = true)`))
      .limit(1);
    if (!domain) throw new BadRequestException(`${input.domain} isn't a domain in this workspace.`);

    const outcome = await this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select({ id: bioPages.id })
        .from(bioPages)
        .where(and(eq(bioPages.domainId, domain.id), sql`lower(${bioPages.slug}) = ${input.slug.toLowerCase()}`))
        .limit(1);

      let id: string;
      if (existing) {
        await tx
          .update(bioPages)
          .set({
            status: input.status,
            profileName: input.profile.name,
            profileBio: input.profile.bio,
            updatedAt: new Date(),
          })
          .where(eq(bioPages.id, existing.id));
        id = existing.id;
      } else {
        const [row] = await tx
          .insert(bioPages)
          .values({
            workspaceId,
            domainId: domain.id,
            slug: input.slug,
            status: input.status,
            profileName: input.profile.name,
            profileBio: input.profile.bio,
          })
          .returning();
        id = row!.id;
      }

      /* Blocks are replaced wholesale rather than diffed.

         Position is a unique key, so an in-place reorder would collide with
         itself halfway through unless every update ran in a specific order.
         Delete-and-reinsert inside the transaction is simpler and correct.

         A block the client sends back with its id is the same block: it is
         reinserted under that id with its click count, so reordering or
         renaming a block does not reset its analytics, and a visitor's open
         tab still addresses it. Only ids already on THIS page are honoured —
         an id from anywhere else is a new block. */
      const previous = await tx
        .select({ id: bioBlocks.id, clicks: bioBlocks.clicks, linkId: bioBlocks.linkId })
        .from(bioBlocks)
        .where(eq(bioBlocks.bioPageId, id));
      const kept = new Map(previous.map((b) => [b.id, b]));
      const seen = new Set<string>();

      await tx.delete(bioBlocks).where(eq(bioBlocks.bioPageId, id));
      if (input.blocks.length) {
        await tx.insert(bioBlocks).values(
          input.blocks.map((block, position) => {
            const prior = block.id && !seen.has(block.id) ? kept.get(block.id) : undefined;
            if (prior) seen.add(prior.id);
            return {
              ...(prior ? { id: prior.id, clicks: prior.clicks, linkId: prior.linkId } : {}),
              bioPageId: id,
              position,
              kind: block.kind,
              title: block.title,
              subtitle: block.subtitle ?? null,
              href: block.href ?? null,
              locked: block.locked ?? false,
            };
          }),
        );
      }

      /* #650 — reconcile the managed link in the SAME transaction as the
         publish, so the `links_domain_slug_key` unique index is what decides
         whether this (domain, slug) is free. A live page owns a link at its
         address; a draft owns none. */
      const bust = await this.reconcileManagedLink(tx, {
        bioPageId: id,
        workspaceId,
        domainId: domain.id,
        domainName: domain.domain,
        slug: input.slug,
        live: input.status === "live",
      });

      return { id, bust };
    });

    // The managed-link projection and cache invalidation ride the EXISTING
    // link paths (#650 item 2): nudge the worker to drain the outbox row the
    // reconcile enqueued, and bust the redirect's hot-cache entry when a link
    // was created, repointed or removed — never from inside the transaction.
    if (outcome.bust) {
      this.projectionNudge.nudge();
      await this.cacheBust.bust(outcome.bust.domain, outcome.bust.slug);
    }

    const all = await this.list(workspaceId);
    const page = all.find((p) => p.id === outcome.id);
    if (!page) throw new NotFoundException();
    return page;
  }

  /**
   * Create, repoint or remove the managed link that fronts a bio page (#650).
   *
   * A PUBLISHED page owns a link at `<domain>/<slug>` whose destination is the
   * web app's `/b/<domain>/<slug>`. Because it is a real row in `links`, the
   * `links_domain_slug_key` unique index refuses a collision with a user link
   * in BOTH directions — publishing onto a slug a link already holds throws
   * here (surfaced as a 409 by the controller), and creating a user link on a
   * slug a bio page holds throws in LinksService exactly the same way.
   *
   * A DRAFT (or a re-save of one) owns no link: any managed link for this page
   * is deleted so the slug is free again.
   *
   * Returns the (host, slug) whose redirect-cache entry must be busted after
   * commit, or null when nothing about the link changed.
   */
  private async reconcileManagedLink(
    tx: Executor,
    args: { bioPageId: string; workspaceId: string; domainId: string; domainName: string; slug: string; live: boolean },
  ): Promise<{ domain: string; slug: string } | null> {
    const [owned] = await tx
      .select({ id: links.id, slug: links.slug, destination: links.destination, domainId: links.domainId })
      .from(links)
      .where(eq(links.managedBioPageId, args.bioPageId))
      .limit(1);

    if (!args.live) {
      // Unpublish: the page owns no link while it is a draft.
      if (!owned) return null;
      await this.enqueueManagedProjection(tx, owned.id, "delete");
      await tx.delete(links).where(eq(links.id, owned.id));
      return { domain: args.domainName, slug: owned.slug };
    }

    const destination = bioManagedDestination(this.env.WEB_ORIGIN, args.domainName, args.slug);

    // Already owns a link: repoint/rename it to the page's current address.
    // The slug or domain can change if the page was moved before this publish.
    if (owned) {
      const moved = owned.domainId !== args.domainId || owned.slug.toLowerCase() !== args.slug.toLowerCase();
      const repointed = owned.destination !== destination;
      if (!moved && !repointed) return null;
      try {
        await tx
          .update(links)
          .set({ domainId: args.domainId, slug: args.slug, destination, updatedAt: new Date() })
          .where(eq(links.id, owned.id));
      } catch (err) {
        if (isUniqueViolation(err)) throw this.slugInUse(args.domainName, args.slug);
        throw err;
      }
      await this.enqueueManagedProjection(tx, owned.id, "upsert");
      // Bust the old address too if it moved; the new one is covered by the
      // caller's single bust. A move is rare, so one extra bust is cheap.
      if (moved) await this.cacheBust.bust(args.domainName, owned.slug);
      return { domain: args.domainName, slug: args.slug };
    }

    // No managed link yet: create one. A collision with a user link (or a
    // sibling bio page's link) violates links_domain_slug_key.
    let linkId: string;
    try {
      const [row] = await tx
        .insert(links)
        .values({
          workspaceId: args.workspaceId,
          domainId: args.domainId,
          slug: args.slug,
          destination,
          managedBioPageId: args.bioPageId,
          // A managed link is a plain 302 to the web host; it carries none of
          // the user-facing link options and is never password-protected.
          redirectType: "302",
          // Nothing to scan — the destination is our own web app.
          safeBrowsingStatus: "clean",
          safeBrowsingCheckedAt: new Date(),
        })
        .returning({ id: links.id });
      linkId = row!.id;
    } catch (err) {
      if (isUniqueViolation(err)) throw this.slugInUse(args.domainName, args.slug);
      throw err;
    }
    await this.enqueueManagedProjection(tx, linkId, "upsert");
    return { domain: args.domainName, slug: args.slug };
  }

  private slugInUse(domain: string, slug: string): ConflictException {
    return new ConflictException(`${domain}/${slug} is already in use on this domain. Pick another slug for this page.`);
  }

  /** Enqueue a projection-outbox row for a managed link — the same mechanism
   *  LinksService uses, so the redirect/Dynamo/edge paths stay unchanged and a
   *  managed link projects exactly like any other link. */
  private async enqueueManagedProjection(tx: Executor, linkId: string, operation: "upsert" | "delete") {
    await tx.insert(projectionOutbox).values({ linkId, operation, payload: { linkId, operation } });
  }

  /* ---------------- public ---------------- */

  /**
   * A signed-out visitor's view of a published bio page at an explicit
   * (domain, slug) — the per-domain route the managed link 302s to (#650).
   *
   * A draft or missing page is 404'd rather than 403'd — whether a workspace
   * has a page at this address is not a stranger's business, the same rule
   * `FormsService.publicForm` follows. Workspace analytics (views,
   * click-through, per-block clicks) never cross this boundary; only the
   * profile and the blocks a visitor is meant to click do.
   */
  async publicPage(domain: string, slug: string): Promise<PublicBioPage> {
    return this.renderPublic(await this.livePage(domain, slug));
  }

  /**
   * The backward-compatible alias for already-shared `/b/<slug>` URLs (#650
   * item 3). It resolves ONLY on a system (shared/default) domain. Rationale:
   * a slug is unique per domain, so a bare slug can be ambiguous across
   * domains; rather than guess, the alias answers only for the shared domain
   * every workspace publishes on, which is where the old slug-only URLs were
   * created in the first place. A slug that exists only on a custom domain
   * 404s here and must be reached through its per-domain URL. This is the
   * documented choice in docs/DECISIONS.md.
   */
  async publicPageBySlug(slug: string): Promise<PublicBioPage> {
    return this.renderPublic(await this.livePageOnSystemDomain(slug));
  }

  private async renderPublic(page: typeof bioPages.$inferSelect): Promise<PublicBioPage> {
    const blocks = await this.db
      .select()
      .from(bioBlocks)
      .where(eq(bioBlocks.bioPageId, page.id))
      .orderBy(asc(bioBlocks.position));

    return {
      slug: page.slug,
      profile: {
        name: page.profileName,
        bio: page.profileBio,
        initials: initialsOf(page.profileName),
      },
      blocks: blocks.map((b) => ({
        id: b.id,
        kind: b.kind as PublicBioPage["blocks"][number]["kind"],
        title: b.title,
        subtitle: b.subtitle,
        href: b.href,
      })),
    };
  }

  /** One visit to a published page. A bare counter: no visitor identity, no
   *  IP and no cookie is involved, so this stays inside the cookieless
   *  analytics promise. */
  async recordView(domain: string, slug: string): Promise<void> {
    const page = await this.livePage(domain, slug);
    await this.db
      .update(bioPages)
      .set({ views: sql`${bioPages.views} + 1` })
      .where(eq(bioPages.id, page.id));
  }

  /** The alias counter: a view on `/b/<slug>` for an already-shared URL, on
   *  the system domain only. */
  async recordViewBySlug(slug: string): Promise<void> {
    const page = await this.livePageOnSystemDomain(slug);
    await this.db
      .update(bioPages)
      .set({ views: sql`${bioPages.views} + 1` })
      .where(eq(bioPages.id, page.id));
  }

  /** One click on a block of a published page. The block must belong to the
   *  page the (domain, slug) resolves to — a block id alone counts nothing. */
  async recordClick(domain: string, slug: string, blockId: string): Promise<void> {
    await this.incrementBlock(await this.livePage(domain, slug), blockId);
  }

  /** The alias click counter for an already-shared `/b/<slug>` URL. */
  async recordClickBySlug(slug: string, blockId: string): Promise<void> {
    await this.incrementBlock(await this.livePageOnSystemDomain(slug), blockId);
  }

  private async incrementBlock(page: typeof bioPages.$inferSelect, blockId: string): Promise<void> {
    const result = await this.db
      .update(bioBlocks)
      .set({ clicks: sql`${bioBlocks.clicks} + 1` })
      .where(and(eq(bioBlocks.id, blockId), eq(bioBlocks.bioPageId, page.id)))
      .returning({ id: bioBlocks.id });
    if (result.length === 0) throw new NotFoundException("That block isn't on this page.");
  }

  /** The page a visitor at `/b/<domain>/<slug>` sees. Every per-domain public
   *  route resolves through here so a view or click can only ever land on the
   *  page that was shown. Resolution is exact on (domain, slug). */
  private async livePage(domain: string, slug: string) {
    const [page] = await this.db
      .select({ page: bioPages })
      .from(bioPages)
      .innerJoin(domains, eq(bioPages.domainId, domains.id))
      .where(
        and(
          sql`lower(${domains.domain}) = ${domain.toLowerCase()}`,
          sql`lower(${bioPages.slug}) = ${slug.toLowerCase()}`,
          eq(bioPages.status, "live"),
        ),
      )
      .limit(1);

    if (!page) throw new NotFoundException("There's no page at that address.");
    return page.page;
  }

  /** The alias resolver: a live page for this slug on a SYSTEM domain only.
   *  See `publicPageBySlug` for why a bare slug resolves only there. If more
   *  than one system domain carries the slug (vanishingly unlikely — the
   *  shared domain is one row), the oldest wins, deterministically. */
  private async livePageOnSystemDomain(slug: string) {
    const [page] = await this.db
      .select({ page: bioPages })
      .from(bioPages)
      .innerJoin(domains, eq(bioPages.domainId, domains.id))
      .where(
        and(
          sql`lower(${bioPages.slug}) = ${slug.toLowerCase()}`,
          eq(bioPages.status, "live"),
          eq(domains.isSystem, true),
        ),
      )
      .orderBy(asc(bioPages.createdAt))
      .limit(1);

    if (!page) throw new NotFoundException("There's no page at that address.");
    return page.page;
  }

  async remove(workspaceId: string, id: string): Promise<void> {
    /* Read the managed link's (domain, slug) BEFORE the delete so the
       cache-bust key still means something afterwards — once the rows are gone
       there is nothing left to join against for the domain string. We delete
       the managed link EXPLICITLY (the FK is ON DELETE NO ACTION, not CASCADE,
       so a raw page delete would be refused while the link exists — that is
       the point: deletion must come through here) and enqueue its projection
       delete + bust its cache, the same invalidation the user-link delete path
       uses (#650 item 2), not a new one. */
    const row = await this.db
      .select({ linkId: links.id, slug: links.slug, domain: domains.domain })
      .from(bioPages)
      .leftJoin(links, eq(links.managedBioPageId, bioPages.id))
      .innerJoin(domains, eq(bioPages.domainId, domains.id))
      .where(and(eq(bioPages.id, id), eq(bioPages.workspaceId, workspaceId)))
      .limit(1);
    if (row.length === 0) throw new NotFoundException("That bio page doesn't exist in this workspace.");
    const managed = row[0]!;

    await this.db.transaction(async (tx) => {
      if (managed.linkId) {
        await this.enqueueManagedProjection(tx, managed.linkId, "delete");
        // Remove the managed link FIRST — the NO ACTION FK refuses the page
        // delete while this row still references it.
        await tx.delete(links).where(eq(links.id, managed.linkId));
      }
      await tx.delete(bioPages).where(and(eq(bioPages.id, id), eq(bioPages.workspaceId, workspaceId)));
    });

    if (managed.linkId && managed.slug) {
      this.projectionNudge.nudge();
      await this.cacheBust.bust(managed.domain, managed.slug);
    }
  }
}

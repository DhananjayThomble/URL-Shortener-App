import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, bioBlocks, bioPages, domains, eq, inArray, sql, type Database } from "@snapurl/database";
import type { BioPage, PublicBioPage, UpsertBioPageInput } from "@snapurl/contract";
import { isSlugAvailableShape } from "@snapurl/domain";
import { DB } from "../database/database.module.js";
import { initialsOf } from "../auth/auth.service.js";

@Injectable()
export class BioPagesService {
  constructor(@Inject(DB) private readonly db: Database) {}

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

    const pageId = await this.db.transaction(async (tx) => {
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

      return id;
    });

    const all = await this.list(workspaceId);
    const page = all.find((p) => p.id === pageId);
    if (!page) throw new NotFoundException();
    return page;
  }

  /* ---------------- public ---------------- */

  /**
   * A signed-out visitor's view of a published bio page, by slug.
   *
   * A draft or missing page is 404'd rather than 403'd — whether a workspace
   * has a page at this address is not a stranger's business, the same rule
   * `FormsService.publicForm` follows. Workspace analytics (views,
   * click-through, per-block clicks) never cross this boundary; only the
   * profile and the blocks a visitor is meant to click do.
   */
  async publicPage(slug: string): Promise<PublicBioPage> {
    const page = await this.livePage(slug);

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
  async recordView(slug: string): Promise<void> {
    const page = await this.livePage(slug);
    await this.db
      .update(bioPages)
      .set({ views: sql`${bioPages.views} + 1` })
      .where(eq(bioPages.id, page.id));
  }

  /** One click on a block of a published page. The block must belong to the
   *  page the slug resolves to — a block id alone counts nothing. */
  async recordClick(slug: string, blockId: string): Promise<void> {
    const page = await this.livePage(slug);
    const result = await this.db
      .update(bioBlocks)
      .set({ clicks: sql`${bioBlocks.clicks} + 1` })
      .where(and(eq(bioBlocks.id, blockId), eq(bioBlocks.bioPageId, page.id)))
      .returning({ id: bioBlocks.id });
    if (result.length === 0) throw new NotFoundException("That block isn't on this page.");
  }

  /** The page a visitor at /b/<slug> sees. Every public route resolves through
   *  here so a view or click can only ever land on the page that was shown. */
  private async livePage(slug: string) {
    const [page] = await this.db
      .select()
      .from(bioPages)
      .where(and(sql`lower(${bioPages.slug}) = ${slug.toLowerCase()}`, eq(bioPages.status, "live")))
      .orderBy(asc(bioPages.createdAt))
      .limit(1);

    if (!page) throw new NotFoundException("There's no page at that address.");
    return page;
  }

  async remove(workspaceId: string, id: string): Promise<void> {
    const result = await this.db
      .delete(bioPages)
      .where(and(eq(bioPages.id, id), eq(bioPages.workspaceId, workspaceId)))
      .returning({ id: bioPages.id });
    if (result.length === 0) throw new NotFoundException("That bio page doesn't exist in this workspace.");
  }
}

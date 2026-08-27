import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, asc, bioBlocks, bioPages, domains, eq, sql, type Database } from "@snapurl/database";
import type { BioPage, UpsertBioPageInput } from "@snapurl/contract";
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
      .where(
        sql`${bioBlocks.bioPageId} in ${sql.raw(`(${pages.map((p) => `'${p.page.id}'::uuid`).join(",")})`)}`,
      )
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
          metric: b.clicks > 0 ? `${b.clicks.toLocaleString()} clicks` : null,
          locked: Boolean(b.locked),
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
         Delete-and-reinsert inside the transaction is simpler and correct. */
      await tx.delete(bioBlocks).where(eq(bioBlocks.bioPageId, id));
      if (input.blocks.length) {
        await tx.insert(bioBlocks).values(
          input.blocks.map((block, position) => ({
            bioPageId: id,
            position,
            kind: block.kind,
            title: block.title,
            subtitle: block.subtitle ?? null,
            href: block.href ?? null,
            locked: block.locked ?? false,
          })),
        );
      }

      return id;
    });

    const all = await this.list(workspaceId);
    const page = all.find((p) => p.id === pageId);
    if (!page) throw new NotFoundException();
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

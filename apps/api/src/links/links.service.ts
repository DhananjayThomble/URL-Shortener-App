import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import * as argon2 from "argon2";
import { and, asc, clickDaily, desc, domains, eq, gte, inArray, isNull, links, projectionOutbox, routingRules, sql, users, type Database, type Executor } from "@snapurl/database";
import type { CreateLinkInput, Link, ListLinksQuery, UpdateLinkInput } from "@snapurl/contract";
import { SLUG_RETRY_LIMIT, generateSlug, isSlugAvailableShape, validateRoutingChain } from "@snapurl/domain";
import { DB } from "../database/database.module.js";
import { SafeBrowsingService } from "../safe-browsing/safe-browsing.service.js";
import { isUniqueViolation } from "../common/postgres-error.filter.js";
import { recordActivity, type Actor } from "../common/activity.js";
import {
  SPARKLINE_DAYS,
  buildSparkline,
  decodeCursor,
  encodeCursor,
  toLinkDto,
  type LinkRow,
  type RuleRow,
} from "./links.mapper.js";

const ARGON_OPTIONS = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 };

@Injectable()
export class LinksService {
  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly safeBrowsing: SafeBrowsingService,
  ) {}

  private readonly logger = new Logger(LinksService.name);

  async list(workspaceId: string, query: ListLinksQuery) {
    const filters = [eq(links.workspaceId, workspaceId)];

    /* "expiring" and "expired" are derived, not stored — deriveStatus computes
       them from expires_at and the click count, so they can never go stale.
       That means the filter has to be expressed in SQL rather than compared
       against a column. */
    /* ISO strings, not Date objects.

       These are interpolated into raw `sql` fragments below, and a raw
       fragment binds its parameter without the column's type mapper — so
       postgres-js receives a Date it cannot serialise and throws
       ERR_INVALID_ARG_TYPE before the query reaches Postgres. Every request
       for ?status=active, expiring or expired failed this way. The explicit
       ::timestamptz cast keeps the comparison typed on the SQL side. */
    const now = new Date().toISOString();
    const inSevenDays = new Date(Date.now() + 7 * 86_400_000).toISOString();

    if (query.status === "archived") {
      filters.push(sql`${links.archivedAt} is not null`);
    } else {
      filters.push(isNull(links.archivedAt));
      if (query.status === "expired") {
        filters.push(
          sql`(${links.expiresAt} <= ${now}::timestamptz or (${links.clickLimit} is not null and ${links.clicks} >= ${links.clickLimit}))`,
        );
      } else if (query.status === "expiring") {
        filters.push(
          sql`${links.expiresAt} > ${now}::timestamptz and ${links.expiresAt} <= ${inSevenDays}::timestamptz`,
        );
      } else if (query.status === "active") {
        filters.push(
          sql`(${links.expiresAt} is null or ${links.expiresAt} > ${inSevenDays}::timestamptz)
              and (${links.clickLimit} is null or ${links.clicks} < ${links.clickLimit})`,
        );
      }
    }

    if (query.search) {
      const needle = `%${query.search}%`;
      filters.push(sql`(${links.slug} ilike ${needle} or ${links.destination} ilike ${needle} or ${links.title} ilike ${needle})`);
    }
    if (query.tag) filters.push(sql`${query.tag} = any(${links.tags})`);
    if (query.folder) filters.push(eq(links.folder, query.folder));
    if (query.domain) filters.push(sql`lower(${domains.domain}) = ${query.domain.toLowerCase()}`);

    const [{ total }] = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(links)
      .innerJoin(domains, eq(links.domainId, domains.id))
      .where(and(...filters));

    const paged = [...filters];
    const cursor = query.cursor ? decodeCursor(query.cursor) : null;
    if (cursor) {
      // Same reason as the window bounds above: a Date bound into a raw
      // fragment never reaches Postgres, so every ?cursor= request threw.
      paged.push(
        sql`(${links.createdAt}, ${links.id}) < (${cursor.createdAt.toISOString()}::timestamptz, ${cursor.id}::uuid)`,
      );
    }

    // One extra row tells us whether there is another page without a second query.
    const rows = await this.db
      .select({ link: links, domain: domains.domain, creator: users.name })
      .from(links)
      .innerJoin(domains, eq(links.domainId, domains.id))
      .leftJoin(users, eq(links.createdBy, users.id))
      .where(and(...paged))
      .orderBy(desc(links.createdAt), desc(links.id))
      .limit(query.limit + 1);

    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const last = page[page.length - 1];

    const items = await this.hydrate(page.map((r) => ({ ...r, link: r.link as LinkRow })));

    return {
      items,
      total: total ?? 0,
      nextCursor: hasMore && last ? encodeCursor(last.link.createdAt, last.link.id) : null,
    };
  }

  async get(workspaceId: string, id: string): Promise<Link> {
    const [row] = await this.db
      .select({ link: links, domain: domains.domain, creator: users.name })
      .from(links)
      .innerJoin(domains, eq(links.domainId, domains.id))
      .leftJoin(users, eq(links.createdBy, users.id))
      .where(and(eq(links.id, id), eq(links.workspaceId, workspaceId)))
      .limit(1);

    if (!row) throw new NotFoundException("That link doesn't exist, or isn't in this workspace.");
    const [dto] = await this.hydrate([{ ...row, link: row.link as LinkRow }]);
    return dto!;
  }

  async create(workspaceId: string, actor: Actor, input: CreateLinkInput): Promise<Link> {
    const domain = await this.resolveDomain(workspaceId, input.domain);

    const problems = validateRoutingChain(input.rules);
    if (problems.length) throw new BadRequestException({ statusCode: 400, error: "Bad Request", message: problems });

    if (input.slug) {
      const shape = isSlugAvailableShape(input.slug);
      if (!shape.ok) throw new BadRequestException(shape.reason);
    }

    const passwordHash = input.password ? await argon2.hash(input.password, ARGON_OPTIONS) : null;
    const scan = await this.safeBrowsing.check(input.destination);

    /* Random slugs, retried on collision.

       A sequential id would let anyone walk the entire table by incrementing a
       number — including the private and beta-invite links. Collisions at 7
       characters are rare enough that retrying is the whole strategy. */
    const attempts = input.slug ? 1 : SLUG_RETRY_LIMIT;
    for (let attempt = 0; attempt < attempts; attempt++) {
      const slug = input.slug || generateSlug();
      try {
        return await this.db.transaction(async (tx) => {
          const [row] = await tx
            .insert(links)
            .values({
              workspaceId,
              domainId: domain.id,
              slug,
              destination: input.destination,
              comment: input.comment ?? null,
              tags: input.tags ?? [],
              folder: input.folder ?? null,
              redirectType: input.redirectType,
              expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
              expiresTo: input.expiresTo ?? null,
              clickLimit: input.clickLimit ?? null,
              passwordHash,
              forwardQuery: input.forwardQuery,
              deepLink: input.deepLink,
              hideReferrer: input.hideReferrer,
              publicPreview: input.publicPreview,
              safeBrowsingStatus: scan.status,
              safeBrowsingCheckedAt: scan.checkedAt,
              utm: input.utm ?? null,
              social: input.social ?? null,
              createdBy: actor.userId,
            })
            .returning();

          if (input.rules.length) {
            await tx.insert(routingRules).values(
              input.rules.map((rule, position) => ({
                linkId: row!.id,
                position,
                whenCountry: rule.when.country?.toUpperCase() ?? null,
                whenDevice: rule.when.device ?? null,
                whenLanguage: rule.when.language?.toLowerCase() ?? null,
                then: rule.then,
                weight: rule.weight ?? null,
              })),
            );
          }

          await this.enqueueProjection(tx, row!.id, "upsert");
          return row!.id;
        })
          .then((id) => this.get(workspaceId, id))
          .then(async (link) => {
            await recordActivity(this.db, this.logger, {
              workspaceId,
              actor,
              auditAction: "link.created",
              webhookEvent: "link.created",
              targetType: "link",
              targetId: link.id,
              metadata: { slug: link.slug, domain: link.domain, destination: link.destination },
            });
            return link;
          });
      } catch (err) {
        if (isUniqueViolation(err)) {
          if (input.slug) {
            throw new ConflictException(`${input.domain}/${input.slug} is already taken. Try another back-half.`);
          }
          continue; // generated slug collided — draw another
        }
        throw err;
      }
    }

    throw new ConflictException("Couldn't find a free back-half. Try again.");
  }

  /* G1 — PATCH did not exist, yet editing a destination is the entire promise
     behind "print it once, change where it points forever". */
  async update(workspaceId: string, id: string, actor: Actor, input: UpdateLinkInput): Promise<Link> {
    const existing = await this.get(workspaceId, id);

    if (input.rules) {
      const problems = validateRoutingChain(input.rules);
      if (problems.length) throw new BadRequestException({ statusCode: 400, error: "Bad Request", message: problems });
    }

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.destination !== undefined) {
      patch.destination = input.destination;
      // A new destination has never been scanned, whatever the old one said.
      const scan = await this.safeBrowsing.check(input.destination);
      patch.safeBrowsingStatus = scan.status;
      patch.safeBrowsingCheckedAt = scan.checkedAt;
    }
    if (input.comment !== undefined) patch.comment = input.comment ?? null;
    if (input.tags !== undefined) patch.tags = input.tags;
    if (input.folder !== undefined) patch.folder = input.folder ?? null;
    if (input.redirectType !== undefined) patch.redirectType = input.redirectType;
    if (input.expiresAt !== undefined) patch.expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    if (input.expiresTo !== undefined) patch.expiresTo = input.expiresTo ?? null;
    if (input.clickLimit !== undefined) patch.clickLimit = input.clickLimit ?? null;
    if (input.forwardQuery !== undefined) patch.forwardQuery = input.forwardQuery;
    if (input.deepLink !== undefined) patch.deepLink = input.deepLink;
    if (input.hideReferrer !== undefined) patch.hideReferrer = input.hideReferrer;
    if (input.publicPreview !== undefined) patch.publicPreview = input.publicPreview;
    if (input.utm !== undefined) patch.utm = input.utm ?? null;
    if (input.social !== undefined) patch.social = input.social ?? null;

    // null clears the password, undefined leaves it alone.
    if (input.password !== undefined) {
      patch.passwordHash = input.password ? await argon2.hash(input.password, ARGON_OPTIONS) : null;
    }
    if (input.archived !== undefined) {
      patch.archivedAt = input.archived ? new Date() : null;
    }

    await this.db.transaction(async (tx) => {
      await tx.update(links).set(patch).where(and(eq(links.id, id), eq(links.workspaceId, workspaceId)));

      if (input.rules) {
        await tx.delete(routingRules).where(eq(routingRules.linkId, id));
        if (input.rules.length) {
          await tx.insert(routingRules).values(
            input.rules.map((rule, position) => ({
              linkId: id,
              position,
              whenCountry: rule.when.country?.toUpperCase() ?? null,
              whenDevice: rule.when.device ?? null,
              whenLanguage: rule.when.language?.toLowerCase() ?? null,
              then: rule.then,
              weight: rule.weight ?? null,
            })),
          );
        }
      }

      await this.enqueueProjection(tx, id, "upsert");
    });

    const updated = await this.get(workspaceId, id);
    await recordActivity(this.db, this.logger, {
      workspaceId,
      actor,
      auditAction: "link.updated",
      webhookEvent: "link.updated",
      targetType: "link",
      targetId: id,
      metadata: {
        slug: updated.slug,
        domain: updated.domain,
        // The old destination is the field anyone auditing an edit is looking
        // for: "where did this QR code point before someone changed it?"
        from: existing.destination,
        to: updated.destination,
      },
    });
    return updated;
  }

  async remove(workspaceId: string, id: string, actor: Actor): Promise<void> {
    // The slug is read before the delete because it is the only thing that
    // makes the audit entry and the webhook payload mean anything afterwards.
    const [row] = await this.db
      .select({ id: links.id, slug: links.slug })
      .from(links)
      .where(and(eq(links.id, id), eq(links.workspaceId, workspaceId)))
      .limit(1);
    if (!row) throw new NotFoundException("That link doesn't exist, or isn't in this workspace.");

    await this.db.transaction(async (tx) => {
      await this.enqueueProjection(tx, id, "delete");
      await tx.delete(links).where(eq(links.id, id));
    });

    await recordActivity(this.db, this.logger, {
      workspaceId,
      actor,
      auditAction: "link.deleted",
      webhookEvent: "link.deleted",
      targetType: "link",
      targetId: id,
      metadata: { slug: row.slug },
    });
  }

  /* CSV export.
   *
   * Yields chunks rather than building one string, and pages through the same
   * `list` used by the dashboard rather than reimplementing its filters. That
   * matters twice over: an export can never disagree with what the table shows,
   * and a workspace with 50,000 links does not have to fit in memory before the
   * first byte reaches the browser.
   *
   * CSV rather than xlsx: v1 shipped an ExcelJS export, but a spreadsheet
   * library is several megabytes of dependency to produce a format that is
   * harder to pipe into anything else. Every tool that opens xlsx opens CSV. */
  async *exportCsv(workspaceId: string, query: ListLinksQuery): AsyncGenerator<string> {
    const columns = [
      "short_url", "destination", "title", "status", "clicks", "unique_clicks",
      "tags", "folder", "redirect_type", "password_protected", "expires_at",
      "safe_browsing", "created_at", "created_by",
    ];
    yield `${columns.join(",")}\n`;

    let cursor: string | undefined;
    const PAGE = 500;

    do {
      const page = await this.list(workspaceId, { ...query, limit: PAGE, cursor });
      for (const link of page.items) {
        yield `${[
          `${link.domain}/${link.slug}`,
          link.destination,
          link.title ?? "",
          link.status,
          link.clicks,
          link.uniqueClicks ?? 0,
          (link.tags ?? []).join(" "),
          link.folder ?? "",
          link.redirectType,
          link.passwordProtected,
          link.expiresAt ?? "",
          link.safeBrowsing.status,
          link.createdAt,
          link.createdBy ?? "",
        ].map(csvCell).join(",")}\n`;
      }
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
  }

  /* The projection outbox.

     The redirect path reads from DynamoDB, not Postgres. Writing to both inside
     one request would mean a crash between the two leaves the edge serving a
     stale destination with nothing to notice. The row and the outbox entry
     commit together, and the worker drains it — so a failed projection retries
     instead of silently diverging. */
  private async enqueueProjection(tx: Executor, linkId: string, operation: "upsert" | "delete") {
    await tx.insert(projectionOutbox).values({ linkId, operation, payload: { linkId, operation } });
  }

  private async resolveDomain(workspaceId: string, domain: string) {
    const [row] = await this.db
      .select()
      .from(domains)
      .where(
        and(
          sql`lower(${domains.domain}) = ${domain.toLowerCase()}`,
          // Either this workspace owns it, or it is the shared system domain.
          sql`(${domains.workspaceId} = ${workspaceId} or ${domains.isSystem} = true)`,
        ),
      )
      .limit(1);
    if (!row) throw new BadRequestException(`${domain} isn't a domain you can use.`);
    if (row.status !== "live") {
      throw new BadRequestException(`${domain} isn't verified yet, so links on it wouldn't resolve.`);
    }
    return row;
  }

  /** Batch the rules and sparklines for a page of links — otherwise a 50-row
   *  table issues 101 queries. */
  private async hydrate(rows: Array<{ link: LinkRow; domain: string; creator: string | null }>) {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.link.id);

    const rules = await this.db
      .select()
      .from(routingRules)
      .where(inArray(routingRules.linkId, ids))
      .orderBy(asc(routingRules.position));

    const since = new Date();
    since.setUTCDate(since.getUTCDate() - SPARKLINE_DAYS);
    const daily = await this.db
      .select({ linkId: clickDaily.linkId, day: clickDaily.day, clicks: clickDaily.clicks })
      .from(clickDaily)
      .where(and(inArray(clickDaily.linkId, ids), gte(clickDaily.day, since.toISOString().slice(0, 10))));

    const rulesByLink = new Map<string, RuleRow[]>();
    for (const rule of rules) {
      const list = rulesByLink.get(rule.linkId) ?? [];
      list.push(rule as RuleRow);
      rulesByLink.set(rule.linkId, list);
    }

    const dailyByLink = new Map<string, Array<{ day: string; clicks: number }>>();
    for (const d of daily) {
      const list = dailyByLink.get(d.linkId) ?? [];
      list.push({ day: d.day, clicks: d.clicks });
      dailyByLink.set(d.linkId, list);
    }

    return rows.map((row) =>
      toLinkDto(
        row.link,
        row.domain,
        rulesByLink.get(row.link.id) ?? [],
        buildSparkline(dailyByLink.get(row.link.id) ?? []),
        row.creator,
      ),
    );
  }
}


/**
 * Quote a CSV cell.
 *
 * Destinations routinely contain commas and query strings, and a title can
 * contain anything a person typed. Unescaped, one such value shifts every
 * subsequent column on that row — which does not error, it just silently
 * produces a file where the data is in the wrong place.
 *
 * A leading =, +, - or @ is prefixed with a quote as well. Spreadsheets treat
 * those as formulas, so a destination beginning with one is a CSV injection
 * waiting for someone to open the export.
 */
function csvCell(value: unknown): string {
  const s = String(value ?? "");
  const guarded = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

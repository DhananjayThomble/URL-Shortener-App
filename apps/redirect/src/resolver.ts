import {
  and,
  domains,
  domainMetaKey,
  eq,
  fromDomainItem,
  fromLinkItem,
  linkCounters,
  linkKey,
  links,
  normaliseHost,
  routingRules,
  sql,
  type Database,
  type DomainItem,
  type LinkItem,
} from "@snapurl/database";
import { GetCommand, type DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { RoutingRule } from "@snapurl/contract";

/* normaliseHost lives in @snapurl/database's link-projection module now — the
   single source of truth shared by the Postgres lookup here and the DynamoDB
   projection key-builders — and is re-exported so existing importers
   (main.ts, caching-resolver.ts, the tests) keep importing it from here. */
export { normaliseHost };

/* ============================================================
   Resolving (host, slug) to everything the redirect needs.

   This is behind a port on purpose. In production it reads the
   DynamoDB projection the API writes — one HTTP-based key lookup,
   no connection pool to warm, which is what makes the hot path
   viable on Lambda. Locally and for self-hosting it reads
   Postgres directly, so the whole product runs with one database
   and no AWS account.

   Both adapters return the same shape, so nothing downstream
   knows or cares which one it got.
   ============================================================ */

export interface ResolvedLink {
  id: string;
  workspaceId: string;
  destination: string;
  redirectType: "301" | "302" | "307";
  rules: RoutingRule[];
  expiresAt: Date | null;
  expiresTo: string | null;
  activatesAt: Date | null;
  scheduledTo: string | null;
  clickLimit: number | null;
  clicks: number;
  hasPassword: boolean;
  forwardQuery: boolean;
  deepLink: boolean;
  hideReferrer: boolean;
  publicPreview: boolean;
  archived: boolean;
  safeBrowsingStatus: string;
  utm: {
    source?: string | null;
    medium?: string | null;
    campaign?: string | null;
    content?: string | null;
  } | null;
}

export interface ResolvedDomain {
  id: string;
  rootRedirect: string | null;
  notFoundRedirect: string | null;
}

export interface LinkResolver {
  resolve(host: string, slug: string): Promise<ResolvedLink | null>;
  resolveDomain(host: string): Promise<ResolvedDomain | null>;
}

export class PostgresLinkResolver implements LinkResolver {
  constructor(private readonly db: Database) {}

  async resolve(host: string, slug: string): Promise<ResolvedLink | null> {
    const normalisedHost = normaliseHost(host);
    const normalisedSlug = slug.toLowerCase();

    /* The link row (with its counter) and the routing rules are independent
       lookups, so they run concurrently — one RTT saved on every redirect.
       The rules query used to filter on `routingRules.linkId = row.link.id`,
       which forced it to wait for the link query first. Keying it off the same
       (host, slug) predicate via a join to links -> domains removes that
       dependency without changing the result: a (host, slug) pair resolves to
       at most one link, so the rules matched are exactly the ones that link
       owns. The rules query usually returns zero rows, so this is a cheap
       parallel query on the hot path. */
    const [[row], rules] = await Promise.all([
      this.db
        .select({ link: links, domainId: domains.id, clicks: sql<number>`coalesce(${linkCounters.clicks}, 0)` })
        .from(links)
        .innerJoin(domains, eq(links.domainId, domains.id))
        .leftJoin(linkCounters, eq(linkCounters.linkId, links.id))
        .where(
          and(
            sql`lower(${domains.domain}) = ${normalisedHost}`,
            sql`lower(${links.slug}) = ${normalisedSlug}`,
          ),
        )
        .limit(1),
      this.db
        .select({ rule: routingRules })
        .from(routingRules)
        .innerJoin(links, eq(routingRules.linkId, links.id))
        .innerJoin(domains, eq(links.domainId, domains.id))
        .where(
          and(
            sql`lower(${domains.domain}) = ${normalisedHost}`,
            sql`lower(${links.slug}) = ${normalisedSlug}`,
          ),
        )
        .orderBy(routingRules.position),
    ]);

    if (!row) return null;

    return {
      id: row.link.id,
      workspaceId: row.link.workspaceId,
      destination: row.link.destination,
      redirectType: row.link.redirectType as ResolvedLink["redirectType"],
      rules: rules.map(({ rule: r }) => ({
        id: r.id,
        when: {
          country: r.whenCountry,
          device: r.whenDevice as RoutingRule["when"]["device"],
          language: r.whenLanguage,
        },
        then: r.then,
        weight: r.weight,
      })),
      expiresAt: row.link.expiresAt,
      expiresTo: row.link.expiresTo,
      activatesAt: row.link.activatesAt,
      scheduledTo: row.link.scheduledTo,
      clickLimit: row.link.clickLimit,
      clicks: row.clicks,
      hasPassword: Boolean(row.link.passwordHash),
      forwardQuery: row.link.forwardQuery,
      deepLink: row.link.deepLink,
      hideReferrer: row.link.hideReferrer,
      publicPreview: row.link.publicPreview,
      archived: Boolean(row.link.archivedAt),
      safeBrowsingStatus: row.link.safeBrowsingStatus,
      utm: row.link.utm,
    };
  }

  async resolveDomain(host: string): Promise<ResolvedDomain | null> {
    const [row] = await this.db
      .select({ id: domains.id, rootRedirect: domains.rootRedirect, notFoundRedirect: domains.notFoundRedirect })
      .from(domains)
      .where(sql`lower(${domains.domain}) = ${normaliseHost(host)}`)
      .limit(1);
    return row ?? null;
  }
}

/* ============================================================
   DynamoLinkResolver — the AWS-serverless-profile adapter.

   Reads the projection the worker writes (see the worker's
   DynamoProjection and @snapurl/database/link-projection). One
   GetItem per resolve, no connection pool, which is what makes the
   redirect viable on Lambda without the ~109-connection RDS
   ceiling — and, in FEAT-003, lets it leave the VPC entirely.

   The DynamoDBDocumentClient and table name are injected via the
   constructor so the command shapes can be unit-tested against a
   mocked client, exactly like DynamoDbCacheStore. The item shape
   and the Date revival are the shared mapper's, so a field this
   returns cannot drift from a field the worker projected.
   ============================================================ */
export class DynamoLinkResolver implements LinkResolver {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly table: string,
  ) {}

  async resolve(host: string, slug: string): Promise<ResolvedLink | null> {
    const result = await this.client.send(
      new GetCommand({ TableName: this.table, Key: linkKey(host, slug) }),
    );
    if (!result.Item) return null;
    return fromLinkItem(result.Item as LinkItem);
  }

  async resolveDomain(host: string): Promise<ResolvedDomain | null> {
    const result = await this.client.send(
      new GetCommand({ TableName: this.table, Key: domainMetaKey(host) }),
    );
    if (!result.Item) return null;
    return fromDomainItem(result.Item as DomainItem);
  }
}

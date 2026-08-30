import {
  domains,
  eq,
  linkCounters,
  links,
  routingRules,
  sql,
  toDomainItem,
  toLinkItem,
  LINK_ID_ATTR,
  LINK_ID_GSI,
  type Database,
  type DomainItem,
  type LinkItem,
  type ProjectedDomain,
  type ProjectedLink,
} from "@snapurl/database";
import type { RoutingRule } from "@snapurl/contract";
import {
  BatchWriteCommand,
  QueryCommand,
  type DynamoDBDocumentClient,
} from "@aws-sdk/lib-dynamodb";
import type { ProjectionOp, ProjectionResult, ProjectionTarget } from "./outbox.js";

/* ============================================================
   DynamoProjection — the real projection writer (AWS profile).

   Replaces NoProjection under LINK_PROJECTION=dynamo. It reads a
   link's config from Postgres (the link row still exists for an
   upsert) and writes the LINK item + the domain-meta item into the
   DynamoDB projection the redirect's DynamoLinkResolver reads.

   Batching (why drainOutbox hands it a whole claimed batch): a
   100-link bulk import must not be 100 sequential round trips. The
   optional apply() method takes the entire claimed batch, buffers
   all the puts/deletes, and flushes them in BatchWriteCommand
   requests of at most 25 items each — so N links cost O(N / 25 * 2)
   round trips (each link contributes a LINK put and a domain-meta
   put), not O(N). UnprocessedItems are retried with bounded
   backoff. The per-row upsert/remove methods remain for the
   fallback path (a target without apply(), e.g. NoProjection), so
   nothing about the default no-op behaviour changes.

   The delete-key gap: the outbox row for a delete carries only the
   link id, and the API removed the link row in the same
   transaction, so (domain, slug) cannot be read from Postgres. The
   projection table therefore has a GSI on the top-level `linkId`
   attribute (LINK_ID_GSI); remove(linkId) queries it and deletes
   the matching LINK item(s) by their real PK/SK.
   ============================================================ */

/** DynamoDB caps a BatchWriteItem at 25 requests. */
const BATCH_LIMIT = 25;

/** Bounded retries for UnprocessedItems returned by BatchWriteItem. */
const MAX_BATCH_ATTEMPTS = 5;

/** A single put or delete request destined for a BatchWriteCommand. */
type WriteRequest =
  | { PutRequest: { Item: LinkItem | DomainItem } }
  | { DeleteRequest: { Key: { PK: string; SK: string } } };

export class DynamoProjection implements ProjectionTarget {
  constructor(
    private readonly db: Database,
    private readonly client: DynamoDBDocumentClient,
    private readonly table: string,
  ) {}

  /* ---- per-row fallback (used when drainOutbox does not batch) ---- */

  async upsert(linkId: string): Promise<void> {
    const requests = await this.buildUpsertRequests(linkId);
    await this.flush(requests);
  }

  async remove(linkId: string): Promise<void> {
    const requests = await this.buildDeleteRequests(linkId);
    await this.flush(requests);
  }

  /* ---- batched path (drainOutbox hands the whole claimed batch here) ----

     Each op is resolved to its write requests INDEPENDENTLY and marked
     per-op, so drainOutbox keeps its per-row processed_at / attempts
     bookkeeping: an op whose requests all flush is `ok: true`; an op whose
     resolution or flush throws is `ok: false` with the error, and only that
     row bumps attempts. The DynamoDB writes across all successfully-resolved
     ops are coalesced into <=25-item BatchWriteCommands so N links are
     O(N / 25) round trips, not N. */
  async apply(ops: ProjectionOp[]): Promise<ProjectionResult[]> {
    const results: ProjectionResult[] = [];
    const pending: WriteRequest[] = [];
    /* Which result indices a given write request belongs to, so a flush
       failure can be attributed back to the exact ops that were in it. */
    const owners: number[][] = [];

    for (const op of ops) {
      const index = results.length;
      try {
        /* NOTE: resolution is per-op and sequential, so a batch of N deletes
           issues N GSI QueryCommands here (one per linkId) BEFORE any writes
           are coalesced — the read side is O(N) round trips even though the
           writes below are batched to O(N / 25). This is a deliberate
           trade-off: deletes are rare relative to upserts (a delete is a
           user removing a link, an upsert is every edit and every new link),
           so the read fan-out is not worth batching with a BatchGetItem across
           the linkId GSI (which would also need its own <=100-key slicing and
           per-key result stitching). Revisit only if bulk deletes become a hot
           path. Upserts take the same per-op read but there is no cheaper bulk
           form for them either (each reads a different link's full row set). */
        const requests =
          op.operation === "delete"
            ? await this.buildDeleteRequests(op.linkId)
            : await this.buildUpsertRequests(op.linkId);
        results.push({ linkId: op.linkId, ok: true });
        for (const request of requests) {
          pending.push(request);
          owners.push([index]);
        }
      } catch (err) {
        // Resolution failed (e.g. Postgres read error): this row alone fails.
        results.push({ linkId: op.linkId, ok: false, error: err });
      }
    }

    /* Flush the coalesced requests in <=25-item batches. A batch that fails
       after its bounded retries fails every op that contributed a request to
       it — those rows are retried on the next drain, exactly as the per-row
       path would have. */
    for (let start = 0; start < pending.length; start += BATCH_LIMIT) {
      const slice = pending.slice(start, start + BATCH_LIMIT);
      const sliceOwners = owners.slice(start, start + BATCH_LIMIT);
      try {
        await this.flush(slice);
      } catch (err) {
        for (const ownerList of sliceOwners) {
          for (const index of ownerList) {
            results[index] = { linkId: results[index]!.linkId, ok: false, error: err };
          }
        }
      }
    }

    return results;
  }

  /* ---- request builders ---- */

  /** Read the link (+ counter, rules, domain) from Postgres and build the
   *  LINK put + the domain-meta put. Returns [] if the link no longer exists
   *  (a delete that raced ahead of this upsert) so the row is marked processed
   *  rather than retried forever. */
  private async buildUpsertRequests(linkId: string): Promise<WriteRequest[]> {
    const [[row], rules] = await Promise.all([
      this.db
        .select({
          link: links,
          domain: domains.domain,
          domainId: domains.id,
          rootRedirect: domains.rootRedirect,
          notFoundRedirect: domains.notFoundRedirect,
          clicks: sql<number>`coalesce(${linkCounters.clicks}, 0)`,
        })
        .from(links)
        .innerJoin(domains, eq(links.domainId, domains.id))
        .leftJoin(linkCounters, eq(linkCounters.linkId, links.id))
        .where(eq(links.id, linkId))
        .limit(1),
      this.db
        .select({ rule: routingRules })
        .from(routingRules)
        .where(eq(routingRules.linkId, linkId))
        .orderBy(routingRules.position),
    ]);

    if (!row) return [];

    const projectedLink: ProjectedLink = {
      id: row.link.id,
      workspaceId: row.link.workspaceId,
      destination: row.link.destination,
      redirectType: row.link.redirectType as ProjectedLink["redirectType"],
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
      /* Point-in-time click count, same source and semantics as the Postgres
         resolver — see the note in @snapurl/database's toLinkItem. */
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

    const projectedDomain: ProjectedDomain = {
      id: row.domainId,
      rootRedirect: row.rootRedirect,
      notFoundRedirect: row.notFoundRedirect,
    };

    const linkItem = toLinkItem(projectedLink, row.domain, row.link.slug);
    const domainItem = toDomainItem(row.domain, projectedDomain);

    /* The domain-meta item is (re)written alongside every link upsert for that
       domain — the simplest way to keep resolveDomain() current without a
       separate outbox stream, and cheap (one extra put per upsert). */
    return [{ PutRequest: { Item: linkItem } }, { PutRequest: { Item: domainItem } }];
  }

  /** Query the GSI for the LINK item(s) with this link id and build deletes.
   *  Returns [] if nothing is projected (already gone) so the row is marked
   *  processed. The domain-meta item is intentionally left in place: it is
   *  keyed by domain, shared by every link on it, and harmless when stale. */
  private async buildDeleteRequests(linkId: string): Promise<WriteRequest[]> {
    const result = await this.client.send(
      new QueryCommand({
        TableName: this.table,
        IndexName: LINK_ID_GSI,
        KeyConditionExpression: "#lid = :lid",
        ExpressionAttributeNames: { "#lid": LINK_ID_ATTR },
        ExpressionAttributeValues: { ":lid": linkId },
      }),
    );
    const items = (result.Items ?? []) as LinkItem[];
    return items.map((item) => ({
      DeleteRequest: { Key: { PK: item.PK, SK: item.SK } },
    }));
  }

  /* ---- flush ---- */

  /** Write a set of requests (already <=25 when called from apply(), split
   *  here when called from the per-row fallback) via BatchWriteCommand,
   *  retrying UnprocessedItems with bounded exponential backoff. */
  private async flush(requests: WriteRequest[]): Promise<void> {
    for (let start = 0; start < requests.length; start += BATCH_LIMIT) {
      await this.flushBatch(requests.slice(start, start + BATCH_LIMIT));
    }
  }

  private async flushBatch(batch: WriteRequest[]): Promise<void> {
    if (batch.length === 0) return;
    let unprocessed: WriteRequest[] = batch;

    for (let attempt = 0; attempt < MAX_BATCH_ATTEMPTS; attempt++) {
      const result = await this.client.send(
        new BatchWriteCommand({ RequestItems: { [this.table]: unprocessed } }),
      );
      const remaining = (result.UnprocessedItems?.[this.table] ?? []) as WriteRequest[];
      if (remaining.length === 0) return;
      unprocessed = remaining;
      // Bounded backoff so a throttled table backs off rather than hot-loops.
      await sleep(2 ** attempt * 50);
    }

    throw new Error(
      `dynamodb: ${unprocessed.length} projection item(s) still unprocessed after ${MAX_BATCH_ATTEMPTS} BatchWrite attempts`,
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

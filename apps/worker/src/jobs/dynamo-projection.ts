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
import type { KvsWriter } from "./kvs-projection.js";

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

/** What an upsert resolves to: the DynamoDB write requests plus, for the #289
 *  edge fast path, the ProjectedLink and its (host, slug) so the KVS writer can
 *  PutKey/DeleteKey it. `edge` is undefined when the link no longer exists (the
 *  requests are then empty too). */
interface UpsertResolution {
  requests: WriteRequest[];
  edge?: { link: ProjectedLink; host: string; slug: string };
}

/** Recover (host, slug) from a LINK item's DynamoDB key. The projection stores
 *  PK = 'd#' + normalised host and SK = 's#' + lowercased slug, so stripping
 *  those prefixes yields exactly the values kvsKey() re-normalises — the KVS
 *  key derived here matches the one the writer used on the corresponding
 *  upsert. Domain-meta keys (SK 'd#meta') are not link keys and are skipped. */
function edgeTargetsOf(requests: WriteRequest[]): Array<{ host: string; slug: string }> {
  const targets: Array<{ host: string; slug: string }> = [];
  for (const request of requests) {
    if (!("DeleteRequest" in request)) continue;
    const { PK, SK } = request.DeleteRequest.Key;
    if (!PK.startsWith("d#") || !SK.startsWith("s#")) continue;
    targets.push({ host: PK.slice(2), slug: SK.slice(2) });
  }
  return targets;
}

/** The minimum a logger must offer so the writer can surface the ACTUAL
 *  DynamoDB error when a batch fails. drainOutbox only records the error's
 *  stringified form in projection_outbox.last_error and counts the failure;
 *  the error's name/message never reached a log line, so a projection that
 *  wrote nothing looked silent even at LOG_LEVEL=debug. A pino logger satisfies
 *  this; it is optional so the per-row unit tests can omit it. */
export interface ProjectionLogger {
  error(obj: Record<string, unknown>, msg: string): void;
}

/** The DynamoDB Key that identifies an item, used to deduplicate coalesced
 *  write requests: two PutRequests (or a Put and a Delete) with the same
 *  {PK, SK} in one BatchWriteCommand make DynamoDB reject the WHOLE request
 *  with "Provided list of item keys contains duplicates". */
function requestKey(request: WriteRequest): string {
  const key = "PutRequest" in request ? request.PutRequest.Item : request.DeleteRequest.Key;
  return `${key.PK}\u0000${key.SK}`;
}

export class DynamoProjection implements ProjectionTarget {
  constructor(
    private readonly db: Database,
    private readonly client: DynamoDBDocumentClient,
    private readonly table: string,
    /** Optional: when present, a resolution or flush failure logs the ACTUAL
     *  error (name + message) at error level so a failed projection is never
     *  silent again. */
    private readonly log?: ProjectionLogger,
    /** Optional CloudFront KeyValueStore writer (#289). Present ONLY on the AWS
     *  profile when LINK_PROJECTION_KVS_ARN is set; undefined everywhere else,
     *  so NoProjection and the non-KVS AWS path make ZERO KVS calls and behave
     *  byte-for-byte as before. When present, each upsert also projects the
     *  link to the edge fast path (PutKey if edge-eligible, DeleteKey if not)
     *  and each remove DeleteKeys it. The DynamoDB item is ALWAYS written first
     *  so a KVS-only failure never loses the authoritative DynamoDB projection;
     *  a KVS failure then fails the outbox row so the next drain retries it. */
    private readonly kvs?: KvsWriter,
  ) {}

  /* ---- per-row fallback (used when drainOutbox does not batch) ---- */

  async upsert(linkId: string): Promise<void> {
    const resolved = await this.buildUpsertRequests(linkId);
    // DynamoDB first: the authoritative projection must never be lost to a
    // KVS-only failure.
    await this.flush(resolved.requests);
    if (this.kvs && resolved.edge) {
      await this.kvs.putIfEligible(resolved.edge.link, resolved.edge.host, resolved.edge.slug);
    }
  }

  async remove(linkId: string): Promise<void> {
    const requests = await this.buildDeleteRequests(linkId);
    await this.flush(requests);
    if (this.kvs) {
      for (const { host, slug } of edgeTargetsOf(requests)) {
        await this.kvs.deleteKey(host, slug);
      }
    }
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
    /* The coalesced write requests, DEDUPLICATED by DynamoDB Key. Every link
       upsert on a domain (re)writes that domain's single meta item, so a batch
       of N upserts on one domain produces N IDENTICAL domain-meta PutRequests.
       DynamoDB's BatchWriteItem rejects the ENTIRE request with a
       ValidationException ("Provided list of item keys contains duplicates") if
       any two operations target the same key — so without this dedup one
       domain's N links all fail together, which is exactly the
       "domain-meta succeeds, every LINK item fails" the smoke job hit: the
       per-row upsert() path only ever has one meta put per flush, but the
       batched path coalesced N of them into one command.

       Deduping keeps the LAST request written for a key (upserts are
       idempotent, so any of the identical meta puts is equivalent) and unions
       the owning result-indices, so a flush failure still fails every op that
       contributed that key. */
    const byKey = new Map<string, { request: WriteRequest; owners: Set<number> }>();

    /* Per-op KVS work, keyed by result index, applied ONLY after the op's
       DynamoDB requests have flushed successfully (DynamoDB first: a KVS-only
       failure must never lose the authoritative projection). undefined for any
       op when no KvsWriter is configured, so the non-KVS path is unchanged. */
    const edgeByIndex = new Map<number, () => Promise<void>>();

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
        let requests: WriteRequest[];
        if (op.operation === "delete") {
          requests = await this.buildDeleteRequests(op.linkId);
          if (this.kvs) {
            const targets = edgeTargetsOf(requests);
            const kvs = this.kvs;
            edgeByIndex.set(index, async () => {
              for (const { host, slug } of targets) await kvs.deleteKey(host, slug);
            });
          }
        } else {
          const resolved = await this.buildUpsertRequests(op.linkId);
          requests = resolved.requests;
          if (this.kvs && resolved.edge) {
            const kvs = this.kvs;
            const { link, host, slug } = resolved.edge;
            edgeByIndex.set(index, () => kvs.putIfEligible(link, host, slug));
          }
        }
        results.push({ linkId: op.linkId, ok: true });
        for (const request of requests) {
          const key = requestKey(request);
          const existing = byKey.get(key);
          if (existing) {
            existing.request = request;
            existing.owners.add(index);
          } else {
            byKey.set(key, { request, owners: new Set([index]) });
          }
        }
      } catch (err) {
        // Resolution failed (e.g. Postgres read error): this row alone fails.
        this.log?.error(
          { err: serialiseError(err), linkId: op.linkId, operation: op.operation },
          "projection resolve failed",
        );
        results.push({ linkId: op.linkId, ok: false, error: err });
      }
    }

    const pending = [...byKey.values()].map((entry) => entry.request);
    const owners = [...byKey.values()].map((entry) => [...entry.owners]);

    /* Flush the coalesced (and deduped) requests in <=25-item batches. A batch
       that fails after its bounded retries fails every op that contributed a
       request to it — those rows are retried on the next drain, exactly as the
       per-row path would have. */
    for (let start = 0; start < pending.length; start += BATCH_LIMIT) {
      const slice = pending.slice(start, start + BATCH_LIMIT);
      const sliceOwners = owners.slice(start, start + BATCH_LIMIT);
      try {
        await this.flush(slice);
      } catch (err) {
        /* Surface the ACTUAL DynamoDB error (name + message) at error level.
           drainOutbox only stores String(err) in last_error and counts the
           failure, so before this the ValidationException text never reached a
           log line and the empty projection looked silent even at debug. */
        this.log?.error(
          {
            err: serialiseError(err),
            table: this.table,
            items: slice.length,
            linkIds: [...new Set(sliceOwners.flat().map((i) => results[i]!.linkId))],
          },
          "projection batch write failed",
        );
        for (const ownerList of sliceOwners) {
          for (const index of ownerList) {
            results[index] = { linkId: results[index]!.linkId, ok: false, error: err };
          }
        }
      }
    }

    /* #289 edge fast path: drive the KVS writer per-op, but ONLY for ops whose
       DynamoDB write has already succeeded (DynamoDB first — a KVS-only failure
       must never lose the authoritative projection). A KVS write failure marks
       that row failed so the outbox retries it on the next drain, exactly as a
       DynamoDB failure would; it does not touch any other row. No-op when no
       KvsWriter is configured (edgeByIndex is empty), so the non-KVS path is
       byte-for-byte unchanged. */
    for (const [index, run] of edgeByIndex) {
      const result = results[index]!;
      if (!result.ok) continue; // DynamoDB write for this op failed; skip KVS.
      try {
        await run();
      } catch (err) {
        this.log?.error(
          { err: serialiseError(err), linkId: result.linkId },
          "projection KVS write failed",
        );
        results[index] = { linkId: result.linkId, ok: false, error: err };
      }
    }

    return results;
  }

  /* ---- request builders ---- */

  /** Read the link (+ counter, rules, domain) from Postgres and build the
   *  LINK put + the domain-meta put. Returns [] if the link no longer exists
   *  (a delete that raced ahead of this upsert) so the row is marked processed
   *  rather than retried forever. */
  private async buildUpsertRequests(linkId: string): Promise<UpsertResolution> {
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

    if (!row) return { requests: [] };

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
    return {
      requests: [{ PutRequest: { Item: linkItem } }, { PutRequest: { Item: domainItem } }],
      edge: { link: projectedLink, host: row.domain, slug: row.link.slug },
    };
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

/** Reduce an unknown thrown value to the fields worth logging. A DynamoDB
 *  ValidationException carries its diagnosis in `name` + `message` (e.g.
 *  "ValidationException: Provided list of item keys contains duplicates"); a
 *  plain object logged as `{ err }` under pino can serialise to `{}` and hide
 *  exactly that text, which is how the batched projection failure stayed
 *  invisible. Pull the useful fields out explicitly. */
function serialiseError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return { name: err.name, message: err.message };
  }
  return { value: String(err) };
}

import { sql, type Database } from "@snapurl/database";
import { linkCacheKey, type CacheStore } from "@snapurl/cache";

/* ============================================================
   Draining the projection outbox.

   The API writes a link and an outbox row in the same
   transaction. This job reads the outbox and pushes each change
   into the DynamoDB projection the redirect path reads.

   The point of the outbox is that the two writes cannot diverge
   silently: if DynamoDB is unavailable, the row stays unprocessed
   and is retried, rather than the edge quietly serving a
   destination the dashboard says was changed an hour ago.

   With LINK_PROJECTION=none (local dev, self-hosting on one
   Postgres) rows are marked processed immediately — there is no
   second store to keep in sync, because the redirect reads
   Postgres directly.

   Claim / lease lifecycle
   -----------------------
   Two worker instances can run at once (EventBridge sets
   retryAttempts: 2 and reserved concurrency allows a second
   invocation), so the drain must guarantee a row is handled by
   at most one worker at a time. It does that with a single atomic
   claim statement: an UPDATE that stamps claimed_at = now() on the
   rows returned by an inner SELECT ... FOR UPDATE SKIP LOCKED. The
   whole UPDATE runs in one implicit transaction, so the row locks
   are held for the entire statement and a concurrent worker's
   SKIP LOCKED skips the just-claimed rows rather than picking them
   up too.

   Claiming and processing are deliberately NOT in one long
   transaction: target.upsert/remove may become a DynamoDB network
   call, and holding row locks across network I/O is how a slow
   dependency turns into lock pile-ups. So the claim commits, then
   each row is processed and marked on its own.

   A crashed worker leaves claimed_at set with processed_at still
   null. The stale-lease reclaim (claimed_at older than CLAIM_LEASE)
   makes those rows claimable again, so a dead worker cannot strand
   them. On success the row's processed_at is stamped (the claim
   filters on processed_at is null, so leaving claimed_at set is
   harmless). On failure attempts is bumped, last_error recorded,
   and claimed_at cleared so the row is retryable on the next drain
   without waiting out the lease. A row at MAX_ATTEMPTS is never
   claimed again — it is a real alert that the edge is stale.

   Cache invalidation on delete (#470)
   ------------------------------------
   A "delete" row also busts the redirect's hot-link cache, two ways at once:

     1. CacheStore.del() on whatever CacheStore this call was given — reaches
        the redirect ONLY when CACHE_DRIVER is 'redis' or 'dynamodb', i.e. a
        store genuinely shared across processes.
     2. pg_notify('link_cache_bust', ...) — reaches the redirect ALWAYS
        (every profile that gives the redirect a Postgres connection, i.e.
        every profile except LINK_PROJECTION=dynamo), because NOTIFY is a
        Postgres server-side broadcast, not a shared application store. This
        is what closes the gap CacheStore.del() cannot: under CACHE_DRIVER=
        memory (the flagship single-node/compose profile) the api, worker and
        redirect each hold their OWN Map, so no application-level store is
        ever actually shared there. See apps/redirect/src/main.ts's init(),
        which opens sql.listen('link_cache_bust', ...) on its own Postgres
        connection and evicts the matching key from ITS OWN CacheStore
        instance on receipt.

   Both are best-effort and never fail the row: the short LINK_CACHE_TTL_SECONDS
   remains the final fallback if a notify or a del() is lost.
   ============================================================ */

/** One claimed outbox row, reduced to what a projection target acts on. */
export interface ProjectionOp {
  linkId: string;
  operation: string;
}

/** The minimum a logger must offer for drainOutbox to surface a cache-bust
 *  failure. Mirrors DynamoProjection's ProjectionLogger (same shape, defined
 *  separately so this file has no dependency on dynamo-projection.ts); a pino
 *  logger satisfies it, and it is optional so every existing call site and
 *  unit test that does not care about cache invalidation keeps compiling. */
export interface OutboxLogger {
  error(obj: Record<string, unknown>, msg: string): void;
}

/** The per-op outcome of a batched apply(): the batch method must report each
 *  op independently so drainOutbox keeps its per-row processed_at / attempts
 *  bookkeeping — one poisonous row must not fail the whole batch's rows. */
export interface ProjectionResult {
  linkId: string;
  ok: boolean;
  error?: unknown;
}

export interface ProjectionTarget {
  upsert(linkId: string): Promise<void>;
  remove(linkId: string): Promise<void>;
  /* Optional batch entry point. When a target implements it, drainOutbox hands
     it the whole claimed batch so the target can coalesce its writes (e.g. a
     DynamoDB projection batches into <=25-item BatchWrites — a 100-link import
     is O(N/25) round trips, not 100). A target without it (NoProjection) keeps
     the per-row upsert/remove path, so the default no-op behaviour is
     unchanged. The result array MUST carry one entry per input op, in order. */
  apply?(ops: ProjectionOp[]): Promise<ProjectionResult[]>;
}

/** The no-op target: the redirect reads Postgres, so there is nothing to
 *  project. Deliberately does NOT implement apply(), so drainOutbox uses the
 *  per-row path and its behaviour is byte-for-byte what it was before batching
 *  existed. This is the default under LINK_PROJECTION=none. */
export class NoProjection implements ProjectionTarget {
  async upsert(): Promise<void> {}
  async remove(): Promise<void> {}
}

const MAX_ATTEMPTS = 8;

/* How long a claim is trusted before another worker may reclaim it. Long
   enough that a healthy worker always finishes a batch of network upserts
   inside it; short enough that a crashed worker's rows come back promptly. */
const CLAIM_LEASE = sql`interval '5 minutes'`;

/** The subset of an outbox row's jsonb payload drainOutbox looks at itself,
 *  independent of whatever a given ProjectionTarget reads from it. Optional
 *  because only LinksService.remove() (#470) currently populates host/slug —
 *  upsert rows carry no cache-invalidation payload yet (see #426's
 *  edit-invalidation half). */
interface OutboxPayload {
  host?: string;
  slug?: string;
}

export async function drainOutbox(
  db: Database,
  target: ProjectionTarget,
  batchSize = 200,
  // #470: the SAME CacheStore the redirect's CachingLinkResolver reads
  // (shared only when CACHE_DRIVER is 'redis' or 'dynamodb' — see the
  // per-row bust below). Optional and defaults to undefined so every
  // existing caller/test that only cares about the projection target keeps
  // compiling and behaving exactly as before; passing one is what turns the
  // bust on.
  cache?: CacheStore,
  /** Optional: logs a cache-bust failure at error level instead of it being
   *  silently swallowed. Omit in tests that do not pass a cache either. */
  log?: OutboxLogger,
): Promise<{ processed: number; failed: number }> {
  /* Atomic claim. The inner SELECT ... FOR UPDATE SKIP LOCKED runs inside the
     implicit transaction of this single UPDATE, so the row locks are held for
     the whole statement and claimed_at is stamped before they release — a
     concurrent worker's SKIP LOCKED skips these rows instead of claiming them
     too. The stale-lease clause reclaims rows a crashed worker left claimed
     (claimed_at set, processed_at null) once the lease expires. */
  const rows = (await db.execute(sql`
    update projection_outbox set claimed_at = now()
    where id in (
      select id from projection_outbox
      where processed_at is null and attempts < ${MAX_ATTEMPTS}
        and (claimed_at is null or claimed_at < now() - ${CLAIM_LEASE})
      order by created_at
      limit ${batchSize}
      for update skip locked
    )
    returning id, link_id, operation, attempts, payload
  `)) as unknown as Array<{
    id: string;
    link_id: string;
    operation: string;
    attempts: number;
    payload: OutboxPayload;
  }>;

  let processed = 0;
  let failed = 0;

  /* Mark one claimed row processed (success) or bump its attempts (failure).
     Kept as one helper so the per-row path and the batched path record the
     exact same bookkeeping.

     Success: leaving claimed_at set is fine — the claim filters on
     processed_at is null, and pruneOutbox only looks at processed_at.

     Failure: attempts are recorded so a permanently poisonous row stops being
     retried forever and starts being visible instead. A row at MAX_ATTEMPTS is
     a real alert: the edge is serving stale config. claimed_at is cleared so
     the row is retryable on the next drain rather than waiting out the lease. */
  const markProcessed = async (id: string) => {
    await db.execute(sql`update projection_outbox set processed_at = now() where id = ${id}::uuid`);
    processed++;
  };
  const markFailed = async (id: string, err: unknown) => {
    failed++;
    await db.execute(sql`
      update projection_outbox
      set attempts = attempts + 1, last_error = ${String(err).slice(0, 500)}, claimed_at = null
      where id = ${id}::uuid
    `);
  };

  /* #470: bust the hot-link cache for every claimed "delete" row, up front and
     independent of how the ProjectionTarget below fares. This is deliberately
     NOT gated on target upsert/remove/apply success: the cache entry and the
     DynamoDB projection are two different stores serving two different
     readers (CachingLinkResolver vs. DynamoLinkResolver), and a projection
     failure being retried on the next drain is no reason to leave a deleted
     link's redirect cache entry warm in the meantime. A row missing host/slug
     in its payload (upsert rows never carry it; pre-#470 delete rows in an
     in-flight upgrade won't either) is silently skipped — nothing to bust,
     and the short TTL is exactly the pre-#470 fallback for that case. A
     del() failure (Redis/DynamoDB unavailable) is logged and swallowed:
     losing the bust for one row must not fail the whole batch's bookkeeping,
     the same isolation principle the target/markFailed split already uses.

     A SEPARATE pg_notify fires alongside the CacheStore.del() above (not
     instead of it) for exactly the memory driver's blind spot: CACHE_DRIVER=
     memory (the flagship single-node/compose profile) gives every process —
     api, worker, redirect — its OWN Map, so this process's cache.del() above
     only ever clears the worker's private Map and can never reach the
     redirect's. NOTIFY has no such boundary: it is a Postgres server-side
     broadcast to every session that has LISTENed on the channel, regardless
     of which process opened that session, and the redirect already holds a
     Postgres connection in every profile except LINK_PROJECTION=dynamo (see
     apps/redirect/src/main.ts's init(), which opens sql.listen() on that same
     connection). This is NOT gated on `cache` being passed: a caller with no
     CacheStore (redis/dynamodb profiles pass one; the AWS profile does not,
     because there is no Postgres connection on that path for the redirect to
     listen from — LINK_PROJECTION=dynamo) simply notifies nobody, which costs
     nothing. Failure is logged and swallowed for the same reason as the
     cache.del() above: a lost notification is not a reason to fail the row —
     the short TTL remains the final fallback. */
  for (const row of rows) {
    if (row.operation !== "delete") continue;
    const { host, slug } = row.payload ?? {};
    if (!host || !slug) continue;
    try {
      await db.execute(sql`select pg_notify('link_cache_bust', ${JSON.stringify({ host, slug })})`);
    } catch (err) {
      log?.error({ err, linkId: row.link_id }, "cache-bust notify failed for a deleted link");
    }
    if (!cache) continue;
    try {
      await cache.del(linkCacheKey(host, slug));
    } catch (err) {
      log?.error({ err, linkId: row.link_id }, "cache bust failed for a deleted link");
    }
  }

  /* Processed outside any long transaction: the projection write may be a
     DynamoDB network call, and each row is marked on its own so a slow or
     failing dependency never holds locks across I/O. */
  if (target.apply) {
    /* Batched path: hand the whole claimed batch to the target so it can
       coalesce its writes (a DynamoDB target batches into <=25-item
       BatchWrites). The result carries one entry per op, in order, so each
       row's processed_at / attempts bookkeeping is still recorded per row —
       one poisonous row fails alone, exactly as the per-row path does. */
    let results: ProjectionResult[];
    try {
      results = await target.apply(rows.map((r) => ({ linkId: r.link_id, operation: r.operation })));
    } catch (err) {
      /* apply() itself threw (not a per-op failure): fail every claimed row so
         the whole batch is retried on the next drain. */
      for (const row of rows) await markFailed(row.id, err);
      return { processed, failed };
    }
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      const result = results[i];
      if (result && result.ok) await markProcessed(row.id);
      else await markFailed(row.id, result?.error ?? new Error("projection apply() returned no result for row"));
    }
    return { processed, failed };
  }

  for (const row of rows) {
    try {
      if (row.operation === "delete") await target.remove(row.link_id);
      else await target.upsert(row.link_id);
      await markProcessed(row.id);
    } catch (err) {
      await markFailed(row.id, err);
    }
  }

  return { processed, failed };
}

/** Rows that have given up. Nobody sees these unless something asks. */
export async function stuckProjections(db: Database): Promise<number> {
  const result = (await db.execute(sql`
    select count(*)::int as n from projection_outbox
    where processed_at is null and attempts >= ${MAX_ATTEMPTS}
  `)) as unknown as [{ n: number }];
  return result[0]?.n ?? 0;
}

/** Processed rows are kept a day for debugging, then dropped. */
export async function pruneOutbox(db: Database): Promise<number> {
  const result = (await db.execute(sql`
    with dropped as (
      delete from projection_outbox
      where processed_at is not null and processed_at < now() - interval '1 day'
      returning 1
    )
    select count(*)::int as n from dropped
  `)) as unknown as [{ n: number }];
  return result[0]?.n ?? 0;
}

/**
 * Move links past their expiry into the state the UI already derives.
 *
 * deriveStatus computes "expired" on read, so this changes no displayed value.
 * What it does is re-project the link so the *edge* stops sending traffic to a
 * destination whose owner expected it to stop — the gap between "the dashboard
 * says expired" and "the redirect still works" is the one that matters.
 */
export async function sweepExpired(db: Database): Promise<number> {
  const result = (await db.execute(sql`
    with newly_expired as (
      select l.id
      from links l
      left join link_counters lc on lc.link_id = l.id
      where l.archived_at is null
        and (
          (l.expires_at is not null and l.expires_at <= now())
          or (l.click_limit is not null and coalesce(lc.clicks, 0) >= l.click_limit)
        )
        and not exists (
          select 1 from projection_outbox o
          where o.link_id = l.id and o.processed_at is null
        )
    ), queued as (
      insert into projection_outbox (link_id, operation, payload)
      select id, 'upsert', jsonb_build_object('linkId', id, 'operation', 'upsert', 'reason', 'expiry')
      from newly_expired
      returning 1
    )
    select count(*)::int as n from queued
  `)) as unknown as [{ n: number }];
  return result[0]?.n ?? 0;
}

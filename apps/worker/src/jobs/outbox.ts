import { DOMAIN_OP, sql, type Database } from "@snapurl/database";

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
   ============================================================ */

/** One claimed outbox row, reduced to what a projection target acts on. */
export interface ProjectionOp {
  /** The link id — or, for operation DOMAIN_OP ('domain'), the DOMAIN id
   *  (see domainProjectionOp in @snapurl/database). */
  linkId: string;
  operation: string;
  /** Only on a domain op: the host, from the row's payload, so the meta item's
   *  key can be built even when the domain row is already gone. */
  host?: string;
}

/** Map one claimed outbox row to the op a target acts on. */
export function toProjectionOp(row: { link_id: string; operation: string; payload?: unknown }): ProjectionOp {
  const op: ProjectionOp = { linkId: row.link_id, operation: row.operation };
  if (row.operation === DOMAIN_OP) {
    const host = (row.payload as { host?: unknown } | null | undefined)?.host;
    if (typeof host === "string") op.host = host;
  }
  return op;
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
  /** A domain op (#711 review, Blocker-1): re-project or drop the domain's
   *  meta item. Optional — NoProjection has nothing to project. */
  projectDomain?(domainId: string, host: string | undefined): Promise<void>;
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

export async function drainOutbox(
  db: Database,
  target: ProjectionTarget,
  batchSize = 200,
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
    returning id, link_id, operation, payload, attempts
  `)) as unknown as Array<{ id: string; link_id: string; operation: string; payload: unknown; attempts: number }>;

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
      results = await target.apply(rows.map(toProjectionOp));
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
      const op = toProjectionOp(row);
      if (op.operation === DOMAIN_OP) await target.projectDomain?.(op.linkId, op.host);
      else if (op.operation === "delete") await target.remove(op.linkId);
      else await target.upsert(op.linkId);
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

/**
 * One-off backfill of DOMAIN-META items (#713 item 5).
 *
 * Under LINK_PROJECTION=dynamo a domain's meta item used to be written only as
 * a side effect of a LINK upsert, so a live domain whose root / 404 redirect
 * was set before domain ops existed (#711) — and which has no links, or whose
 * domain op an older worker silently dropped (see below) — has no meta item
 * at all, and the redirect service serves 404 for its root and missing slugs
 * while the dashboard shows the redirects as set.
 *
 * This enqueues one domain op (the exact shape the API enqueues, via
 * domainProjectionOp's payload) for every LIVE domain with a redirect set. The
 * drain then projects each from its row. Only `status = 'live'` domains are
 * enqueued — the #719 live-gate means a non-live domain's meta never serves
 * anything, so there is nothing to backfill for one.
 *
 * Idempotent, modelled on sweepExpired: a domain that already has an
 * unprocessed op is skipped, so re-running it (or running it while a drain is
 * in flight) never piles up duplicates, and applying a domain op twice writes
 * the same item. Safe under LINK_PROJECTION=none too: NoProjection marks the
 * rows processed with no side effects.
 *
 * #729 item 2: "already has an unprocessed op" means a LIVE one — `attempts <
 * MAX_ATTEMPTS`. A row that already hit MAX_ATTEMPTS is dead-lettered and will
 * NEVER be retried by the drain (its claim query filters on the same bound), so
 * treating it as "pending" would permanently skip exactly the domains whose
 * projection is broken and most need the backfill. Enqueuing a fresh op for
 * such a domain is correct: it is a new row at attempts 0 that the drain WILL
 * process, and the stale dead-lettered row is pruned once nothing references it.
 *
 * Invoke once, after deploying: `{ "task": "backfill-domain-meta" }` on the
 * worker Lambda (or `--backfill-domain-meta` on the long-running worker).
 *
 * DEPLOY ORDER — WORKER FIRST. A worker older than #711 does not know the
 * 'domain' operation: its per-row path treats the op as a link upsert of the
 * domain id, finds no such link and marks the row PROCESSED — the op is
 * dropped, not retried. So the worker must be running this version (domain-op
 * aware, with the #713 conditional meta writes) before the API that enqueues
 * domain ops, and before this backfill is invoked; otherwise the backfill's
 * ops (and any redirect edit made during the rollout) can be consumed by an
 * old instance and silently lost. If that happens, deploying the worker and
 * re-running this backfill repairs it.
 */
export async function backfillDomainMeta(db: Database): Promise<number> {
  const result = (await db.execute(sql`
    with candidates as (
      select d.id, d.domain
      from domains d
      where d.status = 'live'
        and (d.root_redirect is not null or d.not_found_redirect is not null)
        and not exists (
          select 1 from projection_outbox o
          where o.link_id = d.id and o.processed_at is null
            and o.attempts < ${MAX_ATTEMPTS}
        )
    ), queued as (
      insert into projection_outbox (link_id, operation, payload)
      select id, ${DOMAIN_OP},
             jsonb_build_object('domainId', id, 'host', lower(trim(domain)), 'operation', ${DOMAIN_OP}::text, 'reason', 'backfill')
      from candidates
      returning 1
    )
    select count(*)::int as n from queued
  `)) as unknown as [{ n: number }];
  return result[0]?.n ?? 0;
}

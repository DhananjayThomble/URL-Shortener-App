import { sql, type Database } from "@snapurl/database";

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
   ============================================================ */

export interface ProjectionTarget {
  upsert(linkId: string): Promise<void>;
  remove(linkId: string): Promise<void>;
}

/** The no-op target: the redirect reads Postgres, so there is nothing to project. */
export class NoProjection implements ProjectionTarget {
  async upsert(): Promise<void> {}
  async remove(): Promise<void> {}
}

const MAX_ATTEMPTS = 8;

export async function drainOutbox(
  db: Database,
  target: ProjectionTarget,
  batchSize = 200,
): Promise<{ processed: number; failed: number }> {
  const rows = (await db.execute(sql`
    select id, link_id, operation, attempts
    from projection_outbox
    where processed_at is null and attempts < ${MAX_ATTEMPTS}
    order by created_at
    limit ${batchSize}
    for update skip locked
  `)) as unknown as Array<{ id: string; link_id: string; operation: string; attempts: number }>;

  let processed = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      if (row.operation === "delete") await target.remove(row.link_id);
      else await target.upsert(row.link_id);

      await db.execute(sql`update projection_outbox set processed_at = now() where id = ${row.id}::uuid`);
      processed++;
    } catch (err) {
      /* Attempts are recorded so a permanently poisonous row stops being
         retried forever and starts being visible instead. A row at
         MAX_ATTEMPTS is a real alert: the edge is serving stale config. */
      failed++;
      await db.execute(sql`
        update projection_outbox
        set attempts = attempts + 1, last_error = ${String(err).slice(0, 500)}
        where id = ${row.id}::uuid
      `);
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

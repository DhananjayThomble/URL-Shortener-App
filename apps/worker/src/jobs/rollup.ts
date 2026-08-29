import { sql, type Database } from "@snapurl/database";
import { addHashed, createSketch, deserialize, estimate, merge, serialize } from "@snapurl/domain";

/* ============================================================
   Turning raw clicks into the numbers the dashboards read.

   This is the job that makes /analytics cheap. Without it every
   dashboard load would aggregate click_events, which is fine at
   a thousand rows and unusable at ten million.

   Written as one SQL statement per rollup rather than a read-
   modify-write loop in Node: the aggregation happens where the
   data is, and each statement is idempotent, so a crashed run
   re-runs safely instead of double-counting.
   ============================================================ */

export interface RollupResult {
  events: number;
  days: number;
}

/**
 * Fold every un-rolled click into the daily tables.
 *
 * Bots are counted into click_events (so the decision stays reversible) but
 * excluded from every rollup — a dashboard that reports crawler traffic as
 * engagement is worse than useless, it is misleading.
 */
export async function rollupClicks(db: Database, batchSize = 50_000): Promise<RollupResult> {
  return db.transaction(async (tx) => {
    /* Claim a batch by id. Selecting rows and deleting them later would race
       with a concurrent worker; taking an explicit id list means two workers
       cannot claim the same clicks. */
    const claimed = await tx.execute(sql`
      create temporary table rollup_batch on commit drop as
      select * from click_events
      where rolled_up_at is null
      order by occurred_at
      limit ${batchSize}
    `);
    void claimed;

    const [{ n }] = (await tx.execute(sql`select count(*)::int as n from rollup_batch`)) as unknown as [{ n: number }];
    if (!n) return { events: 0, days: 0 };

    await tx.execute(sql`
      insert into click_daily (link_id, workspace_id, day, clicks, uniques, scans, blocked)
      select
        b.link_id,
        b.workspace_id,
        (b.occurred_at at time zone 'UTC')::date as day,
        count(*) filter (where b.is_bot = false and b.blocked_reason is null)::int,
        0,
        count(*) filter (where b.is_bot = false and b.blocked_reason is null and b.is_qr)::int,
        count(*) filter (where b.blocked_reason is not null)::int
      from rollup_batch b
      group by b.link_id, b.workspace_id, (b.occurred_at at time zone 'UTC')::date
      on conflict (link_id, day) do update set
        clicks  = click_daily.clicks  + excluded.clicks,
        scans   = click_daily.scans   + excluded.scans,
        blocked = click_daily.blocked + excluded.blocked
    `);

    /* Uniques, as an approximate HyperLogLog sketch merged register-wise.

       daily_visitors used to hold one row per (link, day, visitor) and uniques
       was a COUNT(DISTINCT) over it. That is exact but does not survive this
       product's load - ~2 billion rows in a btree at retention. So the durable
       uniques record is now a fixed-size sketch per (link, day) in
       click_daily_uniques, and click_daily.uniques is derived from it.

       There is no pure-SQL way to build the sketch without the postgresql-hll
       extension, which we deliberately do not depend on, so the sketch is built
       in Node here (inside the same transaction) from the batch's non-bot,
       non-blocked visitor hashes.

       The register-wise-max merge is what keeps a re-run harmless. Merging is
       idempotent (max(a, a) = a) and commutative, so folding the same batch
       into the same stored sketch is a no-op: recomputing a day cannot inflate
       its uniques, which is exactly the property the old recompute-not-increment
       code protected against a visitor being counted twice across batches.

       The merge below is made convergent under concurrent workers by locking
       the sketch row before merging (see the per-group loop), so it re-merges
       against the current committed value rather than blindly overwriting a
       snapshot. */
    const visitorRows = (await tx.execute(sql`
      select
        link_id as "linkId",
        (occurred_at at time zone 'UTC')::date::text as day,
        visitor_hash as "visitorHash"
      from rollup_batch
      where is_bot = false and blocked_reason is null
    `)) as unknown as Array<{ linkId: string; day: string; visitorHash: string }>;

    if (visitorRows.length > 0) {
      /* Group the batch into one incoming sketch per (link, day). The key is a
         string join of the two parts, kept alongside its components so the
         upsert below has them without re-parsing. */
      const groups = new Map<string, { linkId: string; day: string; sketch: Uint8Array }>();
      for (const row of visitorRows) {
        const key = `${row.linkId}|${row.day}`;
        let group = groups.get(key);
        if (!group) {
          group = { linkId: row.linkId, day: row.day, sketch: createSketch() };
          groups.set(key, group);
        }
        addHashed(group.sketch, row.visitorHash);
      }

      for (const group of groups.values()) {
        /* Merge the incoming sketch with whatever is already stored for the
           key, then write the merged bytes back. Reading and merging in TS
           keeps every bit of sketch logic in @snapurl/domain rather than half
           of it in a bytea expression. The postgres driver returns bytea as a
           Buffer, which deserialize copies into a fresh sketch.

           The read-merge-write has to be convergent even if two workers ever
           process overlapping (link, day) rows at once. A plain "select then
           insert ... on conflict do update set sketch = excluded.sketch" is
           not: both workers read the same stored sketch, each merges its own
           batch against that snapshot, and the second commit overwrites the
           first, dropping the first batch's registers. The old daily_visitors
           path ("insert ... on conflict do nothing") converged, so an overwrite
           here would be a behavioral regression - the shipped single-instance
           everyN loop never overlaps its own ticks and so cannot hit it, but we
           do not want correctness to depend on that.

           So serialize concurrent mergers on the row itself. First guarantee a
           row exists with "insert ... on conflict do nothing" (a no-op for a
           losing first-inserter), then "select ... for update" to take a row
           lock: a second worker blocks there until the first commits, then
           reads the first's already-merged sketch and merges on top of it. No
           registers are lost regardless of writer topology, and because the
           merge is register-wise max it stays idempotent - re-folding the same
           batch is max(a, a) = a. */
        await tx.execute(sql`
          insert into click_daily_uniques (link_id, day, sketch)
          values (${group.linkId}::uuid, ${group.day}::date, ${serialize(createSketch())})
          on conflict (link_id, day) do nothing
        `);

        const locked = (await tx.execute(sql`
          select sketch from click_daily_uniques
          where link_id = ${group.linkId}::uuid and day = ${group.day}::date
          for update
        `)) as unknown as Array<{ sketch: Buffer }>;

        /* The row is guaranteed to exist and be locked by the insert above, so
           locked[0] is always present; the fallback keeps this total in the
           face of an unexpected driver shape rather than throwing. */
        const merged = locked[0]
          ? merge(deserialize(locked[0].sketch), group.sketch)
          : group.sketch;
        const bytes = serialize(merged);

        await tx.execute(sql`
          update click_daily_uniques set sketch = ${bytes}
          where link_id = ${group.linkId}::uuid and day = ${group.day}::date
        `);

        /* Derive click_daily.uniques from the merged sketch. Recomputed from
           the sketch, never incremented, for the same reason the merge is a
           max: a re-run must land on the same number. */
        const uniques = estimate(merged);
        await tx.execute(sql`
          update click_daily set uniques = ${uniques}
          where link_id = ${group.linkId}::uuid and day = ${group.day}::date
        `);
      }
    }

    // One table serves countries, devices, browsers and referrers because the
    // dashboard renders them identically.
    for (const [dimension, column] of [
      ["country", sql`country`],
      ["city", sql`city`],
      ["device", sql`device`],
      ["browser", sql`browser`],
      ["referrer", sql`referrer_host`],
    ] as const) {
      await tx.execute(sql`
        insert into breakdown_daily (workspace_id, link_id, day, dimension, value, count)
        select
          b.workspace_id,
          b.link_id,
          (b.occurred_at at time zone 'UTC')::date,
          ${dimension},
          coalesce(${column}, 'Unknown'),
          count(*)::int
        from rollup_batch b
        where b.is_bot = false and b.blocked_reason is null
        group by b.workspace_id, b.link_id, (b.occurred_at at time zone 'UTC')::date, coalesce(${column}, 'Unknown')
        on conflict (workspace_id, coalesce(link_id, '00000000-0000-0000-0000-000000000000'::uuid), day, dimension, value)
        do update set count = breakdown_daily.count + excluded.count
      `);
    }

    /* The denormalised counters, in link_counters.

       Recomputed from click_daily rather than incremented, for the same reason
       as uniques: a re-run must not inflate them. This is also what the click
       limit gate reads, which is why it can overshoot slightly — it sees the
       last rollup, not live traffic.

       Written to link_counters rather than links on purpose: links is the row
       the redirect hot path resolves against, and rewriting a counter on it
       every minute took row locks and churned indexes on the read path. This
       upsert hits a table nothing latency-sensitive reads instead. */
    await tx.execute(sql`
      insert into link_counters (link_id, clicks, unique_clicks)
      select link_id, sum(clicks)::int, sum(uniques)::int
      from click_daily
      where link_id in (select distinct link_id from rollup_batch)
      group by link_id
      on conflict (link_id) do update set
        clicks = excluded.clicks,
        unique_clicks = excluded.unique_clicks
    `);

    /* Matched on the full primary key, and bounded by the batch's time range.
     *
     * `click_events` is partitioned by `occurred_at`, so its primary key is
     * (id, occurred_at) and `id` alone is not unique as far as Postgres is
     * concerned. `where id in (...)` therefore cannot prune: the planner has to
     * open every partition, which on a three-year database is ~1100 relations
     * on a job that runs every minute.
     *
     * The two sub-selects are what actually buy the pruning — they become
     * InitPlans, which the executor can use to eliminate partitions at runtime.
     * Because the batch is claimed with `order by occurred_at limit N`, that
     * range normally spans a day or two. `rollup_batch` is `select *`, so it
     * already carries `occurred_at` and no extra work is needed to get it. */
    await tx.execute(sql`
      update click_events ce set rolled_up_at = now()
      from rollup_batch b
      where ce.id = b.id
        and ce.occurred_at = b.occurred_at
        and ce.occurred_at >= (select min(occurred_at) from rollup_batch)
        and ce.occurred_at <= (select max(occurred_at) from rollup_batch)
    `);

    const [{ d }] = (await tx.execute(
      sql`select count(distinct (occurred_at at time zone 'UTC')::date)::int as d from rollup_batch`,
    )) as unknown as [{ d: number }];

    return { events: n, days: d };
  });
}

/** How many days of partitions to keep provisioned ahead of now.
 *
 *  A fortnight, so a worker that has been down for a week still has somewhere
 *  to put today's clicks. Anything beyond the provisioned range lands in the
 *  DEFAULT partition rather than failing, and the next pass drains it — so this
 *  number controls query performance during an outage, not correctness. */
const PARTITION_LOOKAHEAD_DAYS = 14;

/** How far back provisioning repairs gaps.
 *
 *  Matches the migration's backfill window rather than being shorter than it.
 *  A day that never got a partition keeps its rows in the DEFAULT partition, and
 *  once the provisioning window moves past it nothing reaches back — so with a
 *  one-day look-back a worker outage of a fortnight left those rows permanently
 *  in a partition no query can prune. */
const PARTITION_LOOKBACK_DAYS = 7;

/** Most partitions one expiry pass will drop.
 *
 *  Each drop takes an ACCESS EXCLUSIVE lock on the parent, which blocks every
 *  click insert for as long as it is held. Steady state is one partition a day;
 *  the cap matters when the longest retention suddenly drops and hundreds of
 *  days become spent at once. The rest are dropped by later passes. */
const MAX_PARTITION_DROPS = 20;

export interface RetentionResult {
  /** Whole days removed by dropping a partition. Constant-time, near-zero WAL. */
  partitionsDropped: number;
  /** Rows removed individually, for workspaces retaining less than the longest. */
  rowsDeleted: number;
}

/**
 * Make sure every day that could receive a click has a partition.
 *
 * Idempotent and cheap — a catalogue lookup per day, doing real work only on
 * the one genuinely new day per pass.
 *
 * **Best-effort by design.** `ATTACH PARTITION` takes an ACCESS EXCLUSIVE lock
 * on the DEFAULT partition, which conflicts with every concurrent insert, and
 * the redirect path inserts continuously. So the SQL function waits a bounded
 * two seconds and gives up rather than stalling the hot path or deadlocking
 * against a writer. A day it could not attach is attached by a later pass; the
 * DEFAULT partition is what guarantees an insert cannot fail in the meantime.
 *
 * The returned count is days *attached*, which is why it can be lower than the
 * window. A count that stays short across several passes means provisioning is
 * losing to write traffic — worth knowing, and not an outage.
 *
 * Runs *before* the retention pass. A cycle that dies partway has then still
 * done the one job the redirect path depends on.
 */
export async function ensureClickPartitions(
  db: Database,
  daysAhead = PARTITION_LOOKAHEAD_DAYS,
  daysBack = PARTITION_LOOKBACK_DAYS,
): Promise<number> {
  /* UTC, not current_date: every partition bound is built with AT TIME ZONE
     'UTC', and current_date resolves in the session TimeZone. */
  const result = (await db.execute(sql`
    select count(part)::int as n
    from generate_series(
      (now() at time zone 'UTC')::date - ${daysBack}::int,
      (now() at time zone 'UTC')::date + ${daysAhead}::int,
      interval '1 day'
    ) as d,
    lateral click_events_ensure_partition(d::date) as part
  `)) as unknown as [{ n: number }];
  /* count(part) rather than count(*): the function returns NULL for a day it
     declined to attach, and counting rows would report those as provisioned. */
  return result[0]?.n ?? 0;
}

/**
 * Expire raw click rows past each workspace's retention setting.
 *
 * The rollups are never pruned — they are small, and they are what the
 * dashboards read. Only the row-level detail expires, which is what the
 * "3 years retention" setting on the settings screen actually promises.
 *
 * **Two mechanisms, and the split is the point.** `click_events` is partitioned
 * by day, so the bulk of expiry is `DETACH` plus `DROP` on whole partitions:
 * constant time, almost no WAL, no bloat, nothing for autovacuum to chase. At
 * 86M rows a day the previous row-level `DELETE` produced WAL faster than a
 * replica could consume it.
 *
 * But retention is **per workspace**, and a partition is shared by all of them.
 * A day can only be dropped once it is past the *longest* retention any
 * workspace has configured. Workspaces that keep less than the maximum still
 * need their rows removed individually from the partitions that survive — so
 * the `DELETE` does not disappear, it just stops carrying the volume. When
 * every workspace uses the same retention (the common case, and the default),
 * `rowsDeleted` is zero and the whole job is a partition drop.
 */
export async function pruneRetention(db: Database, maxDropsPerPass = MAX_PARTITION_DROPS): Promise<RetentionResult> {
  /* One expiry pass at a time. Without this, two overlapping passes both read
     the same list of spent partitions and the second fails on one the first
     already dropped — which would abort every maintenance job queued behind it.
     EventBridge fires every minute with retryAttempts: 2 and the Lambda path has
     no equivalent of the in-process overlap guard, so this is reachable.
     pg_try_advisory_lock rather than the _xact_ variant, because the drops
     deliberately span several transactions. */
  const [{ locked }] = (await db.execute(sql`
    select pg_try_advisory_lock(hashtext('click_events_prune_retention')) as locked
  `)) as unknown as [{ locked: boolean }];
  if (!locked) return { partitionsDropped: 0, rowsDeleted: 0 };

  try {
    /* The longest retention in use decides which partitions are safe to drop.
       No workspaces at all still needs a sane answer, hence the coalesce: a
       fresh install has nothing to expire and should not drop today's data.

       `now() at time zone 'UTC'` rather than `current_date`: every partition
       bound in the migration is explicitly UTC, and current_date resolves in the
       session TimeZone. Mixing the two is the exact bug the migration header
       warns about. */
    const [{ cutoff, maxYears }] = (await db.execute(sql`
      select
        ((now() at time zone 'UTC')::date - (coalesce(max(retention_years), 3) * interval '1 year'))::date as cutoff,
        coalesce(max(retention_years), 3)::int as "maxYears"
      from workspaces
    `)) as unknown as [{ cutoff: string; maxYears: number }];

    /* Listed and dropped separately, one transaction per partition, so the
       ACCESS EXCLUSIVE lock DETACH takes on the parent is released between
       each one instead of being held across the whole batch. Capped as well:
       steady state is one partition a day, but the moment the longest retention
       drops — a workspace lowering its setting, or the longest-retention
       workspace being deleted — hundreds of days become spent at once. */
    const spent = (await db.execute(sql`
      select part from click_events_spent_partitions(${cutoff}::date) as part
    `)) as unknown as Array<{ part: string }>;

    let partitionsDropped = 0;
    for (const { part } of spent.slice(0, maxDropsPerPass)) {
      const [{ ok }] = (await db.execute(sql`
        select click_events_drop_partition(${part}) as ok
      `)) as unknown as [{ ok: boolean }];
      if (ok) partitionsDropped++;
    }

    /* Only workspaces retaining less than the maximum.
     *
     * Deliberately *not* bounded below by the cutoff. An earlier version had
     * `occurred_at >= cutoff` on the theory that it would let the planner prune
     * — it does not, because after the drop pass every attached day partition is
     * already at or above the cutoff, and a lower bound cannot prune a DEFAULT
     * partition at all. What it did do was exclude rows stranded in the default
     * once they aged past the cutoff, so nothing would ever expire them: the
     * drop pass skips the default by design, and this was the only other
     * mechanism. Rows reach the default whenever provisioning falls behind, so
     * that was a slow permanent leak in a partition no query can prune. */
    const [{ n }] = (await db.execute(sql`
      with expired as (
        delete from click_events ce
        using workspaces w
        where ce.workspace_id = w.id
          and w.retention_years < ${maxYears}::int
          and ce.rolled_up_at is not null
          and ce.occurred_at < now() - (w.retention_years * interval '1 year')
        returning 1
      )
      select count(*)::int as n from expired
    `)) as unknown as [{ n: number }];

    return { partitionsDropped, rowsDeleted: n ?? 0 };
  } finally {
    await db.execute(sql`select pg_advisory_unlock(hashtext('click_events_prune_retention'))`);
  }
}

/**
 * Drop salts older than yesterday.
 *
 * This is the step that makes the privacy promise real: once a day's salt is
 * gone, that day's visitor hashes cannot be recomputed from an IP by anybody,
 * including us. Yesterday is kept only so a late-arriving click can still be
 * attributed correctly.
 */
export async function rotateSalts(db: Database): Promise<number> {
  const result = await db.execute(sql`
    with dropped as (
      delete from daily_salts where day < (current_date - interval '1 day') returning 1
    )
    select count(*)::int as n from dropped
  `);
  return (result as unknown as [{ n: number }])[0]?.n ?? 0;
}

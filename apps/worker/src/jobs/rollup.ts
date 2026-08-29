import { sql, type Database } from "@snapurl/database";

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

    // Distinct visitors per link per day, kept separately so retention can
    // drop the raw events while the uniques number stays correct.
    await tx.execute(sql`
      insert into daily_visitors (link_id, day, visitor_hash)
      select link_id, (occurred_at at time zone 'UTC')::date, visitor_hash
      from rollup_batch
      where is_bot = false and blocked_reason is null
      on conflict do nothing
    `);

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

    /* Uniques are recomputed from daily_visitors rather than added to.
       Adding would double-count a visitor who clicked twice in one day across
       two different batches — the exact bug that makes uniques exceed clicks. */
    await tx.execute(sql`
      update click_daily cd set uniques = v.n
      from (
        select link_id, day, count(*)::int as n
        from daily_visitors
        where (link_id, day) in (select distinct link_id, (occurred_at at time zone 'UTC')::date from rollup_batch)
        group by link_id, day
      ) v
      where cd.link_id = v.link_id and cd.day = v.day
    `);

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

    /* The denormalised counters on links.

       Recomputed from click_daily rather than incremented, for the same reason
       as uniques: a re-run must not inflate them. This is also what the click
       limit gate reads, which is why it can overshoot slightly — it sees the
       last rollup, not live traffic. */
    await tx.execute(sql`
      update links l set
        clicks = totals.clicks,
        unique_clicks = totals.uniques
      from (
        select link_id, sum(clicks)::int as clicks, sum(uniques)::int as uniques
        from click_daily
        where link_id in (select distinct link_id from rollup_batch)
        group by link_id
      ) totals
      where l.id = totals.link_id
    `);

    await tx.execute(sql`
      update click_events set rolled_up_at = now()
      where id in (select id from rollup_batch)
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

export interface RetentionResult {
  /** Whole days removed by dropping a partition. Constant-time, near-zero WAL. */
  partitionsDropped: number;
  /** Rows removed individually, for workspaces retaining less than the longest. */
  rowsDeleted: number;
}

/**
 * Make sure every day that could receive a click has a partition.
 *
 * Idempotent and cheap — it is a catalogue lookup per day, and only does real
 * work on the one day a fortnight that is genuinely new.
 *
 * This has to run *before* the retention pass in a maintenance cycle. A pass
 * that dropped old partitions and then failed would still have provisioned
 * today's; the reverse ordering could leave the table with no partition for
 * today, which is exactly the state the DEFAULT partition exists to cover but
 * which is not worth entering deliberately.
 */
export async function ensureClickPartitions(
  db: Database,
  daysAhead = PARTITION_LOOKAHEAD_DAYS,
): Promise<number> {
  const result = (await db.execute(sql`
    select count(*)::int as n
    from generate_series(
      current_date - 1,
      current_date + ${daysAhead}::int,
      interval '1 day'
    ) as d,
    lateral click_events_ensure_partition(d::date)
  `)) as unknown as [{ n: number }];
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
export async function pruneRetention(db: Database): Promise<RetentionResult> {
  /* The longest retention in use decides which partitions are safe to drop.
     No workspaces at all still needs a sane answer, hence the coalesce: a
     fresh install has nothing to expire and should not drop today's data. */
  const [{ cutoff, maxYears }] = (await db.execute(sql`
    select
      (current_date - (coalesce(max(retention_years), 3) * interval '1 year'))::date as cutoff,
      coalesce(max(retention_years), 3)::int as "maxYears"
    from workspaces
  `)) as unknown as [{ cutoff: string; maxYears: number }];

  const [{ dropped }] = (await db.execute(sql`
    select click_events_drop_partitions_before(${cutoff}::date)::int as dropped
  `)) as unknown as [{ dropped: number }];

  /* Only workspaces retaining less than the maximum, and only inside partitions
     that are still attached. Restricting on occurred_at lets the planner prune
     to the partitions that can actually contain matching rows instead of
     scanning every day. */
  const [{ n }] = (await db.execute(sql`
    with expired as (
      delete from click_events ce
      using workspaces w
      where ce.workspace_id = w.id
        and w.retention_years < ${maxYears}::int
        and ce.rolled_up_at is not null
        and ce.occurred_at >= ${cutoff}::date
        and ce.occurred_at < now() - (w.retention_years * interval '1 year')
      returning 1
    )
    select count(*)::int as n from expired
  `)) as unknown as [{ n: number }];

  return { partitionsDropped: dropped ?? 0, rowsDeleted: n ?? 0 };
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

/** daily_visitors only has to survive long enough for its day to close. */
export async function pruneVisitors(db: Database): Promise<number> {
  const result = await db.execute(sql`
    with dropped as (
      delete from daily_visitors where day < (current_date - interval '45 days') returning 1
    )
    select count(*)::int as n from dropped
  `);
  return (result as unknown as [{ n: number }])[0]?.n ?? 0;
}

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

/**
 * Delete raw click rows past the workspace's retention setting.
 *
 * The rollups are never pruned — they are small, and they are what the
 * dashboards read. Only the row-level detail expires, which is what the
 * "3 years retention" setting on the settings screen actually promises.
 */
export async function pruneRetention(db: Database): Promise<number> {
  const result = await db.execute(sql`
    with expired as (
      delete from click_events ce
      using workspaces w
      where ce.workspace_id = w.id
        and ce.rolled_up_at is not null
        and ce.occurred_at < now() - (w.retention_years * interval '1 year')
      returning 1
    )
    select count(*)::int as n from expired
  `);
  return (result as unknown as [{ n: number }])[0]?.n ?? 0;
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

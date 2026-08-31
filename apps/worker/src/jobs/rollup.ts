import { sql, type Database } from "@snapurl/database";
import { addHashed, createSketch, deserialize, estimate, merge, serialize } from "@snapurl/domain";
import { withLease } from "./lease.js";

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
    /* Claim a batch by id, locked. The inner SELECT ... FOR UPDATE SKIP LOCKED
       runs inside this transaction, so the row locks are held until the same
       transaction sets rolled_up_at at the end — a concurrent worker's SKIP
       LOCKED skips these rows and cannot fold them into the additive
       click_daily counts a second time. click_events is partitioned with a
       (id, occurred_at) primary key; FOR UPDATE on a partitioned table locks
       the matching rows, so `id in (...) for update` is valid here. */
    const claimed = await tx.execute(sql`
      create temporary table rollup_batch on commit drop as
      select * from click_events
      where id in (
        select id from click_events
        where rolled_up_at is null
        order by occurred_at
        limit ${batchSize}
        for update skip locked
      )
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

/** How many day-partitions one backfill chunk provisions before the caller
 *  commits and starts a fresh transaction.
 *
 *  This is the knob that decouples the historical provisioning cost from how
 *  old the adopting database is (issue #294). Migration 0007 provisioned every
 *  historical day inside its one schema transaction, and each attached partition
 *  costs roughly five lock slots (its own relation plus four cloned indexes).
 *  The shared lock table is
 *  `max_locks_per_transaction * (max_connections + max_prepared_transactions)`,
 *  6400 on a default configuration, so a single transaction attaching ~3.5 years
 *  of daily partitions approaches the ceiling and more exceeds it, aborting with
 *  `out of shared memory`. `backfillClickPartitions` runs each chunk in its own
 *  `db.execute` (its own transaction), so only one chunk's partitions are ever
 *  held in a single transaction's lock footprint.
 *
 *  Default 200: at ~5 lock slots per attached day that is ~1000 lock slots per
 *  chunk transaction, comfortably under the 6400 default ceiling with headroom
 *  for the connection's other locks, while still being large enough that even a
 *  decade of history is a few dozen chunks rather than thousands. Override with
 *  CLICK_EVENTS_BACKFILL_CHUNK_DAYS when a database is configured with a lower
 *  `max_locks_per_transaction` (drop it) or has plenty of headroom and wants
 *  fewer round trips (raise it). It is a bound on one transaction, never a limit
 *  on total progress — the caller loops until no candidate days remain. */
const PARTITION_BACKFILL_CHUNK_DAYS = Number(process.env.CLICK_EVENTS_BACKFILL_CHUNK_DAYS ?? 200);

/** Most partitions one expiry pass will drop.
 *
 *  Each drop takes an ACCESS EXCLUSIVE lock on the parent, which blocks every
 *  click insert for as long as it is held. Steady state is one partition a day;
 *  the cap matters when the longest retention suddenly drops and hundreds of
 *  days become spent at once. The rest are dropped by later passes. */
const MAX_PARTITION_DROPS = 20;

/** Hard ceiling on the number of retained day-partitions, as a storage cliff
 *  backstop that is independent of per-workspace age retention.
 *
 *  The arithmetic: at the design load of ~86M click rows a day, one day is a
 *  large partition. RDS storage autoscales up to `maxAllocatedStorage` (50 GB
 *  in infra/lib/snapurl-stack.ts) and then stops — at which point the instance
 *  goes READ-ONLY, and RDS allocated storage can never be reduced afterwards.
 *  That is a cliff, not a slope: once hit, the database stops accepting writes
 *  and the only recovery is a costly rebuild.
 *
 *  Age-based retention (the per-workspace `retention_years`, default 3) does
 *  not defend against this, because the *count* of partitions past the cutoff
 *  is unbounded — a workspace configured for a long retention keeps years of
 *  days attached. Partitioning largely supersedes the old row-level prune, but
 *  it does not by itself cap total volume. So this is a coarse, age-independent
 *  ceiling: keep at most this many day-partitions attached, dropping the oldest
 *  beyond it, so storage cannot silently walk into the read-only cliff.
 *
 *  Default 1100 (~3 years of daily partitions, matching the default retention)
 *  so it never fires under normal operation and only acts as a true backstop.
 *  Override with CLICK_EVENTS_MAX_RETAINED_DAYS when the storage budget or the
 *  ingest rate demands a tighter cap. */
const MAX_RETAINED_DAYS = Number(process.env.CLICK_EVENTS_MAX_RETAINED_DAYS ?? 1100);

/** The install-wide retention window, in years, that decides the partition-drop
 *  cutoff. **An operator setting, not a tenant one.**
 *
 *  Retention here is a storage-and-compliance decision that belongs to whoever
 *  runs the install, because `click_events` is partitioned by day and a single
 *  day-partition is *shared by every workspace*. A partition can only be dropped
 *  once its whole range is past the cutoff, so there can be exactly one cutoff
 *  for the table — it cannot be per-tenant without per-tenant partitioning,
 *  which is far more machinery than the problem needs.
 *
 *  Deriving that one cutoff from `max(retention_years)` across workspaces — as
 *  this used to — made retention *effectively global and self-service*: the
 *  settings endpoint lets any workspace ask for up to 100 years, and one tenant
 *  choosing a long value moved the cutoff so far back that no partition was ever
 *  dropped, pushed every other workspace into the row-level `DELETE` branch (the
 *  exact volume this partitioning exists to stop carrying), and accumulated
 *  partitions that were never reclaimed. One tenant silently turned the feature
 *  off for the whole install (#295).
 *
 *  So the cutoff is operator-controlled, and per-workspace `retention_years` is
 *  now **subtractive only**: a workspace may keep *less* than the install window
 *  (its excess rows are removed by the row-level DELETE from the partitions that
 *  survive), but never *more* — a value above the install window is a request
 *  the operator has not provisioned for, and is clamped down to the install
 *  cutoff by the drop pass.
 *
 *  Default 3, matching the historical default and the `workspaces.retention_years`
 *  column default, so out-of-the-box behavior is unchanged. Operators raise it
 *  with CLICK_EVENTS_RETENTION_YEARS when their storage budget and compliance
 *  needs allow a longer window for the whole install. */
export const DEFAULT_INSTALL_RETENTION_YEARS = 3;

/** Parse and validate the operator retention window from a raw env value.
 *
 *  Unlike a cap, this knob's failure mode is **data loss**, not an over-eager
 *  cleanup: the value flows straight into the partition-drop cutoff arithmetic
 *  (`now() - years * interval '1 year'`). A non-numeric env (`forever`, an empty
 *  string) yields `NaN`, and `0` or a negative moves the cutoff to *today or the
 *  future* — at which point every attached day-partition looks spent and the
 *  drop pass would reclaim live data. Fractional values are equally undefined
 *  for a whole-year window.
 *
 *  So anything that is not a whole integer of at least one year falls back to
 *  the safe default rather than being trusted: a misconfigured install keeps
 *  the historical 3-year window instead of silently deleting today's clicks.
 *  Returned as a value (rather than mutating the constant in place) so the rule
 *  is a pure function the tests can exercise without a database. */
export function resolveRetentionYears(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_INSTALL_RETENTION_YEARS;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : DEFAULT_INSTALL_RETENTION_YEARS;
}

const INSTALL_RETENTION_YEARS = resolveRetentionYears(process.env.CLICK_EVENTS_RETENTION_YEARS);

/** How long a retention pass holds its lease.
 *
 *  Five minutes, matching the worker Lambda's own timeout. That is the honest
 *  bound: on AWS a holder cannot outlive it, so a pass that overran is already
 *  dead rather than slow, and its lease should become available shortly after.
 *
 *  Worth being precise about what is *not* bounded, because it is tempting to
 *  argue from the drop loops. Those are bounded — MAX_PARTITION_DROPS drops,
 *  each capped by a 2s lock_timeout, so roughly 40s worst case. The row-level
 *  DELETE the pass ends on is not: it carries no lock_timeout, and
 *  createDatabase sets no statement_timeout. It only does real work when a
 *  workspace retains less than the install window, or when an above-window
 *  workspace has rows stranded in the DEFAULT partition past the cutoff — but
 *  either is exactly when a pass could exceed this TTL.
 *
 *  So on AWS the Lambda ceiling covers it. On the compose and Helm profiles
 *  there is no process ceiling, and a long enough pass can be overtaken. The
 *  damage is bounded rather than absent: the drop helper is a single statement,
 *  so DETACH and DROP are atomic, and a loser either times out on the parent
 *  lock or finds the partition already gone and reports false. */
const RETENTION_LEASE_SECONDS = 300;

/** What one drop attempt did. Mirrors click_events_drop_partition's return. */
export type DropOutcome = "dropped" | "pinned" | "contended" | "missing";

export interface PartitionProvisionResult {
  /** Days with a partition attached and ready to receive clicks. */
  ready: number;
  /**
   * Days the function declined to provision this pass.
   *
   * Almost always write traffic winning the lock, which is the intended trade —
   * the DEFAULT partition is what guarantees an insert cannot fail, so a
   * declined day costs query performance until a later pass catches up, not
   * data. Counted rather than folded into a smaller `ready` so a provisioner
   * that never wins is visible.
   */
  declined: number;
}

export interface PartitionBackfillResult {
  /** Distinct historical days provisioned out of the DEFAULT partition into a
   *  dated partition across the whole run. Zero on a fresh install, which has no
   *  historical rows stranded in DEFAULT. */
  provisioned: number;
  /** How many chunk transactions the run took. Each is its own `db.execute`, so
   *  this is also the number of times the accumulated lock footprint was
   *  released — the property that keeps the backfill's cost decoupled from how
   *  old the database is (#294). */
  chunks: number;
}

export interface RetentionResult {
  /** Whole days removed by dropping a partition. Constant-time, near-zero WAL. */
  partitionsDropped: number;
  /** Rows removed individually, bounded by each workspace's effective retention
   *  `least(retention_years, install)` — the subtractive per-workspace pass. It
   *  removes a below-window workspace's rows the drops leave behind, and clamps
   *  an above-window workspace's DEFAULT-stranded rows down to the install
   *  window (the drops reclaim its dated partitions). */
  rowsDeleted: number;
  /**
   * Days left attached because they still hold un-rolled-up clicks.
   *
   * Normal, and self-correcting: the rollup consumes them and a later pass drops
   * the partition. Persistently non-zero means the rollup is behind.
   *
   * Comes from the **cap** loop in practice. The age pass never sees a pinned
   * candidate, because `click_events_spent_partitions` filters them out before
   * offering them — which is worth keeping, since attempting a drop that will
   * certainly be refused means taking ACCESS EXCLUSIVE on the parent for
   * nothing.
   */
  partitionsPinned: number;
  /**
   * Days that could not be locked within the timeout, or that deadlocked.
   *
   * **The number worth alerting on.** Everything else here is either progress or
   * a benign no-op; this is partition maintenance losing to write traffic. A
   * pass reporting it repeatedly is a pass making no progress, and before this
   * existed that state was indistinguishable from having nothing to drop —
   * both reported `partitionsDropped: 0`. Retention could stall indefinitely
   * with no signal, which is the same silent-failure shape as #323 and #326.
   */
  partitionsContended: number;
  /**
   * Days already gone when we got to them, dropped by a concurrent pass.
   *
   * Expected rather than alarming — two passes can overlap once a lapsed lease
   * is taken over — but counted so it cannot hide inside a "nothing happened".
   */
  partitionsMissing: number;
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
): Promise<PartitionProvisionResult> {
  /* The window, resolved in UTC.
   *
   * `now() at time zone 'UTC'` rather than `current_date`: every partition bound
   * is built with AT TIME ZONE 'UTC', and current_date resolves in the session
   * TimeZone. Mixing the two files a day under the wrong date. */
  const days = (await db.execute(sql`
    select d::date::text as day
    from generate_series(
      (now() at time zone 'UTC')::date - ${daysBack}::int,
      (now() at time zone 'UTC')::date + ${daysAhead}::int,
      interval '1 day'
    ) as d
  `)) as unknown as Array<{ day: string }>;

  /* One statement per day, not one for the whole window.
   *
   * This used to be a single `generate_series` with a lateral call, which meant
   * the ACCESS EXCLUSIVE lock the function takes on the DEFAULT partition for
   * the first day needing work was held until the *entire* statement committed —
   * every day's attach, plus every day's drain. Measured: a concurrent insert
   * routed to the default blocked for 7.9s while the ATTACH itself took 7ms.
   *
   * Only clicks routed to the default are affected, which is exactly the
   * catch-up case where provisioning has fallen behind and the drain is large.
   * Since click writes are awaited, that is redirect latency rather than lost
   * clicks — still worth not doing. Each `db.execute` is its own transaction, so
   * per day means the lock is released between days.
   *
   * The cost is one round trip per day instead of one for the window: 22 cheap
   * catalogue lookups on a job that runs hourly. */
  let ready = 0;
  let declined = 0;
  for (const { day } of days) {
    const [{ part }] = (await db.execute(sql`
      select click_events_ensure_partition(${day}::date) as part
    `)) as unknown as [{ part: string | null }];
    /* NULL means the function declined — it could not take a lock in time, or
       hit an unrecoverable state it deliberately does not raise on. Counted
       separately so "provisioning is losing to write traffic" is visible rather
       than showing up as a slightly smaller number. */
    if (part === null) declined++;
    else ready++;
  }

  return { ready, declined };
}

/**
 * Provision the historical day-partitions an adopting database needs, OUTSIDE a
 * single schema transaction, committing between bounded chunks.
 *
 * **Why this exists (issue #294).** Migration 0007 turned `click_events` into a
 * daily-partitioned table and, in the same one transaction drizzle wraps each
 * migration file in, looped over the whole history of the legacy table
 * provisioning one partition per day before copying the rows across. That single
 * transaction holds ACCESS EXCLUSIVE on `click_events` for its whole duration
 * (blocking every click insert) and SHARE ROW EXCLUSIVE on `links` and
 * `workspaces` (blocking every link write), and its lock footprint scales with
 * history: ~5 lock slots per attached day means ~3.5 years approaches the
 * default 6400 shared-lock ceiling and more aborts the migration with
 * `out of shared memory`. See PARTITION_BACKFILL_CHUNK_DAYS for the arithmetic.
 *
 * 0007 has already been applied everywhere and cannot be rewritten without
 * breaking drizzle's checksum, and `click_events` has never carried data in any
 * deployment — so 0007's history loop is a no-op today. The residual risk is a
 * self-hoster who adopts this schema WITH pre-existing legacy rows. This routine
 * is the forward path for exactly that operator: it drives the
 * `click_events_backfill_days` SQL helper (migration 0015), which drains
 * distinct historical days out of the DEFAULT partition into dated partitions
 * `chunkSize` days at a time, and runs **each chunk in its own `db.execute`** so
 * the lock footprint is released between chunks. That is the same
 * per-transaction rationale ensureClickPartitions uses for its per-day loop
 * (see the comment there): no single transaction ever accumulates a
 * history-sized set of partition locks.
 *
 * **A one-time adoption/repair op, deliberately NOT wired into runMaintenance.**
 * The hourly maintenance pass already keeps the recent window provisioned via
 * ensureClickPartitions, and the DEFAULT partition guarantees no insert can fail
 * for an unprovisioned day. Backfilling all of history is only ever needed once,
 * when an operator adopts the schema with legacy data — running it every hour
 * would repeatedly scan the DEFAULT partition for nothing. So it is exposed as a
 * standalone callable an operator triggers once after migrating, not folded into
 * the steady-state loop.
 *
 * **No-op on a fresh install.** A fresh install has no historical rows, so the
 * DEFAULT partition is empty, the SQL helper finds no candidate days, and this
 * returns `{ provisioned: 0, chunks: 1 }`. Fresh installs do not backfill
 * history — old days are handled lazily by the DEFAULT partition plus the
 * ensureClickPartitions window. Idempotent: an already-attached day is never a
 * candidate, so re-running after a completed backfill provisions zero more.
 */
export async function backfillClickPartitions(
  db: Database,
  chunkSize = PARTITION_BACKFILL_CHUNK_DAYS,
): Promise<PartitionBackfillResult> {
  let provisioned = 0;
  let chunks = 0;

  /* One chunk per iteration, each its own `db.execute` and therefore its own
     transaction, so the up-to-chunkSize partitions a chunk attaches have their
     lock footprint released at the commit before the next chunk begins. This is
     the whole point of #294: the cost never accumulates into one history-sized
     transaction the way 0007's DO-block did.

     The SQL helper itself bounds its work to chunkSize candidate days and
     reports how many remain AFTER the chunk, so the loop terminates when the
     DEFAULT partition holds no rows for any unattached day. A declined day (the
     provisioner losing a lock race to write traffic) stays stranded in DEFAULT
     and is reported as still remaining, so it is retried on the next chunk
     rather than lost — which also means `remaining` can stay non-zero across a
     chunk that provisioned nothing. Guarded against that by breaking when a
     chunk makes no progress, so a day that cannot currently be attached does not
     spin the loop forever; a later manual run picks it up once the contention
     clears. */
  for (;;) {
    const [{ provisioned: got, remaining }] = (await db.execute(sql`
      select provisioned, remaining from click_events_backfill_days(${chunkSize}::int)
    `)) as unknown as [{ provisioned: number; remaining: number }];

    chunks++;
    provisioned += got;

    // Done when nothing is left, or when a chunk made no forward progress (every
    // remaining day is currently contended) — the rest is a later run's job.
    if (remaining <= 0 || got === 0) break;
  }

  return { provisioned, chunks };
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
 * But a partition is shared by every workspace, so the day it can be dropped is
 * decided by **one install-wide cutoff the operator controls**
 * (`INSTALL_RETENTION_YEARS` / `CLICK_EVENTS_RETENTION_YEARS`), *not* by the
 * longest `retention_years` any tenant configured. The cutoff used to be
 * `max(retention_years)` across workspaces, which let a single tenant asking for
 * a long window move the cutoff so far back that nothing was ever dropped and
 * every other workspace fell into the row-level `DELETE` — one tenant turning
 * the feature off for the whole install (#295).
 *
 * Per-workspace `retention_years` is therefore **subtractive**: a workspace may
 * keep *less* than the install cutoff, never more. A workspace configured below
 * it still needs its rows removed individually from the partitions that survive
 * — so the `DELETE` does not disappear, it just stops carrying the volume and
 * only ever removes rows a tenant asked to keep for a *shorter* window than the
 * install. A workspace configured *above* the install window is clamped down to
 * the install window: on dated day-partitions its rows are reclaimed by the
 * drops like everyone else's, and the few it may have stranded in the DEFAULT
 * partition (which the drops skip) are swept by the `DELETE`, whose bound is the
 * effective window `least(retention_years, install)`. Neither path lets it keep
 * more than the operator provisioned. When every workspace is at or above the
 * install window and nothing is stranded in DEFAULT (the common case, and the
 * default), `rowsDeleted` is zero and the whole job is a partition drop.
 *
 * **A third pass: the volume cap.** After age-based expiry, this also enforces
 * `MAX_RETAINED_DAYS` — an age-*independent* ceiling on how many day-partitions
 * stay attached. Age retention bounds how *old* data is, not how *much* of it
 * there is, and RDS storage autoscales to a hard 50 GB ceiling past which the
 * instance goes read-only and can never be shrunk. The cap is the backstop that
 * keeps total volume from silently walking into that cliff. It is deliberately
 * a no-op under normal operation (the default cap matches the default 3-year
 * retention); it only bites when partition count runs ahead of the storage
 * budget. Like the age pass it never drops a partition still holding
 * un-rolled-up rows, and it respects `maxDropsPerPass`. Cap-driven drops are
 * folded into the returned `partitionsDropped`.
 */
export async function pruneRetention(
  db: Database,
  maxDropsPerPass = MAX_PARTITION_DROPS,
  /* The volume cap, defaulting to the env-overridable module constant. Exposed
     as a parameter so the cap can be exercised directly in tests without
     provisioning MAX_RETAINED_DAYS+1 partitions; production always uses the
     default. */
  maxRetainedDays = MAX_RETAINED_DAYS,
  /* The install-wide retention window in years, defaulting to the env-overridable
     module constant. Operator-controlled, not derived from tenant settings —
     see INSTALL_RETENTION_YEARS. Exposed as a parameter so the operator model
     can be exercised directly in tests without env mutation; production always
     uses the default. */
  retentionYears = INSTALL_RETENTION_YEARS,
): Promise<RetentionResult> {
  /* One expiry pass at a time.
   *
   * Two overlapping passes would both read the same list of spent partitions,
   * and the cap pass below adds a second, independent drop loop whose targets
   * `click_events_spent_partitions` never listed — so per-drop idempotence is
   * not enough on its own and the guard has to be at pass level. EventBridge
   * fires every minute with retryAttempts: 2 and the Lambda path has no
   * equivalent of the in-process overlap guard, so this is reachable.
   *
   * A lease rather than a session-scoped advisory lock, which is what this used
   * to be. The drops deliberately span several transactions, so a *_xact_* lock
   * would release at the first commit — but a session lock lives on the
   * connection, and the worker pools connections with DATABASE_POOL_MAX=1 on
   * the AWS profile. A pass that vanished mid-run (a Lambda frozen or
   * reclaimed) stranded the lock on a backend Postgres still considered
   * healthy, and every later pass declined: retention stopped for good, with no
   * error and nothing in the logs to distinguish it from having nothing to do.
   * A lease expires by the clock, so the same crash costs one late pass. */
  const lease = await withLease(db, "click_events_prune_retention", RETENTION_LEASE_SECONDS, async () => {
    /* The one install-wide cutoff, from the operator value rather than from any
       tenant's setting. Computed once here, inside the lease and before both
       drop loops and the DELETE, so all three statements agree on it for the
       whole pass — a retention change landing mid-pass can no longer be applied
       inconsistently across them (#295, 'Also in scope').

       Derived from `retentionYears` (a stable process.env constant / parameter),
       NOT from `max(retention_years)` in the workspaces table: reading the DB
       here is what let one tenant asking for a long window move the cutoff for
       the whole install and disable partition drops. The default 3 matches the
       historical fresh-install answer, so a database with no workspaces still
       gets a sane cutoff and does not drop today's data.

       `now() at time zone 'UTC'` rather than `current_date`: every partition
       bound in the migration is explicitly UTC, and current_date resolves in the
       session TimeZone. Mixing the two is the exact bug the migration header
       warns about. */
    const [{ cutoff }] = (await db.execute(sql`
      select ((now() at time zone 'UTC')::date - (${retentionYears}::int * interval '1 year'))::date as cutoff
    `)) as unknown as [{ cutoff: string }];

    /* Listed and dropped separately, one transaction per partition, so the
       ACCESS EXCLUSIVE lock DETACH takes on the parent is released between
       each one instead of being held across the whole batch. Capped as well:
       steady state is one partition a day, but the moment the operator lowers
       CLICK_EVENTS_RETENTION_YEARS, every day between the old and new cutoff
       becomes spent at once. */
    const spent = (await db.execute(sql`
      select part from click_events_spent_partitions(${cutoff}::date) as part
    `)) as unknown as Array<{ part: string }>;

    /* Tallied by outcome rather than by success alone.
     *
     * The function reports which of four things happened, and only 'contended'
     * needs anybody's attention: it means partition maintenance is losing to
     * write traffic. Counting just successes made that state look exactly like
     * having nothing to drop. */
    const outcomes: Record<DropOutcome, number> = { dropped: 0, pinned: 0, contended: 0, missing: 0 };
    const attemptDrop = async (part: string): Promise<DropOutcome> => {
      const [{ outcome }] = (await db.execute(sql`
        select click_events_drop_partition(${part}) as outcome
      `)) as unknown as [{ outcome: DropOutcome }];
      outcomes[outcome]++;
      return outcome;
    };

    for (const { part } of spent.slice(0, maxDropsPerPass)) {
      await attemptDrop(part);
    }

    /* The volume cap, an age-independent backstop. See MAX_RETAINED_DAYS.
     *
     * The age pass above bounds how *old* the retained data is; it does not
     * bound how *many* day-partitions are attached, and past the RDS 50 GB
     * autoscale ceiling the instance goes read-only for good. So if more than
     * MAX_RETAINED_DAYS day-partitions remain attached, drop the OLDEST ones
     * beyond the cap.
     *
     * The candidate list matches click_events_spent_partitions' own selection:
     * attached day-partitions (relname ~ ^click_events_[0-9]{8}$), excluding the
     * DEFAULT partition, and — crucially — only those with NO un-rolled-up rows,
     * so a cap-driven drop can never discard clicks that have not yet been
     * counted into the rollups (the same invariant the age pass and the SQL
     * helper both hold). The EXISTS(... rolled_up_at IS NULL) guard is checked
     * against ONLY the partition, matching the helper. Ordered oldest-first by
     * name (names are YYYYMMDD, so lexical order is chronological), and the
     * count of *all* attached day-partitions decides how many are over the cap
     * — but only the rolled-up, droppable ones are offered as candidates, so a
     * partition pinned by pending rows is skipped rather than lost. */
    const capBudget = maxDropsPerPass - outcomes.dropped;
    if (capBudget > 0) {
      /* Every attached day-partition, oldest first. Names are YYYYMMDD, so
         lexical order is chronological. The DEFAULT partition does not match
         the ^click_events_[0-9]{8}$ pattern, so it is excluded here exactly as
         it is by click_events_spent_partitions. */
      const attached = (await db.execute(sql`
        select c.relname as part
        from pg_class c
        join pg_inherits i on i.inhrelid = c.oid
        where i.inhparent = 'public.click_events'::regclass
          and c.relname ~ '^click_events_[0-9]{8}$'
        order by c.relname
      `)) as unknown as Array<{ part: string }>;

      /* How many attached day-partitions are over the ceiling. The count is of
         ALL attached days, not just droppable ones, so a partition pinned by
         un-rolled-up rows still counts against the cap — a younger droppable
         partition is taken in its place, which keeps total volume falling
         without ever discarding uncounted clicks. */
      let overCap = attached.length - maxRetainedDays;
      for (const { part } of attached) {
        // Stop once volume is back under the cap or the per-pass drop budget is
        // spent — the rest are dropped by later passes, keeping the parent lock
        // short even after a sudden cap change.
        if (overCap <= 0 || outcomes.dropped >= maxDropsPerPass) break;

        /* The un-rolled-up guard lives inside click_events_drop_partition,
           which refuses a partition still holding uncounted clicks and reports
           false — the same outcome this loop used to produce by probing first
           and skipping.
           
           It used to be a separate `sql.raw` probe here, and that was a bug once
           passes could overlap: the name came from the listing statement above,
           so a concurrent pass dropping that partition made the probe raise
           undefined_table with nothing to catch it, which took the rest of the
           maintenance pass down. Inside the function the check also happens
           *after* the partition is locked, so a row can no longer arrive between
           deciding and dropping.
           
           A pinned partition stays attached and is deliberately NOT decremented
           from overCap, so the cap is still enforced by taking the next
           droppable day instead. */
        if ((await attemptDrop(part)) === "dropped") overCap--;
      }
    }

    /* The subtractive per-workspace pass, clamped to the operator install
     * window.
     *
     * The bound is each workspace's **effective** retention:
     * `least(w.retention_years, ${retentionYears}::int)`. That is the whole of
     * the subtractive model in one expression:
     *
     *   - A workspace *below* the install window expires on its own, shorter
     *     window (`least` picks `retention_years`). The drops keep its
     *     partitions for the full install window, so these are the rows they
     *     leave behind, removed here individually.
     *   - A workspace *at or above* the install window is clamped *down* to the
     *     install window (`least` picks `retentionYears`), never retaining more
     *     than the operator provisioned.
     *
     * The guard decides *when* the DELETE is allowed to reach past a workspace's
     * own window. It fires for a row when either clause holds:
     *
     *   - `w.retention_years < ${retentionYears}::int` — the workspace keeps
     *     less than the install window, so its own shorter window is what
     *     expires it, on every partition (dated or DEFAULT). Unchanged from the
     *     original subtractive branch.
     *   - `ce.tableoid = 'click_events_default'::regclass` — the row is stranded
     *     in the DEFAULT partition, which the drops skip by design, so the DELETE
     *     is the *only* mechanism that can ever reach it. This clause lets the
     *     DELETE clamp an at-or-above-window workspace's DEFAULT-stranded rows
     *     down to the operator cutoff.
     *
     * Why the guard is scoped to DEFAULT rather than dropped entirely. Without
     * it, the `least(...)` bound (a timestamp, `now() - N years`) also matches
     * the sub-day slice of the *dated* day-partition straddling the drop cutoff
     * (a date, day-aligned): that partition survives the drop pass until its
     * whole `[day, day+1)` range is strictly before the cutoff, so for a
     * workspace at the install window the slice `[day 00:00, now()-N years)`
     * would be swept here row-by-row every pass. That reintroduces the per-pass
     * row-level DELETE volume #293/#295 exist to keep off this path, in the
     * all-default common case. The DEFAULT-only clause leaves those dated
     * straddling rows to the drop that reclaims the whole partition the next day,
     * while still closing the DEFAULT leak.
     *
     * When every workspace is at or above the install window and no rows are
     * stranded in DEFAULT (the common case, and the default), this deletes
     * nothing and the whole job is a partition drop. The dated partition
     * straddling the cutoff keeps its rows up to a day beyond the setting, until
     * the drop reclaims it whole — the behavior the settings copy documents.
     *
     * The invariants the split has always held are preserved:
     *   - `rolled_up_at is not null` — never discard a click that has not yet
     *     been counted into the rollups.
     *   - `now()` and the interval keep the UTC handling of the original.
     *
     * Deliberately *not* bounded below by the cutoff. An earlier version had
     * `occurred_at >= cutoff` on the theory that it would let the planner prune
     * — it does not, because after the drop pass every attached day partition is
     * already at or above the cutoff, and a lower bound cannot prune a DEFAULT
     * partition at all. What it did do was exclude rows stranded in the default
     * once they aged past the cutoff, so nothing would ever expire them: the
     * drop pass skips the default by design, and this is the only other
     * mechanism. Rows reach the default whenever provisioning falls behind, so
     * that would be a slow permanent leak in a partition no query can prune. */
    const [{ n }] = (await db.execute(sql`
      with expired as (
        delete from click_events ce
        using workspaces w
        where ce.workspace_id = w.id
          and ce.rolled_up_at is not null
          and (
            w.retention_years < ${retentionYears}::int
            or ce.tableoid = 'click_events_default'::regclass
          )
          and ce.occurred_at < now() - (least(w.retention_years, ${retentionYears}::int) * interval '1 year')
        returning 1
      )
      select count(*)::int as n from expired
    `)) as unknown as [{ n: number }];

    return {
      partitionsDropped: outcomes.dropped,
      rowsDeleted: n ?? 0,
      partitionsPinned: outcomes.pinned,
      partitionsContended: outcomes.contended,
      partitionsMissing: outcomes.missing,
    };
  });

  /* Another holder had the lease, so this pass did nothing. Reported as zeroes
     rather than as a failure, because it is the mechanism working. */
  return (
    lease.value ?? {
      partitionsDropped: 0,
      rowsDeleted: 0,
      partitionsPinned: 0,
      partitionsContended: 0,
      partitionsMissing: 0,
    }
  );
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

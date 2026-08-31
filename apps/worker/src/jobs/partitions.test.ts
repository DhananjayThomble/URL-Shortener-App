import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  clickEvents,
  createDatabase,
  domains,
  eq,
  insertClickEvents,
  isTransientPartitionRoutingError,
  links,
  postgresErrorCode,
  sql,
  workspaces,
  type ClickEvent,
  type Database,
} from "@snapurl/database";
import {
  DEFAULT_INSTALL_RETENTION_YEARS,
  ensureClickPartitions,
  pruneRetention,
  resolveRetentionYears,
} from "./rollup.js";

/* ============================================================
   click_events partitioning, against a real Postgres.

   Every claim here is a property of the partition machinery, so
   there is nothing a fake could usefully stand in for — a mock
   would only replay whatever this file assumed about Postgres.

   The two that matter most:

   - An insert for a day with no partition must still succeed.
     If that is ever false, a maintenance job that failed to run
     stops the redirect path from recording clicks, which is the
     opposite of the trade this design is supposed to make.

   - Provisioning a day whose rows already landed in the DEFAULT
     partition must move them, not fail. Postgres refuses to
     ATTACH a partition when the default holds rows belonging to
     the incoming range, and that is the failure the ordering
     inside click_events_ensure_partition exists to avoid.

   Runs only when DATABASE_URL is set, matching rollup.test.ts.
   ============================================================ */

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

const PARENT = "public.click_events";

/* ============================================================
   Operator retention-years parsing, as a pure function.

   Unlike the DB-backed suite below, this needs no Postgres — it
   is the guard that keeps a misconfigured CLICK_EVENTS_RETENTION_YEARS
   from turning into a partition-drop cutoff at or ahead of today,
   which would reclaim LIVE data (issue #295 review). Factoring the
   parse/clamp into `resolveRetentionYears` lets it be asserted
   without provisioning anything, so it runs everywhere, not just
   in CI against a database.
   ============================================================ */
describe("resolveRetentionYears", () => {
  it("uses the default when the env var is unset", () => {
    expect(resolveRetentionYears(undefined)).toBe(DEFAULT_INSTALL_RETENTION_YEARS);
  });

  it("accepts a valid whole-year window", () => {
    expect(resolveRetentionYears("1")).toBe(1);
    expect(resolveRetentionYears("3")).toBe(3);
    expect(resolveRetentionYears("100")).toBe(100);
  });

  it("falls back to the default rather than trusting a data-loss value", () => {
    /* The failure mode this guard exists for: 0 or a negative moves the cutoff
       to today or the future, and the drop pass would then reclaim live data.
       A non-numeric string yields NaN. A fractional value is undefined for a
       whole-year window. All of these must fall back to the safe default, never
       flow into the cutoff arithmetic. */
    for (const bad of ["0", "-1", "-5", "forever", "", "  ", "3.5", "NaN", "abc"]) {
      expect(resolveRetentionYears(bad)).toBe(DEFAULT_INSTALL_RETENTION_YEARS);
    }
  });
});

/** Poll until a condition holds, rather than sleeping and hoping. Used for lock
 *  state, where a fixed head start has to cover a lazy TCP connect plus auth and
 *  losing that race makes a test assert the wrong thing. */
async function waitUntil(what: string, holds: () => Promise<boolean>, tries = 200): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (await holds()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`timed out waiting for ${what}`);
}

describeDb("click_events partitioning", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;
  let workspaceId: string;
  let linkId: string;

  /** UTC midnight for a day offset from today, matching the partition bounds. */
  const utcDay = (offsetDays: number) => {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() + offsetDays);
    return d;
  };

  const partitionName = (offsetDays: number) =>
    `click_events_${utcDay(offsetDays).toISOString().slice(0, 10).replace(/-/g, "")}`;

  /* Partitions are schema objects, not rows, so deleting the fixture workspace
   * does not remove them — the cascade takes the clicks and leaves the tables.
   * Without explicit teardown a partition created by one run is still attached
   * on the next, and the tests that depend on a day *not* being provisioned
   * silently stop testing anything. Learned the hard way. */
  async function dropPartition(name: string) {
    if (!/^click_events_\d{8}$/.test(name)) throw new Error(`refusing to drop ${name}`);
    await db.execute(
      sql.raw(`
        do $teardown$
        begin
          if exists (
            select 1 from pg_class
            where relname = '${name}' and relnamespace = 'public'::regnamespace
          ) then
            -- Detach first when attached; a partition that was never attached
            -- (a half-finished ensure) still needs dropping.
            begin
              execute 'alter table "click_events" detach partition ' || quote_ident('${name}');
            exception when others then null;
            end;
            execute 'drop table if exists ' || quote_ident('${name}');
          end if;
        end
        $teardown$;
      `),
    );
  }

  /* The operator install-retention window these tests exercise pruneRetention
     with. Retention is now operator-controlled (issue #295): the partition-drop
     cutoff comes from this one value, not from max(retention_years) across
     workspaces, so the boundary days the tests provision are derived from it
     rather than from a DB read. Matches the pruneRetention/INSTALL_RETENTION_YEARS
     default of 3, which is also the workspaces.retention_years column default. */
  const INSTALL_RETENTION_YEARS = 3;

  /** The far-future and retention-boundary days these tests provision. */
  async function dropProbePartitions() {
    for (const offset of [400, 401, 500]) await dropPartition(partitionName(offset));

    const rows = (await db.execute(sql`
      select to_char(d, 'YYYYMMDD') as stamp
      from (
        select (current_date - (${INSTALL_RETENTION_YEARS}::int * interval '1 year'))::date as c
      ) k, lateral (values (k.c), (k.c - 2)) as v(d)
    `)) as unknown as Array<{ stamp: string }>;
    for (const row of rows) await dropPartition(`click_events_${row.stamp}`);
  }

  async function partitionExists(name: string): Promise<boolean> {
    const [row] = (await db.execute(sql`
      select exists(
        select 1 from pg_class
        where relname = ${name} and relnamespace = 'public'::regnamespace
      ) as present
    `)) as unknown as [{ present: boolean }];
    return row.present;
  }

  async function isAttached(name: string): Promise<boolean> {
    const [row] = (await db.execute(sql`
      select exists(
        select 1 from pg_inherits i
        join pg_class c on c.oid = i.inhrelid
        where i.inhparent = ${PARENT}::regclass and c.relname = ${name}
      ) as attached
    `)) as unknown as [{ attached: boolean }];
    return row.attached;
  }

  /** Which physical partition a row actually lives in. */
  async function partitionOf(visitorHash: string): Promise<string | null> {
    const rows = (await db.execute(sql`
      select tableoid::regclass::text as part
      from click_events where visitor_hash = ${visitorHash}
    `)) as unknown as Array<{ part: string }>;
    return rows[0]?.part ?? null;
  }

  /* `rolledUpAt` is set deliberately.
   *
   * Nothing here is about the rollup pipeline — these tests only care which
   * physical partition a row lands in. Inserting pending rows would hand
   * rollupClicks work it did not ask for, and because that job is global rather
   * than scoped to one workspace, it would surface as a failure in
   * rollup.test.ts running in a parallel worker rather than here. Marking rows
   * consumed keeps the two files independent.
   *
   * It also matches what retention actually operates on: pruneRetention only
   * expires rows that have already been rolled up. */
  async function addClickAt(occurredAt: Date, visitorHash: string) {
    await db.insert(clickEvents).values({ linkId, workspaceId, occurredAt, visitorHash, rolledUpAt: new Date() });
  }

  beforeAll(async () => {
    handle = createDatabase({ url: DATABASE_URL!, max: 1 });
    db = handle.db;

    const stamp = Date.now();
    const [ws] = await db
      .insert(workspaces)
      .values({ name: "partition test", slug: `part-${stamp}` })
      .returning({ id: workspaces.id });
    workspaceId = ws!.id;

    const [dom] = await db
      .insert(domains)
      .values({ workspaceId, domain: `part-${stamp}.test` })
      .returning({ id: domains.id });

    const [link] = await db
      .insert(links)
      .values({ workspaceId, domainId: dom!.id, slug: `p${stamp}`, destination: "https://example.com" })
      .returning({ id: links.id });
    linkId = link!.id;

    // Start from a known state rather than inheriting whatever a previous run
    // left attached.
    await dropProbePartitions();
  });

  afterAll(async () => {
    if (workspaceId) await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await dropProbePartitions();
    await handle?.close();
  });

  it("is a partitioned table with the partition key in its primary key", async () => {
    const [row] = (await db.execute(sql`
      select
        (select relkind from pg_class where oid = ${PARENT}::regclass) as kind,
        (select conname from pg_constraint
          where conrelid = ${PARENT}::regclass and contype = 'p') as pk
    `)) as unknown as [{ kind: string; pk: string }];

    // 'p' is a partitioned table; 'r' would mean the migration silently left a
    // plain table behind and every claim in this file would be vacuous.
    expect(row.kind).toBe("p");
    // Postgres requires the partition key in every unique constraint, so this
    // cannot be "id" alone. The name is drizzle's, so that `drizzle-kit
    // generate` does not see drift on the next schema change.
    expect(row.pk).toBe("click_events_id_occurred_at_pk");
  });

  it("keeps a DEFAULT partition so no insert can fail for want of one", async () => {
    expect(await partitionExists("click_events_default")).toBe(true);
    expect(await isAttached("click_events_default")).toBe(true);
  });

  it("provisions today and a fortnight ahead", async () => {
    await ensureClickPartitions(db);

    for (const offset of [0, 1, 7, 14]) {
      expect(await isAttached(partitionName(offset))).toBe(true);
    }
  });

  it("routes a click into the partition for its own UTC day", async () => {
    await ensureClickPartitions(db);
    const visitor = `today-${Date.now()}`;
    // Midday, so a timezone slip of a few hours would still land on the right
    // day and this test would not catch it — the point is partition routing,
    // and the boundary case is covered by the DEFAULT-drain test below.
    const noon = utcDay(0);
    noon.setUTCHours(12);
    await addClickAt(noon, visitor);

    expect(await partitionOf(visitor)).toBe(partitionName(0));
  });

  it("accepts a click for a day with no partition rather than failing", async () => {
    /* The guarantee that matters. A day far outside the provisioned window has
       no partition, and the insert must still succeed — a housekeeping job that
       did not run must never be able to stop the redirect path recording a
       click. */
    const visitor = `unprovisioned-${Date.now()}`;
    const farFuture = utcDay(400);

    expect(await partitionExists(partitionName(400))).toBe(false);
    await expect(addClickAt(farFuture, visitor)).resolves.not.toThrow();
    expect(await partitionOf(visitor)).toBe("click_events_default");
  });

  it("moves rows out of the DEFAULT partition when their day is provisioned", async () => {
    /* Postgres refuses to ATTACH a partition while the default holds rows that
       would belong to it. A naive "CREATE TABLE ... PARTITION OF" therefore
       fails permanently once the default has been used, and the table can never
       be repaired without manual surgery. This asserts the drain. */
    const visitor = `drain-${Date.now()}`;
    const day = utcDay(401);
    await addClickAt(day, visitor);
    expect(await partitionOf(visitor)).toBe("click_events_default");

    const [{ created }] = (await db.execute(sql`
      select click_events_ensure_partition(${day.toISOString().slice(0, 10)}::date) as created
    `)) as unknown as [{ created: string }];

    expect(created).toBe(partitionName(401));
    expect(await isAttached(partitionName(401))).toBe(true);
    // Moved, not copied: exactly one row, and it is no longer in the default.
    expect(await partitionOf(visitor)).toBe(partitionName(401));
  });

  it("is idempotent, so a repeated maintenance pass is a no-op", async () => {
    const first = await ensureClickPartitions(db);
    const second = await ensureClickPartitions(db);
    // Same window, so the same counts both times, and neither call throws on the
    // partitions that already exist. toEqual, not toBe: the result is an object.
    expect(second).toEqual(first);
    expect(await isAttached(partitionName(0))).toBe(true);
  });

  it("expires a spent day by dropping its partition, not by deleting rows", async () => {
    /* The cutoff is derived from the operator install-retention window the code
       now uses (#295), rather than from max(retention_years) across workspaces,
       so it matches what pruneRetention computes for the same value. */
    const [{ cutoff }] = (await db.execute(sql`
      select (current_date - (${INSTALL_RETENTION_YEARS}::int * interval '1 year'))::date::text as cutoff
    `)) as unknown as [{ cutoff: string }];

    // Two days clear of the cutoff, so the partition's whole range is expired.
    const [{ spent }] = (await db.execute(sql`
      select (${cutoff}::date - 2)::text as spent
    `)) as unknown as [{ spent: string }];
    const spentPartition = `click_events_${spent.replace(/-/g, "")}`;

    await db.execute(sql`select click_events_ensure_partition(${spent}::date)`);
    expect(await isAttached(spentPartition)).toBe(true);

    const result = await pruneRetention(db);

    expect(result.partitionsDropped).toBeGreaterThanOrEqual(1);
    expect(await partitionExists(spentPartition)).toBe(false);
  });

  it("leaves live partitions and the DEFAULT alone when expiring", async () => {
    await ensureClickPartitions(db);
    const visitor = `survives-${Date.now()}`;
    const noon = utcDay(0);
    noon.setUTCHours(12);
    await addClickAt(noon, visitor);

    await pruneRetention(db);

    expect(await isAttached(partitionName(0))).toBe(true);
    expect(await isAttached("click_events_default")).toBe(true);
    // Today's click is not retention-expired by any setting, so it stays.
    expect(await partitionOf(visitor)).toBe(partitionName(0));
  });

  it("refuses to drop a spent partition that still holds un-rolled-up clicks", async () => {
    /* The invariant the row-level DELETE carried and a partition drop does not
       get for free: raw detail is never discarded before it has been counted.
       Dropping a spent partition holding `rolled_up_at is null` rows would lose
       those clicks from click_events *and* from the rollups at once, and nothing
       would report it — the dashboards would simply under-count forever. */
    const [{ spent }] = (await db.execute(sql`
      select (
        ((now() at time zone 'UTC')::date - (${INSTALL_RETENTION_YEARS}::int * interval '1 year'))::date - 3
      )::text as spent
    `)) as unknown as [{ spent: string }];
    const spentPartition = `click_events_${spent.replace(/-/g, "")}`;

    await db.execute(sql`select click_events_ensure_partition(${spent}::date)`);
    // Deliberately pending, unlike every other insert in this file.
    await db.insert(clickEvents).values({
      linkId,
      workspaceId,
      occurredAt: new Date(`${spent}T11:00:00.000Z`),
      visitorHash: `pending-${Date.now()}`,
      rolledUpAt: null,
    });

    const result = await pruneRetention(db);

    expect(await isAttached(spentPartition)).toBe(true);
    expect(result.partitionsDropped).toBe(0);

    // Once counted, the same partition becomes droppable.
    await db.execute(sql`
      update click_events set rolled_up_at = now()
      where occurred_at >= ${spent}::date and occurred_at < (${spent}::date + 1)
    `);
    const after = await pruneRetention(db);
    expect(after.partitionsDropped).toBeGreaterThanOrEqual(1);
    expect(await partitionExists(spentPartition)).toBe(false);
  });

  it("still deletes rows for a workspace retaining less than the operator install window", async () => {
    /* The subtractive per-workspace branch (#295), and the whole reason
       `rowsDeleted` still exists. The partition-drop cutoff is now one
       operator-controlled install window (here the pruneRetention default of 3
       years), shared by every workspace. A workspace configured for LESS than
       that keeps a shorter window than the install, so the partitions that
       survive for the install window still hold rows it asked to expire — those
       are removed individually by the DELETE.

       The short workspace retains 1 year; the click is inside the 3-year install
       window (so no partition covering it can be dropped) but past the short
       workspace's own 1 year, so its effective window `least(1, 3)` is 1 year and
       its row must be DELETEd. A second workspace retaining more than the install
       window is seeded too, to prove it no longer moves the cutoff: it does NOT
       keep the partition alive, and the drop cutoff stays at the operator's 3
       years. */
    const stamp = Date.now();
    const [long] = await db
      .insert(workspaces)
      .values({ name: "long retention", slug: `long-${stamp}`, retentionYears: 20 })
      .returning({ id: workspaces.id });
    const [short] = await db
      .insert(workspaces)
      .values({ name: "short retention", slug: `short-${stamp}`, retentionYears: 1 })
      .returning({ id: workspaces.id });

    try {
      const [dom] = await db
        .insert(domains)
        .values({ workspaceId: short!.id, domain: `short-${stamp}.test` })
        .returning({ id: domains.id });
      const [shortLink] = await db
        .insert(links)
        .values({ workspaceId: short!.id, domainId: dom!.id, slug: `s${stamp}`, destination: "https://example.com" })
        .returning({ id: links.id });

      // 18 months back: past the short workspace's 1-year retention, but inside
      // the 3-year operator install window, so no partition covering it can be
      // dropped and it must be removed by the row-level DELETE instead.
      const eighteenMonthsAgo = utcDay(-547);
      eighteenMonthsAgo.setUTCHours(11);
      await db.execute(
        sql`select click_events_ensure_partition(${eighteenMonthsAgo.toISOString().slice(0, 10)}::date)`,
      );
      await db.insert(clickEvents).values({
        linkId: shortLink!.id,
        workspaceId: short!.id,
        occurredAt: eighteenMonthsAgo,
        visitorHash: `mixed-${stamp}`,
        rolledUpAt: new Date(),
      });

      // Explicit operator install window of 3 years, matching the default.
      const result = await pruneRetention(db, 20, undefined, 3);

      // Removed by the DELETE, not by a drop — the partition is still live for
      // the workspaces at or above the install window.
      expect(result.rowsDeleted).toBeGreaterThanOrEqual(1);
      expect(await partitionOf(`mixed-${stamp}`)).toBeNull();
    } finally {
      await db.delete(workspaces).where(eq(workspaces.id, short!.id));
      await db.delete(workspaces).where(eq(workspaces.id, long!.id));
      await dropPartition(partitionName(-547));
    }
  });

  it("clamps an above-window workspace's DEFAULT-stranded rows down to the install cutoff", async () => {
    /* The subtractive clamp for DEFAULT-partition rows (#295 review, issue 1).
     *
     * Per-workspace retention is subtractive: a workspace may keep LESS than the
     * install window, never more. On dated day-partitions that holds for free —
     * the drops reclaim everyone's rows past the operator cutoff. But a row an
     * above-window workspace has stranded in the DEFAULT partition (which the
     * drops skip by design) is reachable only by the row-level DELETE. The old
     * guard `w.retention_years < install` excluded every at-or-above-window
     * workspace from the DELETE, so those DEFAULT-stranded rows were swept by
     * nothing and outlived the operator cutoff — the leak the reviewer flagged.
     *
     * The DELETE now bounds by the effective window `least(retention_years,
     * install)`, so an above-window workspace's DEFAULT rows past the operator
     * cutoff are removed here. This seeds a workspace at retention_years = 100
     * with a rolled-up click ~4 years back that lives in the DEFAULT partition
     * (its day is never provisioned), an operator install window of 3 years, and
     * asserts the row is expired — clamped down to the install cutoff despite the
     * tenant asking for 100 years. */
    const stamp = Date.now();
    const [forever] = await db
      .insert(workspaces)
      .values({ name: "default-clamp", slug: `dclamp-${stamp}`, retentionYears: 100 })
      .returning({ id: workspaces.id });

    try {
      const [dom] = await db
        .insert(domains)
        .values({ workspaceId: forever!.id, domain: `dclamp-${stamp}.test` })
        .returning({ id: domains.id });
      const [foreverLink] = await db
        .insert(links)
        .values({
          workspaceId: forever!.id,
          domainId: dom!.id,
          slug: `dc${stamp}`,
          destination: "https://example.com",
        })
        .returning({ id: links.id });

      /* ~4 years back: past the 3-year operator install window, so clamped down
         and expirable, but well inside the tenant's 100 years. Its day is never
         provisioned, so it lands in the DEFAULT partition — the case the drops
         cannot reach. Rolled up, so the DELETE's `rolled_up_at is not null`
         invariant lets it be removed. */
      const fourYearsAgo = utcDay(-1461);
      fourYearsAgo.setUTCHours(11);
      const visitor = `dclamp-${stamp}`;
      await db.insert(clickEvents).values({
        linkId: foreverLink!.id,
        workspaceId: forever!.id,
        occurredAt: fourYearsAgo,
        visitorHash: visitor,
        rolledUpAt: new Date(),
      });

      // It really is stranded in the DEFAULT partition, not on a dated one — the
      // premise of the test.
      expect(await partitionOf(visitor)).toBe("click_events_default");

      // Operator install window of 3 years; the 100-year tenant is clamped to it.
      const result = await pruneRetention(db, 20, undefined, 3);

      // Swept by the DELETE (nothing else can reach a DEFAULT row), honoring the
      // "never keep more than the install window" promise.
      expect(result.rowsDeleted).toBeGreaterThanOrEqual(1);
      expect(await partitionOf(visitor)).toBeNull();
    } finally {
      // Cascade removes the seeded click; the row lived in the DEFAULT partition,
      // which is never dropped, so no partition teardown is needed.
      await db.delete(workspaces).where(eq(workspaces.id, forever!.id));
    }
  });

  it("does not expire an above-window workspace's rows that are still inside the install cutoff", async () => {
    /* The other half of the clamp: subtractive means clamped DOWN to the install
       window, not expired early. A DEFAULT-stranded row from an above-window
       workspace that is younger than the operator cutoff must survive — the
       effective window `least(100, 3)` is 3 years, and this row is inside it. */
    const stamp = Date.now();
    const [forever] = await db
      .insert(workspaces)
      .values({ name: "default-keep", slug: `dkeep-${stamp}`, retentionYears: 100 })
      .returning({ id: workspaces.id });

    try {
      const [dom] = await db
        .insert(domains)
        .values({ workspaceId: forever!.id, domain: `dkeep-${stamp}.test` })
        .returning({ id: domains.id });
      const [foreverLink] = await db
        .insert(links)
        .values({
          workspaceId: forever!.id,
          domainId: dom!.id,
          slug: `dk${stamp}`,
          destination: "https://example.com",
        })
        .returning({ id: links.id });

      /* ~1 year back: inside the 3-year operator window, so it must NOT be
         expired even though it is stranded in the DEFAULT partition. */
      const oneYearAgo = utcDay(-365);
      oneYearAgo.setUTCHours(11);
      const visitor = `dkeep-${stamp}`;
      await db.insert(clickEvents).values({
        linkId: foreverLink!.id,
        workspaceId: forever!.id,
        occurredAt: oneYearAgo,
        visitorHash: visitor,
        rolledUpAt: new Date(),
      });

      expect(await partitionOf(visitor)).toBe("click_events_default");

      await pruneRetention(db, 20, undefined, 3);

      // Inside the install window, so kept — the clamp never expires EARLY.
      expect(await partitionOf(visitor)).toBe("click_events_default");
    } finally {
      await db.execute(sql`delete from click_events where visitor_hash = ${`dkeep-${stamp}`}`);
      await db.delete(workspaces).where(eq(workspaces.id, forever!.id));
    }
  });

  it("does not row-DELETE the dated partition straddling the cutoff for an at-install-window workspace", async () => {
    /* The all-default common-case invariant (#295 review v2, issue 1).
     *
     * The drop cutoff is a DATE (day-aligned): the day-partition covering
     * `D = today - install years` survives the drop pass until its whole
     * `[D, D+1)` range is strictly before the cutoff, i.e. until the next day.
     * The DELETE's bound is a TIMESTAMP (`now() - install years`), which lands
     * partway through D. If the DELETE reached dated partitions, it would sweep
     * the slice `[D 00:00, now()-install years)` of that surviving straddling
     * partition row-by-row every pass — for EVERY workspace at the install
     * window, i.e. the all-default single-tenant install. That is the exact
     * per-pass row-level WAL volume #293/#295 exist to keep off this path, and
     * it contradicts the "rowsDeleted is zero, the whole job is a partition
     * drop" promise plus the "rows may survive up to a day" settings copy.
     *
     * The DELETE only reaches beyond a workspace's own window for DEFAULT-
     * partition rows, so a rolled-up click on the DATED straddling partition,
     * older than the exact `now()-install years` instant but on a partition not
     * yet spent, must be left for the drop (reclaimed whole the next day), NOT
     * row-DELETEd here. This seeds a workspace at retention_years = the install
     * window (3), provisions the dated partition for D, puts a rolled-up click
     * on it at an early hour (so it is older than now()-3years), runs
     * pruneRetention with the operator window of 3, and asserts rowsDeleted is 0
     * and the row still exists. */
    const stamp = Date.now();
    const operatorYears = 3;

    const [ws] = await db
      .insert(workspaces)
      .values({ name: "straddle", slug: `straddle-${stamp}`, retentionYears: operatorYears })
      .returning({ id: workspaces.id });

    /* The straddling day D = today - install years, day-aligned exactly the way
       the cutoff and the partition bounds are, so the partition covering D
       survives the drop (its range is not yet strictly before the cutoff) while
       `now()-3years` lands partway through it. Derived from SQL rather than a day
       count so leap years cannot slip it onto the wrong side of the boundary. */
    const [{ straddleDay }] = (await db.execute(sql`
      select ((now() at time zone 'UTC')::date - (${operatorYears}::int * interval '1 year'))::date::text as "straddleDay"
    `)) as unknown as [{ straddleDay: string }];
    const straddlePartition = `click_events_${straddleDay.replace(/-/g, "")}`;

    try {
      const [dom] = await db
        .insert(domains)
        .values({ workspaceId: ws!.id, domain: `straddle-${stamp}.test` })
        .returning({ id: domains.id });
      const [link] = await db
        .insert(links)
        .values({ workspaceId: ws!.id, domainId: dom!.id, slug: `st${stamp}`, destination: "https://example.com" })
        .returning({ id: links.id });

      // Provision the dated partition for D so the row is NOT in DEFAULT — the
      // premise of the test is a dated straddling partition.
      await db.execute(sql`select click_events_ensure_partition(${straddleDay}::date)`);
      expect(await isAttached(straddlePartition)).toBe(true);

      /* On D at 00:00:01 UTC — an early time-of-day, comfortably before now()'s
         time-of-day, so `occurred_at < now() - 3 years` holds (the row is older
         than the exact cutoff instant) yet the partition covering D is not spent
         and survives the drop. */
      const onStraddle = new Date(`${straddleDay}T00:00:01.000Z`);
      const visitor = `straddle-${stamp}`;
      await db.insert(clickEvents).values({
        linkId: link!.id,
        workspaceId: ws!.id,
        occurredAt: onStraddle,
        visitorHash: visitor,
        rolledUpAt: new Date(),
      });

      // Really on the dated partition, not DEFAULT — the premise.
      expect(await partitionOf(visitor)).toBe(straddlePartition);

      const result = await pruneRetention(db, 20, undefined, operatorYears);

      // Left for the drop, not row-DELETEd: rowsDeleted is zero in the all-
      // default common case, and the row survives until its partition is dropped
      // whole the next day.
      expect(result.rowsDeleted).toBe(0);
      expect(await partitionOf(visitor)).toBe(straddlePartition);
    } finally {
      await db.delete(workspaces).where(eq(workspaces.id, ws!.id));
      // Dated partition name (click_events_YYYYMMDD), so the guarded helper does
      // the detach-and-drop teardown.
      await dropPartition(straddlePartition);
    }
  });

  it("keeps dropping partitions even when one tenant asks for the maximum retention", async () => {
    /* **The core #295 regression.**
     *
     * The drop cutoff used to be max(retention_years) across workspaces, and the
     * settings endpoint lets any workspace ask for up to 100 years ('Forever' in
     * the web UI). So a single tenant choosing the maximum moved the cutoff so
     * far back that NO partition was ever dropped for the whole install, and
     * every other workspace fell into the row-level DELETE — one tenant silently
     * turning the feature off for everyone.
     *
     * The cutoff is now operator-controlled and per-workspace retention is
     * subtractive. This seeds a workspace at retention_years = 100 (the contract
     * max / the web 'Forever' value) and asserts a day spent past the OPERATOR
     * cutoff is still dropped: the maxed-out tenant does not move the install
     * cutoff and does not keep the shared partition alive. */
    const stamp = Date.now();
    const operatorYears = 3;

    const [forever] = await db
      .insert(workspaces)
      .values({ name: "forever retention", slug: `forever-${stamp}`, retentionYears: 100 })
      .returning({ id: workspaces.id });

    // Two days past the operator cutoff, so the partition's whole range is spent
    // under the operator window even though a 100-year workspace exists.
    const [{ spent }] = (await db.execute(sql`
      select (((now() at time zone 'UTC')::date - (${operatorYears}::int * interval '1 year'))::date - 2)::text as spent
    `)) as unknown as [{ spent: string }];
    const spentPartition = `click_events_${spent.replace(/-/g, "")}`;

    try {
      await db.execute(sql`select click_events_ensure_partition(${spent}::date)`);
      expect(await isAttached(spentPartition)).toBe(true);

      // Explicit operator retention of 3 years — the 100-year tenant must not
      // override it.
      const result = await pruneRetention(db, 20, undefined, operatorYears);

      // Dropped, not kept: the maxed-out tenant did not move the cutoff.
      expect(result.partitionsDropped).toBeGreaterThanOrEqual(1);
      expect(await partitionExists(spentPartition)).toBe(false);
    } finally {
      await db.delete(workspaces).where(eq(workspaces.id, forever!.id));
      // `spentPartition` is a click_events_YYYYMMDD name, so the guarded helper
      // handles the detach-and-drop teardown.
      await dropPartition(spentPartition);
    }
  });

  it("drops the oldest partitions beyond MAX_RETAINED_DAYS as an age-independent cap", async () => {
    /* The volume cap, distinct from age retention. These partitions sit ~2
       years back — old, but well inside the default 3-year retention, so the
       age-based pass leaves them alone. What removes them here is the cap: with
       an explicit maxRetainedDays low enough that the table is over the ceiling,
       pruneRetention drops the OLDEST attached day-partitions until the count is
       back under the cap. This is the storage-cliff backstop: age bounds how old
       data is, the cap bounds how much of it there is. */
    const stamp = Date.now();

    // A contiguous block of days ~2 years back, older than anything the other
    // tests provision (today/future and the -730 mixed-retention day, which is
    // dropped in its own finally). Lexical order on YYYYMMDD is chronological,
    // so these are the globally-oldest attached day-partitions.
    const capOffsets = [-760, -759, -758, -757];
    const capPartitions = capOffsets.map((o) => partitionName(o));

    // Start clean so a previous run's leftovers do not skew the attached count.
    for (const name of capPartitions) await dropPartition(name);

    try {
      for (const offset of capOffsets) {
        const day = utcDay(offset);
        day.setUTCHours(11);
        await db.execute(sql`select click_events_ensure_partition(${day.toISOString().slice(0, 10)}::date)`);
        // Rolled up, so the un-rolled-up guard never pins them — the cap alone
        // decides whether they survive.
        await addClickAt(day, `cap-${stamp}-${offset}`);
        expect(await isAttached(partitionName(offset))).toBe(true);
      }

      // How many day-partitions are attached right now. Set the cap two below
      // that so exactly the two globally-oldest (the two oldest of this block)
      // are over the ceiling and get dropped.
      const [{ attached }] = (await db.execute(sql`
        select count(*)::int as attached
        from pg_class c
        join pg_inherits i on i.inhrelid = c.oid
        where i.inhparent = 'public.click_events'::regclass
          and c.relname ~ '^click_events_[0-9]{8}$'
      `)) as unknown as [{ attached: number }];

      const cap = attached - 2;
      const result = await pruneRetention(db, 20, cap);

      // The two oldest of the block are dropped; the two newer ones remain.
      expect(await partitionExists(capPartitions[0]!)).toBe(false);
      expect(await partitionExists(capPartitions[1]!)).toBe(false);
      expect(await isAttached(capPartitions[2]!)).toBe(true);
      expect(await isAttached(capPartitions[3]!)).toBe(true);
      expect(result.partitionsDropped).toBeGreaterThanOrEqual(2);

      // And the DEFAULT partition is never a cap candidate.
      expect(await isAttached("click_events_default")).toBe(true);
    } finally {
      for (const name of capPartitions) await dropPartition(name);
    }
  });

  it("reports false instead of raising when the partition is already gone", async () => {
    /* The function's own tolerance for a missing partition, covering the LOCK
       and the pending probe that now run before the DETACH.

       Note this alone does NOT cover #326 — the old body returned false here too,
       because its handler caught undefined_table from DETACH just as this one
       catches it from LOCK. The regression was at the *caller*, and is covered by
       the test below. */
    const ghost = partitionName(-900);
    await dropPartition(ghost);
    expect(await partitionExists(ghost)).toBe(false);

    const [{ outcome }] = (await db.execute(sql`
      select click_events_drop_partition(${ghost}) as outcome
    `)) as unknown as [{ outcome: string }];

    // 'missing' rather than a bare false: the caller can now tell this apart
    // from a partition it was refused for holding uncounted clicks.
    expect(outcome).toBe("missing");
  });

  it("completes a retention pass when a candidate partition vanishes mid-pass", async () => {
    /* **The actual #326 regression.**
     *
     * The cap loop lists attached partitions in one statement and acts on them in
     * later ones, so a concurrent pass can remove one in between. It used to
     * probe each candidate with an interpolated
     * `select ... from only "<part>"`, which raised undefined_table when the
     * partition had gone — uncaught, so it escaped pruneRetention and skipped
     * every maintenance job behind it.
     *
     * Reproducing that needs the world to change *between* two of
     * pruneRetention's own statements, which no amount of fixture setup can do.
     * So the database handle is proxied: the moment the listing query returns,
     * one of the partitions it just named is dropped out from under the loop.
     * That is exactly the interleaving a concurrent pass produces, made
     * deterministic. */
    const stamp = Date.now();
    const offsets = [-880, -879, -878];
    const names = offsets.map((o) => partitionName(o));
    for (const name of names) await dropPartition(name);

    try {
      for (const offset of offsets) {
        const day = utcDay(offset);
        day.setUTCHours(11);
        await db.execute(sql`select click_events_ensure_partition(${day.toISOString().slice(0, 10)}::date)`);
        // Rolled up, so nothing is pinned and the cap alone decides.
        await addClickAt(day, `vanish-${stamp}-${offset}`);
      }

      const [{ attached }] = (await db.execute(sql`
        select count(*)::int as attached
        from pg_class c
        join pg_inherits i on i.inhrelid = c.oid
        where i.inhparent = 'public.click_events'::regclass
          and c.relname ~ '^click_events_[0-9]{8}$'
      `)) as unknown as [{ attached: number }];

      /* Drop the oldest candidate as soon as the loop has been told it exists.
         `sabotaged` guards against firing on the retention pass's other
         pg_inherits reads. */
      let sabotaged = false;
      const victim = names[0]!;
      const hooked = new Proxy(db, {
        get(target, prop, receiver) {
          if (prop !== "execute") return Reflect.get(target, prop, receiver);
          return async (query: unknown) => {
            const result = await (target as Database).execute(query as never);
            if (!sabotaged && JSON.stringify(query).includes("pg_inherits")) {
              sabotaged = true;
              await dropPartition(victim);
            }
            return result;
          };
        },
      }) as Database;

      // Two over the cap, so the loop reaches past the vanished partition.
      const result = await pruneRetention(hooked, 20, attached - 2);

      expect(sabotaged).toBe(true);
      // The pass survived rather than throwing, which is the whole point.
      expect(result.partitionsDropped).toBeGreaterThanOrEqual(1);
      // The vanished one is gone, and the loop still made progress past it.
      expect(await partitionExists(victim)).toBe(false);
      expect(await partitionExists(names[1]!)).toBe(false);
    } finally {
      for (const name of names) await dropPartition(name);
    }
  });

  it("reports contention separately from having nothing to drop", async () => {
    /* **The #324 regression.**
     *
     * The drop helper used to return a bare boolean, so lock contention, a
     * pinned partition and an already-dropped one all arrived as `false` and
     * pruneRetention could only count successes. A pass losing every drop to
     * write traffic reported `partitionsDropped: 0` — byte-identical to a pass
     * with nothing to drop. Retention could stall indefinitely with no signal.
     *
     * Contention is forced by holding ACCESS EXCLUSIVE on the parent from a
     * second connection, which is what the drop needs first. The 2s lock_timeout
     * inside the function then expires and it reports 'contended'. */
    const stamp = Date.now();
    const target = partitionName(-870);
    await dropPartition(target);

    const blocker = createDatabase({ url: DATABASE_URL!, max: 1 });
    try {
      const day = utcDay(-870);
      day.setUTCHours(11);
      await db.execute(sql`select click_events_ensure_partition(${day.toISOString().slice(0, 10)}::date)`);
      await addClickAt(day, `contend-${stamp}`);

      // Held open for the duration of the attempt below.
      const held = blocker.db.transaction(async (tx) => {
        await tx.execute(sql`lock table only click_events in access exclusive mode`);
        await new Promise((resolve) => setTimeout(resolve, 4000));
      });

      /* Wait for the lock to actually be granted, rather than sleeping and
         hoping. `createDatabase` connects lazily, so a fixed head start has to
         cover a TCP connect, auth, BEGIN and the LOCK — and losing that race
         makes the test assert the wrong thing. Polling pg_locks makes it
         deterministic. */
      for (let i = 0; i < 100; i++) {
        const [{ granted }] = (await db.execute(sql`
          select exists(
            select 1 from pg_locks
            where relation = 'public.click_events'::regclass
              and mode = 'AccessExclusiveLock' and granted
          ) as granted
        `)) as unknown as [{ granted: boolean }];
        if (granted) break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      const [{ outcome }] = (await db.execute(sql`
        select click_events_drop_partition(${target}) as outcome
      `)) as unknown as [{ outcome: string }];

      await held;

      expect(outcome).toBe("contended");
      // Not dropped, and crucially not reported as a silent no-op.
      expect(await isAttached(target)).toBe(true);
    } finally {
      await blocker.close();
      await dropPartition(target);
    }
  });

  it("counts pinned partitions so a rollup backlog is visible in the pass", async () => {
    /* `partitionsPinned` exists so "we skipped days because the rollup is behind"
       is not folded into the same zero as "there was nothing to do".
       
       Driven through the **cap** loop rather than the age loop, and that is not
       incidental: `click_events_spent_partitions` filters pending partitions out
       before the age pass ever sees them, so it cannot report a pinned day. The
       filter is worth keeping — offering a candidate that will certainly be
       refused means taking ACCESS EXCLUSIVE on the parent for nothing — so the
       cap loop, which does not pre-filter, is where this count comes from. */
    const stamp = Date.now();
    const offsets = [-865, -864];
    const names = offsets.map((o) => partitionName(o));
    for (const name of names) await dropPartition(name);

    try {
      // Oldest: pinned by an un-rolled-up click, so the cap must skip it.
      const oldest = utcDay(offsets[0]!);
      oldest.setUTCHours(11);
      await db.execute(sql`select click_events_ensure_partition(${oldest.toISOString().slice(0, 10)}::date)`);
      await db.insert(clickEvents).values({
        linkId,
        workspaceId,
        occurredAt: oldest,
        visitorHash: `pinned-count-${stamp}`,
        rolledUpAt: null,
      });

      // Newer: rolled up, so the cap falls on this one instead.
      const newer = utcDay(offsets[1]!);
      newer.setUTCHours(11);
      await db.execute(sql`select click_events_ensure_partition(${newer.toISOString().slice(0, 10)}::date)`);
      await addClickAt(newer, `pinned-rolled-${stamp}`);

      const [{ attached }] = (await db.execute(sql`
        select count(*)::int as attached
        from pg_class c
        join pg_inherits i on i.inhrelid = c.oid
        where i.inhparent = 'public.click_events'::regclass
          and c.relname ~ '^click_events_[0-9]{8}$'
      `)) as unknown as [{ attached: number }];

      const result = await pruneRetention(db, 20, attached - 1);

      // The point: the skipped day is reported, not silently absent.
      expect(result.partitionsPinned).toBeGreaterThanOrEqual(1);
      expect(await isAttached(names[0]!)).toBe(true);
      expect(await partitionExists(names[1]!)).toBe(false);
    } finally {
      await db.execute(sql`
        update click_events set rolled_up_at = now() where visitor_hash = ${`pinned-count-${stamp}`}
      `);
      for (const name of names) await dropPartition(name);
    }
  });

  it("provisions each day in its own statement so the default lock is not held across the window", async () => {
    /* Provisioning used to be one `generate_series` statement with a lateral
       call, so the ACCESS EXCLUSIVE lock taken on the DEFAULT partition for the
       first day needing work was held until the whole statement committed —
       measured at 7.9s of blocking for a 7ms attach.
       
       Asserted by counting statements rather than by timing, which would be
       flaky: one query to resolve the window, then one per day. */
    let executes = 0;
    const counting = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop !== "execute") return Reflect.get(target, prop, receiver);
        return async (query: unknown) => {
          executes++;
          return (target as Database).execute(query as never);
        };
      },
    }) as Database;

    const result = await ensureClickPartitions(counting, 3, 1);

    // 1 window query + 5 days (-1 through +3).
    expect(executes).toBe(6);
    expect(result.ready + result.declined).toBe(5);
    expect(result.ready).toBeGreaterThan(0);
  });

  it("refuses a partition holding un-rolled-up clicks, from inside the function", async () => {
    /* The same invariant the cap loop and the age pass both rely on, asserted
       against the function directly now that it owns the check rather than
       trusting callers to probe first. Checking inside means it happens after
       the partition is locked, so a row cannot arrive between deciding and
       dropping. */
    const stamp = Date.now();
    const target = partitionName(-901);
    await dropPartition(target);

    try {
      const day = utcDay(-901);
      day.setUTCHours(11);
      await db.execute(sql`select click_events_ensure_partition(${day.toISOString().slice(0, 10)}::date)`);
      await db.insert(clickEvents).values({
        linkId,
        workspaceId,
        occurredAt: day,
        visitorHash: `fn-pending-${stamp}`,
        rolledUpAt: null,
      });

      const [{ refused }] = (await db.execute(sql`
        select click_events_drop_partition(${target}) as refused
      `)) as unknown as [{ refused: string }];

      expect(refused).toBe("pinned");
      expect(await isAttached(target)).toBe(true);

      // Counted, so now it is droppable — proving the refusal was about the
      // pending row and not about something incidental to this partition.
      await db.execute(sql`
        update click_events set rolled_up_at = now()
        where visitor_hash = ${`fn-pending-${stamp}`}
      `);

      const [{ ok }] = (await db.execute(sql`
        select click_events_drop_partition(${target}) as ok
      `)) as unknown as [{ ok: string }];

      expect(ok).toBe("dropped");
      expect(await partitionExists(target)).toBe(false);
    } finally {
      await dropPartition(target);
    }
  });

  it("never drops a capped partition that still holds un-rolled-up clicks", async () => {
    /* The cap honours the same invariant as the age pass: raw detail is never
       discarded before it has been counted. A partition pinned by an
       un-rolled-up row is skipped even when it is the oldest and the table is
       over the cap — the cap falls on the next droppable day instead. */
    const stamp = Date.now();
    const capOffsets = [-756, -755];
    const capPartitions = capOffsets.map((o) => partitionName(o));

    for (const name of capPartitions) await dropPartition(name);

    try {
      // Oldest of the pair: provisioned with a PENDING (un-rolled-up) click, so
      // it must survive the cap.
      const oldest = utcDay(capOffsets[0]!);
      oldest.setUTCHours(11);
      await db.execute(sql`select click_events_ensure_partition(${oldest.toISOString().slice(0, 10)}::date)`);
      await db.insert(clickEvents).values({
        linkId,
        workspaceId,
        occurredAt: oldest,
        visitorHash: `cap-pending-${stamp}`,
        rolledUpAt: null,
      });

      // Newer of the pair: rolled up, so it is droppable.
      const newer = utcDay(capOffsets[1]!);
      newer.setUTCHours(11);
      await db.execute(sql`select click_events_ensure_partition(${newer.toISOString().slice(0, 10)}::date)`);
      await addClickAt(newer, `cap-rolled-${stamp}`);

      const [{ attached }] = (await db.execute(sql`
        select count(*)::int as attached
        from pg_class c
        join pg_inherits i on i.inhrelid = c.oid
        where i.inhparent = 'public.click_events'::regclass
          and c.relname ~ '^click_events_[0-9]{8}$'
      `)) as unknown as [{ attached: number }];

      // One over the cap. The oldest is pinned by its pending row, so the cap
      // must fall on the newer, rolled-up partition instead — the pinned one is
      // still counted against the cap, so a droppable day is dropped in its
      // place rather than nothing happening.
      const cap = attached - 1;
      await pruneRetention(db, 20, cap);

      expect(await isAttached(capPartitions[0]!)).toBe(true); // pinned, kept
      expect(await partitionExists(capPartitions[1]!)).toBe(false); // dropped in its place
    } finally {
      // The pending row blocks a plain drop path only via the guard; teardown
      // removes the table regardless.
      for (const name of capPartitions) await dropPartition(name);
    }
  });

  it("does not drop a partition whose range extends past the cutoff", async () => {
    /* Boundary. A partition covers [day, day + 1), so it is only spent once
       day + 1 has reached the cutoff. Dropping the partition that straddles the
       cutoff would delete data the workspace's retention still covers. */
    const [{ straddling }] = (await db.execute(sql`
      select (current_date - (${INSTALL_RETENTION_YEARS}::int * interval '1 year'))::date::text as straddling
    `)) as unknown as [{ straddling: string }];
    const straddlingPartition = `click_events_${straddling.replace(/-/g, "")}`;

    await db.execute(sql`select click_events_ensure_partition(${straddling}::date)`);
    await pruneRetention(db);

    expect(await isAttached(straddlingPartition)).toBe(true);
  });

  /* ============================================================
     #329: a click whose partition route is invalidated mid-insert.

     These two are the premise the unit tests in
     packages/database/src/click-events.test.ts stand on. Those use
     a fake `db` and error fixtures — which is the right shape for
     asserting branches, but it means the detector and its fixtures
     were written from the same assumption and cannot contradict
     each other. If Postgres words the failure differently, or does
     not raise it at all, every one of those tests still passes and
     the retry never fires in production.

     So: one test that provokes each 23514 a real server can raise
     here and checks the detector tells them apart, and one that
     runs the actual race and checks the retry lands the row.
     ============================================================ */

  it("tells a partition-routing failure apart from the other things that raise 23514", async () => {
    /* Four producers of 23514 reach this schema, and only the first two are worth
       retrying. Provoked rather than asserted from fixtures, so the routine names
       and message text in `isTransientPartitionRoutingError` are checked against
       the server instead of against my recollection of it. */
    await ensureClickPartitions(db);
    const stamp = Date.now();
    const noon = utcDay(0);
    noon.setUTCHours(12);
    const probeTable = `probe_check_${stamp}`;
    const attachTable = `probe_attach_${stamp}`;
    // Far enough out that no provisioning pass will ever attach it.
    const orphanDay = utcDay(4000);
    orphanDay.setUTCHours(12);

    try {
      /* 1. The #329 failure itself. Writing straight into the DEFAULT partition a
            row whose day IS attached reproduces the same error, routine and
            message as losing the race, without having to orchestrate one. */
      const routed = await db
        .execute(
          sql`insert into click_events_default (link_id, workspace_id, occurred_at, visitor_hash)
              values (${linkId}, ${workspaceId}, ${noon.toISOString()}, ${`shape-${stamp}`})`,
        )
        .then(() => null)
        .catch((err: unknown) => err);

      expect(routed).not.toBeNull();
      expect(postgresErrorCode(routed)).toBe("23514");
      expect(isTransientPartitionRoutingError(routed)).toBe(true);

      /* 2. No partition at all. Unreachable on click_events, which always has a
            default, so it is provoked on a throwaway table that has none. */
      await db.execute(sql.raw(`create table "${attachTable}_np" (id int, d date not null) partition by range (d)`));
      const unrouted = await db
        .execute(sql.raw(`insert into "${attachTable}_np" values (1, '2020-01-01')`))
        .then(() => null)
        .catch((err: unknown) => err);

      expect(postgresErrorCode(unrouted)).toBe("23514");
      expect(isTransientPartitionRoutingError(unrouted)).toBe(true);

      /* 3. An ordinary CHECK constraint. Retrying this would cost a round trip to
            fail identically and make a real data problem look intermittent. */
      await db.execute(sql.raw(`create table "${probeTable}" (n int check (n > 0))`));
      const checked = await db
        .execute(sql.raw(`insert into "${probeTable}" values (-1)`))
        .then(() => null)
        .catch((err: unknown) => err);

      expect(postgresErrorCode(checked)).toBe("23514");
      expect(isTransientPartitionRoutingError(checked)).toBe(false);

      /* 4. An ATTACH refused because the default already holds a row for the
            incoming range. Permanent — the fix is to drain the default, which is
            what click_events_ensure_partition does — and its message mentions a
            partition constraint too, so a looser message test would sweep it in
            and retry DDL that can only fail again. */
      await db.execute(
        sql`insert into click_events_default (link_id, workspace_id, occurred_at, visitor_hash)
            values (${linkId}, ${workspaceId}, ${orphanDay.toISOString()}, ${`orphan-${stamp}`})`,
      );
      await db.execute(
        sql.raw(`create table "${attachTable}" (like "click_events" including defaults including constraints)`),
      );
      const refused = await db
        .execute(
          sql.raw(`alter table "click_events" attach partition "${attachTable}"
                   for values from ('${orphanDay.toISOString().slice(0, 10)}')
                   to ('${new Date(orphanDay.getTime() + 86_400_000).toISOString().slice(0, 10)}')`),
        )
        .then(() => null)
        .catch((err: unknown) => err);

      expect(postgresErrorCode(refused)).toBe("23514");
      expect(isTransientPartitionRoutingError(refused)).toBe(false);
    } finally {
      await db.execute(sql.raw(`drop table if exists "${probeTable}"`));
      await db.execute(sql.raw(`drop table if exists "${attachTable}"`));
      await db.execute(sql.raw(`drop table if exists "${attachTable}_np"`));
      await db.execute(sql`delete from click_events where visitor_hash = ${`orphan-${stamp}`}`);
    }
  }, 30_000);

  it("retries a click into the partition that arrived mid-insert instead of losing it", async () => {
    /* **The #329 regression, run for real.**
     *
     * The window is not "an insert happened to run during an ATTACH" — inserts
     * routed to the DEFAULT partition are already serialised against the attach,
     * because ATTACH takes ACCESS EXCLUSIVE on the table it drains. The window is
     * an insert released from that lock at the worst possible moment: it routed to
     * the default before the attach, so it cannot re-route, and by the time its
     * partition constraint is evaluated the row belongs somewhere else.
     *
     * Staged exactly that way, so it is deterministic rather than a load test:
     * hold the default's lock, let an insert for an unprovisioned day pile up
     * behind it, attach that day, commit. Before the retry existed this insert
     * failed and the click was gone. */
    const stamp = Date.now();
    const target = partitionName(500);
    const day = utcDay(500);
    const noon = utcDay(500);
    noon.setUTCHours(12);
    const visitor = `race-${stamp}`;

    await dropPartition(target);
    expect(await partitionExists(target)).toBe(false);

    const blocker = createDatabase({ url: DATABASE_URL!, max: 1 });
    const writer = createDatabase({ url: DATABASE_URL!, max: 1 });
    let releaseAttach: () => void = () => {};
    const attachGate = new Promise<void>((resolve) => {
      releaseAttach = resolve;
    });
    const retried: unknown[] = [];

    const lockOn = async (mode: string, granted: boolean) => {
      const [row] = (await db.execute(sql`
        select exists(
          select 1 from pg_locks
          where relation = 'public.click_events_default'::regclass
            and mode = ${mode} and granted = ${granted}
        ) as present
      `)) as unknown as [{ present: boolean }];
      return row.present;
    };

    try {
      const held = blocker.db.transaction(async (tx) => {
        // What ATTACH itself would take, held open so the ordering is ours.
        await tx.execute(sql`lock table click_events_default in access exclusive mode`);
        await attachGate;
        await tx.execute(
          sql`select click_events_ensure_partition(${day.toISOString().slice(0, 10)}::date)`,
        );
      });

      await waitUntil("the default's ACCESS EXCLUSIVE lock to be granted", () =>
        lockOn("AccessExclusiveLock", true),
      );

      const event: ClickEvent = {
        linkId,
        workspaceId,
        occurredAt: noon,
        visitorHash: visitor,
        country: null,
        city: null,
        device: null,
        browser: null,
        os: null,
        referrerHost: null,
        isQr: false,
        isBot: false,
        blockedReason: null,
        matchedRuleId: null,
        variant: null,
      };
      const insert = insertClickEvents(writer.db, [event], {
        onRetry: (err) => retried.push(err),
      });

      // The insert has routed to the default and is queued behind the lock. It
      // cannot re-route from here, which is the whole point.
      await waitUntil("the click insert to queue behind it", () =>
        lockOn("RowExclusiveLock", false),
      );

      releaseAttach();
      await held;
      await insert;

      // Retried exactly once, and reported — a silent retry would leave no way to
      // tell whether provisioning has fallen behind.
      expect(retried).toHaveLength(1);
      expect(isTransientPartitionRoutingError(retried[0])).toBe(true);

      // And the click is in the partition that arrived, not lost and not stranded
      // in the default.
      expect(await isAttached(target)).toBe(true);
      expect(await partitionOf(visitor)).toBe(target);
    } finally {
      releaseAttach();
      await blocker.close();
      await writer.close();
      await db.execute(sql`delete from click_events where visitor_hash = ${visitor}`);
      await dropPartition(target);
    }
  }, 30_000);
});

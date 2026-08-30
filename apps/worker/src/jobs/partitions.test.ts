import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clickEvents, createDatabase, domains, eq, links, sql, workspaces, type Database } from "@snapurl/database";
import { ensureClickPartitions, pruneRetention } from "./rollup.js";

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

  /** The far-future and retention-boundary days these tests provision. */
  async function dropProbePartitions() {
    for (const offset of [400, 401]) await dropPartition(partitionName(offset));

    const rows = (await db.execute(sql`
      select to_char(d, 'YYYYMMDD') as stamp
      from (
        select (current_date - (coalesce(max(retention_years), 3) * interval '1 year'))::date as c
        from workspaces
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
    // Same window, so the same number of days is reported ready both times and
    // neither call throws on the partitions that already exist.
    expect(second).toBe(first);
    expect(await isAttached(partitionName(0))).toBe(true);
  });

  it("expires a spent day by dropping its partition, not by deleting rows", async () => {
    /* The cutoff is derived the same way pruneRetention derives it, rather than
       hardcoded, so this holds whatever retention the workspaces in this
       database happen to be using. */
    const [{ cutoff }] = (await db.execute(sql`
      select (current_date - (coalesce(max(retention_years), 3) * interval '1 year'))::date::text as cutoff
      from workspaces
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
      select ((
        select ((now() at time zone 'UTC')::date - (coalesce(max(retention_years), 3) * interval '1 year'))::date
        from workspaces
      ) - 3)::text as spent
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

  it("still deletes rows for a workspace retaining less than the longest retention", async () => {
    /* The mixed-retention branch, and the whole reason `rowsDeleted` exists.
       A partition is shared by every workspace, so it can only be dropped once
       it is past the *longest* retention anyone configured. Workspaces keeping
       less than that still need their rows removed individually from the
       partitions that survive. */
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

      // Two years back: past the short workspace's 1-year retention, but well
      // inside the 20-year maximum, so no partition covering it can be dropped.
      const twoYearsAgo = utcDay(-730);
      twoYearsAgo.setUTCHours(11);
      await db.execute(sql`select click_events_ensure_partition(${twoYearsAgo.toISOString().slice(0, 10)}::date)`);
      await db.insert(clickEvents).values({
        linkId: shortLink!.id,
        workspaceId: short!.id,
        occurredAt: twoYearsAgo,
        visitorHash: `mixed-${stamp}`,
        rolledUpAt: new Date(),
      });

      const result = await pruneRetention(db);

      // Removed by the DELETE, not by a drop — the partition is still live for
      // the long-retention workspace.
      expect(result.rowsDeleted).toBeGreaterThanOrEqual(1);
      expect(await partitionOf(`mixed-${stamp}`)).toBeNull();
    } finally {
      await db.delete(workspaces).where(eq(workspaces.id, short!.id));
      await db.delete(workspaces).where(eq(workspaces.id, long!.id));
      await dropPartition(partitionName(-730));
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

    const [{ ok }] = (await db.execute(sql`
      select click_events_drop_partition(${ghost}) as ok
    `)) as unknown as [{ ok: boolean }];

    expect(ok).toBe(false);
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
      `)) as unknown as [{ refused: boolean }];

      expect(refused).toBe(false);
      expect(await isAttached(target)).toBe(true);

      // Counted, so now it is droppable — proving the refusal was about the
      // pending row and not about something incidental to this partition.
      await db.execute(sql`
        update click_events set rolled_up_at = now()
        where visitor_hash = ${`fn-pending-${stamp}`}
      `);

      const [{ ok }] = (await db.execute(sql`
        select click_events_drop_partition(${target}) as ok
      `)) as unknown as [{ ok: boolean }];

      expect(ok).toBe(true);
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
      select (current_date - (coalesce(max(retention_years), 3) * interval '1 year'))::date::text as straddling
      from workspaces
    `)) as unknown as [{ straddling: string }];
    const straddlingPartition = `click_events_${straddling.replace(/-/g, "")}`;

    await db.execute(sql`select click_events_ensure_partition(${straddling}::date)`);
    await pruneRetention(db);

    expect(await isAttached(straddlingPartition)).toBe(true);
  });
});

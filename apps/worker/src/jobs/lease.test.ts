import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createDatabase, sql, type Database } from "@snapurl/database";
import { withLease } from "./lease.js";

/* ============================================================
   Job leases, against a real Postgres.

   The property that matters is the one a session-scoped advisory
   lock did not have: a holder that vanishes must not keep the
   job from ever running again. That is why the expiry case has
   its own test — it is the regression this file exists for.

   Runs only when DATABASE_URL is set, matching the other worker
   suites.
   ============================================================ */

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

describeDb("withLease", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;

  const NAME = "test_lease";

  /** Force the stored lease into the past, standing in for a holder that died
   *  without releasing. Nothing else can produce that state on demand. */
  async function expireLease(name = NAME) {
    await db.execute(sql`
      update job_leases set locked_until = now() - interval '1 second' where name = ${name}
    `);
  }

  async function storedHolder(name = NAME): Promise<string | null> {
    const rows = (await db.execute(sql`
      select holder from job_leases where name = ${name}
    `)) as unknown as Array<{ holder: string | null }>;
    return rows[0]?.holder ?? null;
  }

  beforeEach(async () => {
    handle ??= createDatabase({ url: DATABASE_URL!, max: 2 });
    db = handle.db;
    await db.execute(sql`delete from job_leases where name like 'test_lease%'`);
  });

  afterAll(async () => {
    if (db) await db.execute(sql`delete from job_leases where name like 'test_lease%'`);
    await handle?.close();
  });

  it("runs the job and reports it acquired the lease", async () => {
    const result = await withLease(db, NAME, 60, async () => "done");

    expect(result.acquired).toBe(true);
    expect(result.value).toBe("done");
  });

  it("releases on the way out, so the next pass can take it", async () => {
    await withLease(db, NAME, 60, async () => "first");
    const second = await withLease(db, NAME, 60, async () => "second");

    // Sequential passes are the normal case and must not block each other.
    expect(second.acquired).toBe(true);
    expect(second.value).toBe("second");
  });

  it("refuses a second holder while the lease is live", async () => {
    let innerRan = false;

    // The nested call stands in for a concurrent pass: the outer lease is held
    // and has not lapsed, so the inner one must decline.
    await withLease(db, NAME, 60, async () => {
      const inner = await withLease(db, NAME, 60, async () => {
        innerRan = true;
      });
      expect(inner.acquired).toBe(false);
      expect(inner.value).toBeUndefined();
    });

    expect(innerRan).toBe(false);
  });

  it("does not run the job at all when the lease is unavailable", async () => {
    // Held by someone else, far into the future.
    await db.execute(sql`
      insert into job_leases (name, locked_until, holder, acquired_at)
      values (${NAME}, now() + interval '1 hour', 'someone-else', now())
    `);

    let ran = false;
    const result = await withLease(db, NAME, 60, async () => {
      ran = true;
    });

    expect(result.acquired).toBe(false);
    expect(ran).toBe(false);
    // The other holder's claim is untouched.
    expect(await storedHolder()).toBe("someone-else");
  });

  it("lets the next pass take over after a holder dies without releasing", async () => {
    /* **The regression this replaces.**
     *
     * A session-scoped advisory lock is held by the connection, so a worker
     * killed mid-pass — a Lambda frozen or reclaimed — left it held on a backend
     * Postgres still considered healthy, and every later pass declined forever.
     * Retention simply stopped, with no error to notice.
     *
     * A lease expires by the clock, so the same crash costs one late pass. */
    await db.execute(sql`
      insert into job_leases (name, locked_until, holder, acquired_at)
      values (${NAME}, now() + interval '1 hour', 'holder-that-died', now())
    `);
    await expireLease();

    const result = await withLease(db, NAME, 60, async () => "recovered");

    expect(result.acquired).toBe(true);
    expect(result.value).toBe("recovered");
    expect(await storedHolder()).not.toBe("holder-that-died");
  });

  it("releases even when the job throws, and does not swallow the error", async () => {
    await expect(
      withLease(db, NAME, 60, async () => {
        throw new Error("job blew up");
      }),
    ).rejects.toThrow("job blew up");

    // The failure must not strand the lease — a job that throws every pass would
    // otherwise lock itself out permanently.
    const next = await withLease(db, NAME, 60, async () => "after failure");
    expect(next.acquired).toBe(true);
  });

  it("does not release a lease that has already been taken by someone else", async () => {
    /* The overrun case, and the reason release is matched on holder.
     *
     * A pass that outlives its TTL no longer owns the lease. Releasing
     * unconditionally would hand the new holder's lease away and let a third
     * pass start alongside it — manufacturing exactly the concurrent execution
     * the lease exists to prevent. */
    await withLease(db, NAME, 60, async () => {
      // Simulate this pass overrunning: its lease lapses and another process
      // legitimately claims it while the job is still running.
      await expireLease();
      await db.execute(sql`
        update job_leases
        set locked_until = now() + interval '1 hour', holder = 'took-over', acquired_at = now()
        where name = ${NAME}
      `);
    });

    // The takeover survived our exit, so nothing was handed away.
    expect(await storedHolder()).toBe("took-over");
    const intruder = await withLease(db, NAME, 60, async () => "should not run");
    expect(intruder.acquired).toBe(false);
  });

  it("keeps leases for different jobs independent", async () => {
    await withLease(db, NAME, 60, async () => {
      const other = await withLease(db, `${NAME}_other`, 60, async () => "other ran");
      // One job holding its lease must not block an unrelated one.
      expect(other.acquired).toBe(true);
      expect(other.value).toBe("other ran");
    });
  });

  it("never lets two racing callers run the job at the same time", async () => {
    /* Mutual exclusion is the actual property, and it is worth stating that way
       rather than as "exactly one acquires". Two passes acquiring in *sequence*
       is correct and expected — the first releases on its way out — so counting
       acquisitions proves nothing. What must never happen is two jobs in flight
       together, which is what the peak counter measures. */
    let inFlight = 0;
    let peak = 0;

    const job = async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      // Long enough that a second caller attempting mid-run would overlap if
      // the guard did not hold. Without the pause both jobs finish before the
      // other starts and the test proves nothing.
      await new Promise((resolve) => setTimeout(resolve, 150));
      inFlight--;
    };

    await Promise.all([
      withLease(db, NAME, 60, job),
      withLease(db, NAME, 60, job),
      withLease(db, NAME, 60, job),
    ]);

    expect(peak).toBe(1);
  });
});

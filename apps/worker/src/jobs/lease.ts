import { randomUUID } from "node:crypto";
import { sql, type Database } from "@snapurl/database";

/* ============================================================
   Running a job at most once at a time, when the job spans
   more than one transaction.

   For single-transaction work, use pg_try_advisory_xact_lock
   instead — it is cheaper and it cleans itself up on commit.
   This exists for the other case.

   See packages/database/src/schema/jobs.ts for why a lease
   rather than a session-scoped advisory lock: a session lock
   lives on the connection, and a holder that vanishes leaves it
   held on a backend Postgres still thinks is healthy. A lease
   expires by the clock, so the failure mode is "late" rather
   than "never again".
   ============================================================ */

/** Identifies this process in the lease row. Diagnostics only — correctness
 *  comes from it being unique per holder, not from what it says. */
const HOLDER = `${process.env.AWS_LAMBDA_FUNCTION_NAME ?? "worker"}:${process.pid}:${randomUUID().slice(0, 8)}`;

export interface LeaseResult<T> {
  /** False when another holder had it. The job did not run; nothing is wrong. */
  acquired: boolean;
  /** The job's return value, present only when `acquired`. */
  value?: T;
}

/**
 * Run `job` while holding a named lease, or don't run it at all.
 *
 * The lease is taken in a single statement, which is what makes it safe under
 * concurrency: `insert ... on conflict do update ... where locked_until < now()`
 * lets Postgres serialise the contenders on the row, and the loser's update is
 * filtered out rather than overwriting the winner's claim. Two callers racing
 * cannot both come away believing they hold it.
 *
 * `ttlSeconds` has to comfortably exceed the job's worst-case runtime, or a slow
 * pass will have its lease taken from underneath it and end up running twice.
 * Sizing it against the process's own ceiling — a Lambda timeout, say — is the
 * reliable way to pick it, since the holder cannot outlive that anyway.
 *
 * Releasing is best-effort by design. A crash skips it, and that is precisely
 * the case the expiry exists for.
 */
export async function withLease<T>(
  db: Database,
  name: string,
  ttlSeconds: number,
  job: () => Promise<T>,
): Promise<LeaseResult<T>> {
  const rows = (await db.execute(sql`
    insert into job_leases (name, locked_until, holder, acquired_at)
    values (${name}, now() + make_interval(secs => ${ttlSeconds}), ${HOLDER}, now())
    on conflict (name) do update
      set locked_until = now() + make_interval(secs => ${ttlSeconds}),
          holder = ${HOLDER},
          acquired_at = now()
      where job_leases.locked_until < now()
    returning name
  `)) as unknown as Array<{ name: string }>;

  // No row means the ON CONFLICT update was filtered out: someone else holds a
  // lease that has not lapsed.
  if (rows.length === 0) return { acquired: false };

  try {
    return { acquired: true, value: await job() };
  } finally {
    /* Guarded on holder.
     *
     * If this pass overran its TTL, another holder may legitimately own the
     * lease by now. Releasing unconditionally would hand that holder's lease
     * away and let a third pass start alongside it — turning an overrun into
     * exactly the concurrent execution the lease exists to prevent. Matching on
     * holder means an expired owner releases nothing.
     *
     * Failing to release is survivable (the lease lapses on its own), so this
     * must never mask the job's own error. */
    await db
      .execute(sql`
        update job_leases set locked_until = now()
        where name = ${name} and holder = ${HOLDER}
      `)
      .catch(() => undefined);
  }
}

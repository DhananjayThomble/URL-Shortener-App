import { pgTable, timestamp, varchar } from "drizzle-orm/pg-core";

/* ============================================================
   Leases for jobs that must not run twice at once.

   The obvious tool is a Postgres advisory lock, and for work
   that fits in one transaction `pg_try_advisory_xact_lock` is
   the right answer — it disappears on commit or rollback, with
   nothing to clean up.

   This table exists for the case that does not fit in one
   transaction. Partition retention deliberately spans several,
   so the ACCESS EXCLUSIVE lock a DETACH takes on the parent is
   released between drops rather than held across the batch. A
   *session*-scoped advisory lock would cover that, and it is
   what this replaced — but a session lock lives on the
   connection, and nothing bounds how long it is held. The
   worker pools connections and the AWS profile runs
   DATABASE_POOL_MAX=1, so a process that vanishes mid-pass —
   a Lambda frozen or reclaimed, which this codebase documents
   as a real hazard — strands the lock on a backend Postgres
   still considers healthy. Every later pass then declines, and
   the job stops running for good with no error to notice.

   A lease cannot outlive its holder, because it expires by the
   clock rather than by anyone remembering to release it. The
   worst case degrades to "somebody runs it a few minutes late"
   instead of "nobody runs it ever again".
   ============================================================ */

export const jobLeases = pgTable("job_leases", {
  /** Stable job identifier, e.g. "click_events_prune_retention". */
  name: varchar("name", { length: 64 }).primaryKey(),

  /**
   * When the lease lapses and another holder may take it.
   *
   * This is the whole mechanism: acquiring is a conditional write against this
   * column, and releasing sets it to `now()`. A crashed holder needs no
   * cleanup, because the row is already timestamped to expire.
   */
  lockedUntil: timestamp("locked_until", { withTimezone: true }).notNull().defaultNow(),

  /**
   * Who holds it, for two reasons.
   *
   * Diagnostics is the lesser one. The reason it is load-bearing: releasing
   * checks it, so a holder whose lease already expired — and was taken by
   * someone else — cannot release a lease it no longer owns and hand a second
   * process a free run alongside the first.
   */
  holder: varchar("holder", { length: 120 }),

  /** When the current holder took it. Purely for reading the logs later. */
  acquiredAt: timestamp("acquired_at", { withTimezone: true }),
});

/* ============================================================
   Reading a SQLSTATE off a driver error.

   Drizzle 0.44 wraps driver errors in a DrizzleQueryError and
   puts the real PostgresError — the one carrying `code` — on
   `.cause`. Anything checking `err.code` at the top level
   silently stops matching, which is how a handled 409 once
   turned into a 500.

   This lives in the database package rather than in the API
   because the shared click INSERT needs the same walk to spot a
   transient partition-routing failure, and that INSERT is in
   this package. The API also needs it, to map codes to HTTP
   statuses; `apps/api/src/common/postgres-error.filter.ts`
   re-exports these so its existing importers are unchanged.
   Copying the walk instead would leave two versions to keep in
   step, and a code sitting one level down being missed is
   exactly the bug it exists to prevent.
   ============================================================ */

/** Walks the cause chain — the code can be several levels down. */
export function postgresErrorCode(err: unknown): string | null {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && /^\d{5}$/.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

export function isUniqueViolation(err: unknown): boolean {
  return postgresErrorCode(err) === "23505";
}

export function isForeignKeyViolation(err: unknown): boolean {
  return postgresErrorCode(err) === "23503";
}

/** Same walk, for the `routine` field: the name of the C function that raised
 *  the error. postgres.js surfaces it from the wire's `R` field. */
function postgresErrorRoutine(err: unknown): string | null {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current; depth++) {
    const routine = (current as { routine?: unknown }).routine;
    if (typeof routine === "string" && routine.length > 0) return routine;
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

/** Same walk, for the message. Joined rather than first-wins because Drizzle's
 *  wrapper carries its own message and either level may hold the useful text. */
function postgresErrorMessage(err: unknown): string {
  let current: unknown = err;
  const parts: string[] = [];
  for (let depth = 0; depth < 5 && current; depth++) {
    const message = (current as { message?: unknown }).message;
    if (typeof message === "string") parts.push(message);
    current = (current as { cause?: unknown }).cause;
  }
  return parts.join(" | ").toLowerCase();
}

/* The two routines that raise 23514 during tuple routing. Both are worth
   retrying; every other producer of 23514 is not.

   Verified against Postgres 18.6 rather than recalled — see the table in
   `isTransientPartitionRoutingError`. Matching on `routine` is what makes the
   check locale-independent: `errmsg()` output is translated through
   `lc_messages`, `routine` is not. */
const PARTITION_ROUTING_ROUTINES = new Set(["ExecPartitionCheckEmitError", "ExecFindPartition"]);

/**
 * Did this insert fail only because the table's partitions changed underneath it?
 *
 * `click_events` is partitioned by day with a DEFAULT partition as the safety
 * net, and the worker attaches new day-partitions while the redirect path is
 * inserting. A row routed to the DEFAULT partition can then fail *its* partition
 * constraint, because that constraint is "none of the attached ranges" and the
 * set of attached ranges just changed. Postgres rechecks it precisely for this
 * reason (commit `ef1e125`, backpatched to 12).
 *
 * Everything below `23514 check_violation` is shared with ordinary CHECK
 * constraints, so the code alone is not enough. These four cases were provoked
 * against Postgres 18.6 and are what the check is built from:
 *
 * | routine                        | message                                                                          | retry |
 * | ------------------------------ | -------------------------------------------------------------------------------- | ----- |
 * | `ExecPartitionCheckEmitError`  | new row for relation "click_events_default" violates partition constraint        | yes   |
 * | `ExecFindPartition`            | no partition of relation "x" found for row                                       | yes   |
 * | `ExecConstraints`              | new row for relation "x" violates check constraint "y"                           | no    |
 * | `ATRewriteTable`               | updated partition constraint for default partition "x" would be violated by ...  | no    |
 *
 * That last row is why the message test is `violates partition constraint` and
 * not `partition constraint`: an `ATTACH` refused because the default already
 * holds a row for the incoming range is a *permanent* failure, and its message
 * mentions a partition constraint too.
 *
 * `routine` is checked first because it is not translated. The message is a
 * fallback for the case where no routine reaches us — an error rebuilt from a
 * log, or a driver that drops the field — and the two are OR'd rather than
 * routine being authoritative so that a future Postgres renaming the function
 * degrades to the message check instead of silently never retrying.
 *
 * A retry is honest here rather than papering over a race: the failing statement
 * had already pinned its partition descriptor before the invalidation arrived,
 * so it could not re-route. A fresh statement builds a fresh one from the
 * invalidated relcache and lands the row in the partition that now exists.
 */
export function isTransientPartitionRoutingError(err: unknown): boolean {
  if (postgresErrorCode(err) !== "23514") return false;
  const routine = postgresErrorRoutine(err);
  if (routine !== null && PARTITION_ROUTING_ROUTINES.has(routine)) return true;
  const message = postgresErrorMessage(err);
  return message.includes("violates partition constraint") || message.includes("no partition of relation");
}

/* ============================================================
   Reading a SQLSTATE off a driver error.

   Drizzle 0.44 wraps driver errors in a DrizzleQueryError and
   puts the real PostgresError — the one carrying `code` — on
   `.cause`. Anything checking `err.code` at the top level
   silently stops matching, which is how a handled 409 once
   turned into a 500.

   This lives in the database package rather than in the API
   because three different apps now need it: the API maps codes
   to HTTP statuses, and the redirect and worker both need to
   recognise a transient partition-routing failure on the click
   write. `apps/api/src/common/postgres-error.filter.ts`
   re-exports these so its existing importers are unchanged.
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

/** Same walk, for the message rather than the code. */
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

/**
 * Did this insert fail only because the table's partitions changed underneath it?
 *
 * `click_events` is partitioned by day with a DEFAULT partition as the safety
 * net, and the worker attaches new day-partitions while the redirect path is
 * inserting. A row routed to the DEFAULT partition can then fail its partition
 * constraint: the router picked the default, an `ATTACH` for that row's day
 * committed, and by the time the constraint was evaluated the row belonged to the
 * new partition instead.
 *
 * Both failures are `23514 check_violation`:
 *
 *   - "new row for relation "click_events_default" violates partition constraint"
 *   - "no partition of relation "click_events" found for row"
 *
 * The message is checked as well as the code, because 23514 is also what an
 * ordinary CHECK constraint raises and retrying one of those would be pointless.
 *
 * This is genuinely transient — the second attempt plans against a fresh relcache
 * and routes the row to the partition that now exists — which is what makes a
 * retry the honest fix rather than papering over a race.
 */
export function isTransientPartitionRoutingError(err: unknown): boolean {
  if (postgresErrorCode(err) !== "23514") return false;
  const message = postgresErrorMessage(err);
  return message.includes("partition constraint") || message.includes("no partition of relation");
}

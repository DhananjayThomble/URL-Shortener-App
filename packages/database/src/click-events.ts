import { clickEvents } from "./schema/index.js";
import type { Database } from "./client.js";
import { isTransientPartitionRoutingError } from "./postgres-errors.js";

/* ============================================================
   The click event, and the one INSERT that lands it.

   A click is recorded in two shapes across the codebase:

     - the redirect's PostgresClickSink writes it straight to
       click_events (single-node / k8s / compose);
     - on the AWS profile the redirect SqsClickSink sends it to a
       queue as JSON, and the worker's SQS consumer drains that
       queue back into the SAME click_events table.

   Both must produce byte-for-byte identical rows, so the column
   mapping lives here as one function and both paths call it. The
   ClickEvent type also lives here (rather than in the redirect)
   so the worker consumer can import it without depending on the
   redirect app. It is re-exported from apps/redirect/src/click-sink.ts
   so existing redirect importers are unchanged.
   ============================================================ */

export interface ClickEvent {
  linkId: string;
  workspaceId: string;
  occurredAt: Date;
  visitorHash: string;
  country: string | null;
  city: string | null;
  device: string | null;
  browser: string | null;
  os: string | null;
  referrerHost: string | null;
  isQr: boolean;
  isBot: boolean;
  blockedReason: string | null;
  matchedRuleId: string | null;
  variant: string | null;
}

/** The wire shape of a ClickEvent on the SQS queue: identical to ClickEvent
 *  except occurredAt is an ISO-8601 string (JSON has no Date). */
type SerializedClickEvent = Omit<ClickEvent, "occurredAt"> & { occurredAt: string };

/** Serialise a ClickEvent for an SQS MessageBody. The only non-JSON field is
 *  occurredAt, which becomes an ISO string; deserializeClickEvent reverses it. */
export function serializeClickEvent(event: ClickEvent): string {
  const wire: SerializedClickEvent = { ...event, occurredAt: event.occurredAt.toISOString() };
  return JSON.stringify(wire);
}

/** Revive a ClickEvent from an SQS record body, turning occurredAt back into a
 *  Date so the row inserted matches the one the redirect built. */
export function deserializeClickEvent(body: string): ClickEvent {
  const wire = JSON.parse(body) as SerializedClickEvent;
  return { ...wire, occurredAt: new Date(wire.occurredAt) };
}

export interface InsertClickEventsOptions {
  /** Called when the first attempt lost its race with a concurrent `ATTACH` and
   *  a retry was issued, whether or not the retry then succeeded.
   *
   *  This exists so the retry is not invisible. The case for the retry is a rate
   *  — a fraction of inserts failing under load — and without a signal there is
   *  no way to tell whether that rate moved, or whether the retry is firing far
   *  more often than expected because provisioning has stopped running. Both
   *  callers log it at warn, the same way partition contention is reported. */
  onRetry?: (err: unknown) => void;
}

/**
 * The single INSERT path into click_events, shared by PostgresClickSink and the
 * worker's SQS consumer so a click recorded either way is the same row. A no-op
 * on an empty batch.
 *
 * **Retried once on a partition-routing failure.** `click_events` is partitioned
 * by day with a DEFAULT partition, and the worker attaches new day-partitions
 * while the redirect path is inserting. A row routed to the default can fail its
 * partition constraint when an `ATTACH` for that row's day commits in between —
 * #329 measured roughly 0.6% of inserts during a loaded provisioning pass, and
 * the failures cluster exactly when provisioning has fallen behind, which is when
 * the default is receiving traffic in the first place.
 *
 * That matters more than it sounds. Since click writes became awaited, this is a
 * failed write rather than a delayed one. On the Postgres sink the caller catches
 * and logs, and the click is simply gone. (On the AWS profile the worker reports
 * the record in `batchItemFailures` and SQS redrives it, so there the same
 * failure costs a redrive rather than the click — still worth removing, but not
 * data loss.) It is also the exact case the DEFAULT partition exists to prevent:
 * the whole argument for keeping a default is that an insert must never fail for
 * want of a partition, and here one fails *because* a partition arrived.
 *
 * One retry, not more. The failing statement had already pinned its partition
 * descriptor before the invalidation reached it, so it could not re-route; a
 * fresh statement builds a fresh descriptor and lands the row in the partition
 * that now exists. A row that fails twice is failing for some other reason and
 * should surface rather than be retried into silence.
 *
 * **Two preconditions, both currently true, both easy to break:**
 *
 * 1. `db` must be a pool handle, not a transaction. Inside an explicit
 *    transaction the 23514 aborts it and the retry fails with `25P02`, which is
 *    not a code this retries — so the fix would quietly become a no-op. The
 *    signature asking for `Database` rather than the `Executor` union is what
 *    enforces this; widening it would need the retry rethought.
 * 2. Resending the whole batch is safe because Drizzle emits one multi-row
 *    `INSERT ... VALUES (...), (...)`, and in autocommit that statement is
 *    all-or-nothing: a rejected attempt commits no rows. There is no second line
 *    of defence if that ever changes — `id` is a server-side per-row `uuidv7()`,
 *    so a duplicated click would carry a fresh key, be indistinguishable from a
 *    real one, and be folded into the rollups.
 *
 * The alternative to all of this was making `ATTACH` take ACCESS EXCLUSIVE on the
 * parent, which would close the window by serialising inserts against the attach
 * — at the cost of blocking every insert for the duration of every attach. That
 * trade was considered and rejected when the lock modes were chosen (see
 * `drizzle/0014_retention_outcomes.sql`).
 */
export async function insertClickEvents(
  db: Database,
  events: ClickEvent[],
  options?: InsertClickEventsOptions,
): Promise<void> {
  if (events.length === 0) return;
  try {
    await insertOnce(db, events);
  } catch (err) {
    if (!isTransientPartitionRoutingError(err)) throw err;
    options?.onRetry?.(err);
    await insertOnce(db, events);
  }
}

async function insertOnce(db: Database, events: ClickEvent[]): Promise<void> {
  await db.insert(clickEvents).values(
    events.map((event) => ({
      linkId: event.linkId,
      workspaceId: event.workspaceId,
      occurredAt: event.occurredAt,
      visitorHash: event.visitorHash,
      country: event.country,
      city: event.city,
      device: event.device,
      browser: event.browser,
      os: event.os,
      referrerHost: event.referrerHost,
      isQr: event.isQr,
      isBot: event.isBot,
      blockedReason: event.blockedReason,
      matchedRuleId: event.matchedRuleId,
      variant: event.variant,
    })),
  );
}

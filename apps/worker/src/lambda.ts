import { deserializeClickEvent, insertClickEvents, resolveDatabaseUrl, runMigrations, type Database } from "@snapurl/database";
import { initDb, log, runFrequent, runMaintenance, runProjection } from "./main.js";
import { backfillClickPartitions } from "./jobs/rollup.js";

/* The worker as a Lambda, dispatched by a `task` discriminator.
 *
 * EventBridge invokes it on two schedules (see infra/lib/snapurl-stack.ts):
 * a 1-minute rule carrying `{ "task": "frequent" }` and an hourly rule
 * carrying `{ "task": "maintenance" }`. Frequent drains the click queue and
 * refreshes the rollups; maintenance does the hourly housekeeping
 * (partition provisioning, salt rotation, retention). Splitting them matters
 * because the handler used to run BOTH on every invocation while the only
 * rule fired every minute — so the hourly job actually ran 60x/hour against a
 * shared t4g.micro. Now each schedule runs exactly one job.
 *
 * The `task` values:
 *   - `"migrate"`            -> apply database migrations (see below).
 *   - `"backfill"`           -> provision historical day-partitions out of the
 *                               DEFAULT partition, in bounded committed chunks
 *                               (see below). A one-time adoption/repair op an
 *                               operator triggers manually, on no schedule.
 *   - `"maintenance"`        -> runMaintenance only.
 *   - `"frequent"`           -> runProjection + runFrequent.
 *   - `"rollup"`             -> runProjection + runFrequent (back-compat alias
 *                               for the old payload; the previous handler
 *                               treated a no-payload/rollup invocation as the
 *                               recurring job).
 *   - default / no payload   -> runProjection + runFrequent.
 *
 * The DEFAULT partition still guarantees inserts never fail between the hourly
 * ensureClickPartitions runs, so moving maintenance off the 1-minute cadence
 * costs no clicks (per the #268 partitioning design).
 *
 * Migrations live here because this is the only place they can run. RDS sits
 * in isolated subnets with publiclyAccessible false, so there is no route to
 * it from a laptop -- `pnpm db:migrate` cannot reach a deployed environment.
 * The Lambdas are inside the VPC, and this image already ships the migration
 * SQL, so it is the one process that can.
 *
 * It is a separate task rather than something the schedule does, because
 * migrations should run when someone decides to run them. A scheduled
 * migration is a schema change nobody was watching — which is why migrate is
 * on no schedule at all and only ever runs on a manual invocation.
 *
 * The `backfill` task exists for the same reason and on the same path (#294).
 * An operator adopting the partitioned `click_events` schema WITH pre-existing
 * legacy rows needs to provision one dated partition per historical day, and
 * `backfillClickPartitions` does that in bounded committed chunks so the lock
 * footprint never scales with how old the database is. On the AWS profile RDS
 * is reachable only through this Lambda (the same reason `migrate` is a Lambda
 * task), so the backfill must have a task discriminator here or the
 * SELF-HOSTING runbook's "trigger it once, after the migrate step" instruction
 * has nothing to invoke. It is a one-time adoption/repair op, deliberately not
 * on any schedule and not folded into runMaintenance's hourly loop (running it
 * every hour would rescan the DEFAULT partition for nothing).
 *
 * The SECOND invocation path (#288 3b): an SQS event source mapping. On the
 * AWS profile the redirect sends each click to an SQS queue (SqsClickSink), and
 * the Lambda service polls that queue OUTSIDE the VPC and invokes this function
 * with an event shaped { Records: [{ messageId, body, ... }] } — no `task`. We
 * detect that shape before the task branches and drain the batch into
 * click_events, the same table PostgresClickSink writes, using the shared
 * insertClickEvents. Failed records are reported back via batchItemFailures so
 * the mapping (configured with reportBatchItemFailures) redrives only those,
 * not the whole batch. The rollups then fold these rows as usual.
 */
export interface WorkerEvent {
  task?: "frequent" | "maintenance" | "rollup" | "migrate" | "backfill";
  /** Optional per-chunk day bound for the `backfill` task, forwarded to
   *  backfillClickPartitions as its chunkSize. Omitted uses the routine's own
   *  default (CLICK_EVENTS_BACKFILL_CHUNK_DAYS). Ignored by every other task. */
  chunkSize?: number;
}

/** One record as an SQS event source mapping delivers it. Only the two fields
 *  the consumer needs are typed; the mapping supplies many more. */
interface SqsRecord {
  messageId: string;
  body: string;
}

/** The event an SQS event source mapping invokes the Lambda with. */
interface SqsEvent {
  Records: SqsRecord[];
}

/** The partial-batch-failure response the mapping expects when
 *  reportBatchItemFailures is on: the messageId of every record that must be
 *  retried, and only those. An empty list means the whole batch succeeded. */
interface SqsBatchResponse {
  batchItemFailures: Array<{ itemIdentifier: string }>;
}

/** Drain a batch of click messages into click_events with partial-batch-failure
 *  reporting. Each record is inserted independently so one poison message (an
 *  unparseable body, a row the database rejects) is the only one redriven — the
 *  rest still land. Returns the messageIds that failed. */
async function drainClickBatch(db: Database, records: SqsRecord[]): Promise<SqsBatchResponse> {
  const batchItemFailures: Array<{ itemIdentifier: string }> = [];
  for (const record of records) {
    try {
      const event = deserializeClickEvent(record.body);
      /* A retry means the click was saved, so this is a warn, not an error. The
         rate is the signal: steady retries mean partition provisioning has
         fallen behind and the DEFAULT partition is taking live traffic (#329). */
      await insertClickEvents(db, [event], {
        onRetry: (err) =>
          log.warn(
            { err, messageId: record.messageId },
            "click insert lost its partition route to a concurrent attach — retried",
          ),
      });
    } catch {
      /* Report this one for redrive and keep going. The mapping retries only
         the reported ids up to the queue's maxReceiveCount, after which they
         land in the DLQ — one bad message never fails the batch. */
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures };
}

export const handler = async (event: WorkerEvent | SqsEvent = {}) => {
  /* The SQS event source mapping path: detected by the Records array BEFORE the
     task discriminator, because an SQS event carries no `task`. */
  if (Array.isArray((event as SqsEvent).Records)) {
    const { db } = await initDb();
    return drainClickBatch(db, (event as SqsEvent).Records);
  }

  const workerEvent = event as WorkerEvent;
  if (workerEvent.task === "migrate") {
    /* Resolve via the shared resolver so migrations work under the ARN path
       too: with DATABASE_SECRET_ARN set this fetches the credentials from
       Secrets Manager; with no ARN it returns process.env.DATABASE_URL
       unchanged and makes no SDK call. The throw stays for the case where
       neither an ARN nor a plain URL yields a value. */
    const url = await resolveDatabaseUrl();
    if (!url) throw new Error("DATABASE_URL is not set on this function.");
    const result = await runMigrations(url, process.env.DATABASE_SSL === "true");
    return { task: "migrate", ...result };
  }

  /* The db handle is created once by initDb() and memoised for the lifetime of
     the execution environment. Lambda reuses a warm container across
     invocations, so the connection survives between runs rather than being
     rebuilt every minute, and it is deliberately never closed at the end of a
     call. initDb() also resolves the secret at cold start before the first
     connection is made. Shared by the frequent, maintenance and backfill
     branches. */
  const { db } = await initDb();

  if (workerEvent.task === "maintenance") {
    const maintenance = await runMaintenance(db);
    return { task: "maintenance", maintenance };
  }

  if (workerEvent.task === "backfill") {
    /* The one-time historical provisioning pass (#294). Uses the same warm db
       handle as the scheduled jobs; unlike migrate it needs a connection rather
       than just a URL, because backfillClickPartitions drives the SQL helper one
       committed chunk at a time. An optional chunkSize on the event overrides
       the CLICK_EVENTS_BACKFILL_CHUNK_DAYS default for this run. Returns the
       run's shape ({ provisioned, chunks }) so the operator can see progress and
       re-invoke if it was interrupted (it is idempotent). */
    const result = await backfillClickPartitions(db, workerEvent.chunkSize);
    return { task: "backfill", ...result };
  }

  /* Everything else — the 1-minute frequent schedule, the "rollup" back-compat
     alias, and a bare no-payload invocation — runs the frequent job. Outbox
     draining (runProjection) is a separate function from runFrequent (see
     main.ts) so the long-running worker loop can put it on its own faster
     timer; a scheduled Lambda invocation has no such loop; it just runs both
     back to back and folds the result into the same `frequent` shape this
     handler has always returned. */
  const outbox = await runProjection(db);
  const frequent = await runFrequent(db);
  return { task: "frequent", frequent: { ...frequent, outbox } };
};

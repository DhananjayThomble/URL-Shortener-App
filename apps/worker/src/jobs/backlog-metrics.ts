import { sql, type Database } from "@snapurl/database";

/* ============================================================
   #996 — backlog metrics for CloudWatch alarms.

   Two of the alarms the launch-readiness work asks for — "projection-outbox
   backlog" and "webhook backlog" — are COUNTS OF ROWS in Postgres, not an
   AWS-native metric like a Lambda error or an SQS queue depth. CloudWatch
   cannot alarm on a number that only exists inside the database, so something
   has to lift those counts out to CloudWatch first. This job is that lift.

   It emits the counts as a CloudWatch EMBEDDED METRIC FORMAT (EMF) log line
   rather than calling PutMetricData:

     • EMF is a specially-shaped JSON line on stdout. In Lambda, stdout already
       goes to the function's CloudWatch Logs group, and CloudWatch extracts the
       metric from the log automatically — so there is NO new AWS SDK dependency,
       NO PutMetricData API call on the hot maintenance path, and NO extra IAM
       grant (the worker already writes its own log group). The alternative,
       @aws-sdk/client-cloudwatch + a cloudwatch:PutMetricData grant, buys
       nothing here and costs a dependency and a permission.
     • A metric is published only when this line is written, and EMF counts a
       period with no line as "no data", not zero. The alarms are therefore
       configured treatMissingData: notBreaching (see the stack) so a worker
       that is simply idle never pages anyone.

   GUARDED on BACKLOG_METRICS_NAMESPACE: the long-running local/dev/k8s worker
   sets nothing and this job is a no-op (returns null, writes no line), so only
   the AWS Lambda worker — where the CDK stack sets the namespace — emits. That
   keeps the change invisible to every non-AWS profile, exactly like the
   LINK_PROJECTION / CACHE_DRIVER env guards already in this worker.

   The counts mirror AdminHealthService.backlogs() so the panel and the alarm
   read the same definition of "backlog":
     outbox_pending  — unprocessed outbox rows still under the retry ceiling
     outbox_stuck    — unprocessed outbox rows that have given up (dead-lettered)
     webhook_pending — webhook deliveries queued for delivery
     webhook_failed  — webhook deliveries that exhausted their retry ladder
   ============================================================ */

/* The outbox retry ceiling (apps/worker/src/jobs/outbox.ts MAX_ATTEMPTS) and
   the webhook backoff-ladder length (apps/worker/src/jobs/webhooks.ts
   MAX_ATTEMPTS = BACKOFF_MINUTES.length). Duplicated as module constants here —
   both are module-private in their own files — and held in step so "stuck"
   means exactly what the drain and the health panel mean by it. */
const OUTBOX_MAX_ATTEMPTS = 8;

export interface BacklogCounts {
  outboxPending: number;
  outboxStuck: number;
  webhookPending: number;
  webhookFailed: number;
}

/** Read the four backlog counts off the live tables in one round trip. */
export async function readBacklogCounts(db: Database): Promise<BacklogCounts> {
  const rows = (await db.execute(sql`
    select
      (select count(*)::int from projection_outbox
         where processed_at is null and attempts < ${OUTBOX_MAX_ATTEMPTS}) as outbox_pending,
      (select count(*)::int from projection_outbox
         where processed_at is null and attempts >= ${OUTBOX_MAX_ATTEMPTS}) as outbox_stuck,
      (select count(*)::int from webhook_deliveries
         where status = 'pending') as webhook_pending,
      (select count(*)::int from webhook_deliveries
         where status = 'failed') as webhook_failed
  `)) as unknown as Array<{
    outbox_pending: number;
    outbox_stuck: number;
    webhook_pending: number;
    webhook_failed: number;
  }>;
  const r = rows[0];
  return {
    outboxPending: r?.outbox_pending ?? 0,
    outboxStuck: r?.outbox_stuck ?? 0,
    webhookPending: r?.webhook_pending ?? 0,
    webhookFailed: r?.webhook_failed ?? 0,
  };
}

/** Build the CloudWatch EMF log object for the given counts and namespace.
 *  Exported so a test can assert the exact shape CloudWatch extracts without
 *  having to intercept stdout. The metric names here are what the stack's
 *  alarms reference by (namespace, metricName). */
export function buildEmf(namespace: string, counts: BacklogCounts, timestamp = Date.now()): Record<string, unknown> {
  return {
    _aws: {
      Timestamp: timestamp,
      CloudWatchMetrics: [
        {
          Namespace: namespace,
          Dimensions: [[]],
          Metrics: [
            { Name: "OutboxPending", Unit: "Count" },
            { Name: "OutboxStuck", Unit: "Count" },
            { Name: "WebhookPending", Unit: "Count" },
            { Name: "WebhookFailed", Unit: "Count" },
          ],
        },
      ],
    },
    OutboxPending: counts.outboxPending,
    OutboxStuck: counts.outboxStuck,
    WebhookPending: counts.webhookPending,
    WebhookFailed: counts.webhookFailed,
  };
}

/**
 * Read the backlog counts and, when BACKLOG_METRICS_NAMESPACE is set, emit them
 * as one EMF line on stdout for CloudWatch to extract. Returns the counts it
 * read (or null when the guard env is unset and nothing was emitted) so a
 * caller — the maintenance pass — can fold them into its own summary.
 *
 * Writes the EMF line with a bare `console.log(JSON.stringify(...))`, NOT the
 * pino logger: CloudWatch's EMF extractor needs the metric object at the TOP
 * LEVEL of the log line, and pino wraps everything under its own envelope
 * (level, time, msg, and the payload nested under a key), which the extractor
 * would not recognise.
 */
export async function emitBacklogMetrics(db: Database): Promise<BacklogCounts | null> {
  const namespace = process.env.BACKLOG_METRICS_NAMESPACE;
  const counts = await readBacklogCounts(db);
  if (!namespace) return null;
  // eslint-disable-next-line no-console -- EMF must be a raw top-level JSON line, not a pino envelope.
  console.log(JSON.stringify(buildEmf(namespace, counts)));
  return counts;
}

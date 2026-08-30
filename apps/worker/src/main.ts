import pino from "pino";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { CloudFrontKeyValueStoreClient } from "@aws-sdk/client-cloudfront-keyvaluestore";
import { createDatabase, resolveDatabaseUrl, type Database } from "@snapurl/database";
import { ensureClickPartitions, pruneRetention, rollupClicks, rotateSalts } from "./jobs/rollup.js";
import { NoProjection, drainOutbox, pruneOutbox, stuckProjections, sweepExpired, type ProjectionTarget } from "./jobs/outbox.js";
import { DynamoProjection } from "./jobs/dynamo-projection.js";
import { KvsWriter } from "./jobs/kvs-projection.js";
import { deliverWebhooks, pruneDeliveries } from "./jobs/webhooks.js";

/* ============================================================
   The worker.

   Every job below is an exported function taking a Database, so
   the same implementation runs three ways: this loop locally, an
   EventBridge-scheduled Lambda in production, and `--once` in a
   test. Nothing about the schedule lives inside the jobs.
   ============================================================ */

const log = pino({ level: process.env.LOG_LEVEL ?? "info" });
const ROLLUP_SECONDS = Number(process.env.ROLLUP_INTERVAL_SECONDS ?? 30);
const MAINTENANCE_SECONDS = Number(process.env.MAINTENANCE_INTERVAL_SECONDS ?? 3600);

/* Four for the long-running process; the scheduled Lambda sets this to 1,
   where every extra connection is idle and counted against RDS's limit. */
const POOL_MAX = Number(process.env.DATABASE_POOL_MAX ?? 4);

/* The replica URL and SSL settings are plumbed through for consistency, but the
   worker deliberately runs every job on the PRIMARY `db` handle: rollups drain
   click_events then mark them consumed, retention prunes what it has just
   counted, and so on — every worker read is part of a read-then-write logical
   operation. Reading those from a lagging replica would double-count or skip
   rows, so there is no readDb here on purpose.

   The connection used to be created at import. It is now deferred behind
   initDb() so that, when DATABASE_SECRET_ARN is set, the credentials are
   resolved from Secrets Manager at cold start BEFORE any connection is made.
   With no ARN set, resolveDatabaseUrl returns the plain env value (or the
   compose default below) and no SDK call happens — the plain-env path is
   unchanged. The handle is memoised: created once and reused across warm Lambda
   invocations, never closed between calls. */
let dbHandle: { db: Database; close: () => Promise<void> } | undefined;
let initPromise: Promise<{ db: Database; close: () => Promise<void> }> | undefined;

/** Resolve secrets and create the database connection once, reusing it across
 *  warm invocations. Concurrent callers share the same in-flight promise. */
export function initDb(): Promise<{ db: Database; close: () => Promise<void> }> {
  if (dbHandle) return Promise.resolve(dbHandle);
  if (!initPromise) {
    initPromise = (async () => {
      const url =
        (await resolveDatabaseUrl()) ?? "postgres://snapurl:snapurl@localhost:5433/snapurl";
      const handle = createDatabase({
        url,
        replicaUrl: process.env.DATABASE_REPLICA_URL,
        ssl: process.env.DATABASE_SSL === "true",
        sslNoVerify: process.env.DATABASE_SSL_NO_VERIFY === "true",
        sslCaCert: process.env.DATABASE_CA_CERT,
        max: POOL_MAX,
      });
      dbHandle = handle;
      return handle;
    })();
  }
  return initPromise;
}

/** The resolved database handle. Throws if accessed before initDb() resolves. */
export function getDb(): Database {
  if (!dbHandle) throw new Error("initDb() must be awaited before getDb().");
  return dbHandle.db;
}

/** Close the connection if one was opened. Safe to call when none was. */
export async function close(): Promise<void> {
  if (dbHandle) await dbHandle.close();
}

/* Which projection target the outbox drains into, keyed on LINK_PROJECTION:

     'dynamo' -> DynamoProjection, writing the DynamoDB projection the AWS
                 redirect resolves against (LINK_PROJECTION_TABLE names the
                 table; region from the standard AWS_REGION env).
     anything else / unset -> NoProjection, the no-op default. The single-node
                 and Kubernetes workers keep using it — the redirect reads
                 Postgres directly there, so there is nothing to project.

   Built once and reused across warm Lambda invocations, mirroring the memoised
   db handle. The DynamoDB path needs the db handle to read a link's config for
   an upsert, so the target is resolved lazily against the passed database
   rather than at import (which would open no Postgres connection either way). */
const LINK_PROJECTION = process.env.LINK_PROJECTION ?? "none";
let projectionTarget: ProjectionTarget | undefined;

/* An OPTIONAL endpoint override for the DynamoDB client. Unset in production
   (the client resolves the real regional endpoint); set to something like
   http://localhost:8000 in CI so the writer targets a dynamodb-local container.
   AWS_ENDPOINT_URL_DYNAMODB takes precedence over the service-agnostic
   AWS_ENDPOINT_URL, matching the SDK's own precedence, and both being unset
   returns undefined so `endpoint` is simply omitted — a genuine no-op. */
function dynamoEndpoint(): string | undefined {
  return process.env.AWS_ENDPOINT_URL_DYNAMODB ?? process.env.AWS_ENDPOINT_URL ?? undefined;
}

/* The same endpoint-override pattern as dynamoEndpoint(), for the CloudFront
   KeyValueStore client (#289 edge fast path). Unset in production so the SDK
   resolves the real (global) cloudfront-keyvaluestore endpoint;
   AWS_ENDPOINT_URL_CLOUDFRONT_KEYVALUESTORE (or the generic AWS_ENDPOINT_URL)
   points it at a stub in CI. Both unset returns undefined, a genuine no-op. */
function kvsEndpoint(): string | undefined {
  return (
    process.env.AWS_ENDPOINT_URL_CLOUDFRONT_KEYVALUESTORE ??
    process.env.AWS_ENDPOINT_URL ??
    undefined
  );
}

function projectionFor(database: Database): ProjectionTarget {
  if (!projectionTarget) {
    if (LINK_PROJECTION === "dynamo") {
      const table = process.env.LINK_PROJECTION_TABLE;
      if (!table) throw new Error("LINK_PROJECTION=dynamo requires LINK_PROJECTION_TABLE to be set.");
      /* endpoint is left undefined in production so the SDK talks to the real
         regional DynamoDB endpoint. It is set ONLY when AWS_ENDPOINT_URL_DYNAMODB
         (or the generic AWS_ENDPOINT_URL) is present, which is how CI points the
         writer at a dynamodb-local container — a strict no-op when unset.

         removeUndefinedValues is REQUIRED, not an optimisation: a projected
         link carries many optional fields (utm with only some of
         source/medium/campaign/content set, routing rules whose when.device /
         when.language / weight are absent), and a ResolvedLink read from
         Postgres surfaces those absent JSON keys as `undefined`. Without this
         flag lib-dynamodb's marshaller THROWS on the first undefined attribute
         value, which fails the whole BatchWriteCommand — so a single link with
         a partial utm object stops the entire projection batch and the redirect
         resolves nothing (every /:slug 404s). Stripping undefined values here
         projects exactly the fields that are set, and the reader revives them
         identically, so the DynamoDB item matches the Postgres row. */
      const client = DynamoDBDocumentClient.from(
        new DynamoDBClient({ region: process.env.AWS_REGION, endpoint: dynamoEndpoint() }),
        { marshallOptions: { removeUndefinedValues: true } },
      );
      /* #289 edge fast path: OPT-IN. Only when LINK_PROJECTION_KVS_ARN is set do
         we construct a CloudFront KeyValueStore client and a KvsWriter and hand
         it to the DynamoProjection, so each edge-eligible upsert ALSO PutKeys
         {destination, redirectType} into the store the CloudFront Function
         reads, and each ineligible-or-removed link DeleteKeys it. When the env
         is UNSET the writer is undefined and behaviour is exactly as today: the
         DynamoDB projection still writes; nothing touches KVS. The client uses
         the standard AWS_REGION and the same optional endpoint-override pattern
         as the DynamoDB client (for CI/local). */
      const kvsArn = process.env.LINK_PROJECTION_KVS_ARN;
      const kvsWriter = kvsArn
        ? new KvsWriter(
            new CloudFrontKeyValueStoreClient({
              region: process.env.AWS_REGION,
              endpoint: kvsEndpoint(),
            }),
            kvsArn,
          )
        : undefined;
      /* Pass the worker's logger so a projection resolve/write failure surfaces
         the ACTUAL error (DynamoDB ValidationException name + message) at error
         level. drainOutbox only stores String(err) in projection_outbox
         .last_error and counts the failure, so before this the real cause never
         reached a log line — a projection that wrote nothing looked silent even
         at LOG_LEVEL=debug. */
      projectionTarget = new DynamoProjection(database, client, table, log, kvsWriter);
    } else {
      projectionTarget = new NoProjection();
    }
  }
  return projectionTarget;
}

/** Runs often: this is the loop that makes the dashboards current. */
export async function runFrequent(database: Database) {
  const rolled = await rollupClicks(database);
  const outbox = await drainOutbox(database, projectionFor(database));
  const webhooks = await deliverWebhooks(database);

  if (rolled.events || outbox.processed || outbox.failed || webhooks.sent || webhooks.failed) {
    log.info(
      {
        clicks: rolled.events,
        days: rolled.days,
        projected: outbox.processed,
        projectionFailures: outbox.failed,
        webhooksSent: webhooks.sent,
        webhookFailures: webhooks.failed,
      },
      "frequent pass",
    );
  }
  return { rolled, outbox, webhooks };
}

/** Runs hourly: housekeeping, and the jobs that keep the privacy promise. */
export async function runMaintenance(database: Database) {
  /* First, because click_events is partitioned by day and this is what keeps a
     partition ready for every day that could receive a click.

     Isolated, because being first means a throw here would skip everything
     below it — including rotateSalts, which carries the hardest privacy
     commitment in the product: once a day's salt is gone, that day's visitor
     hashes cannot be recomputed from an IP by anyone. Losing that to a
     partition lock is the wrong trade, and provisioning is an optimisation
     anyway: the DEFAULT partition is what actually guarantees an insert cannot
     fail, so a pass that provisions nothing still loses no clicks. */
  let partitions = 0;
  try {
    partitions = await ensureClickPartitions(database);
  } catch (err) {
    log.error({ err }, "partition provisioning failed; clicks will land in the default partition");
  }

  const expired = await sweepExpired(database);
  const salts = await rotateSalts(database);
  const pruned = await pruneRetention(database);
  const outbox = await pruneOutbox(database);
  const deliveries = await pruneDeliveries(database);
  const stuck = await stuckProjections(database);

  log.info(
    {
      partitionsReady: partitions,
      expired,
      saltsDropped: salts,
      /* Reported separately because they cost wildly different amounts. A
         dropped partition is a catalogue change; a deleted row is WAL, bloat
         and vacuum work. A steadily non-zero rowsDeleted means workspaces are
         using mixed retention settings, which is supported but not free. */
      clickPartitionsDropped: pruned.partitionsDropped,
      clickRowsDeleted: pruned.rowsDeleted,
      outboxPruned: outbox,
      deliveriesPruned: deliveries,
    },
    "maintenance pass",
  );

  /* A stuck projection means the edge is serving link config that the
     dashboard believes was changed. That is a correctness problem, not a
     backlog, so it is logged at error even though nothing is on fire. */
  if (stuck > 0) {
    log.error({ stuck }, "projection rows have exhausted their retries — the edge may be serving stale link config");
  }

  return { partitions, expired, salts, pruned, outbox, deliveries, stuck };
}

/** Guard against a slow pass overlapping the next tick. */
function everyN(seconds: number, job: () => Promise<unknown>) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await job();
    } catch (err) {
      log.error({ err }, "job failed");
    } finally {
      running = false;
    }
  };
  void tick();
  return setInterval(tick, seconds * 1000);
}

async function main() {
  const { db } = await initDb();

  if (process.argv.includes("--once")) {
    const frequent = await runFrequent(db);
    const maintenance = await runMaintenance(db);
    log.info({ frequent, maintenance }, "single pass complete");
    await close();
    return;
  }

  log.info({ rollupSeconds: ROLLUP_SECONDS, maintenanceSeconds: MAINTENANCE_SECONDS }, "worker started");
  const timers = [
    everyN(ROLLUP_SECONDS, () => runFrequent(db)),
    everyN(MAINTENANCE_SECONDS, () => runMaintenance(db)),
  ];

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, async () => {
      timers.forEach(clearInterval);
      await close();
      process.exit(0);
    });
  }
}

/* Only start the loop when this file is the process entrypoint.
 *
 * dist/lambda.js imports runFrequent and runMaintenance from here, and an
 * unguarded main() would start a 30-second interval inside a Lambda that is
 * about to be frozen — burning the invocation's time budget on work nobody
 * asked for, then being suspended mid-flight. */
if (require.main === module) {
  main().catch((err) => {
    log.error({ err }, "worker failed to start");
    process.exit(1);
  });
}

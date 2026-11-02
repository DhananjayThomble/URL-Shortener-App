import pino from "pino";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { CloudFrontKeyValueStoreClient } from "@aws-sdk/client-cloudfront-keyvaluestore";
/* The CloudFront KeyValueStore data-plane API is a GLOBAL (multi-region) service,
   so its client signs with SigV4a, not plain SigV4. AWS SDK v3 does NOT bundle the
   SigV4a implementation and does NOT auto-load it: the multi-region signer looks up
   signatureV4aContainer.SignatureV4a at signing time and, finding it unset, throws
   "Neither CRT nor JS SigV4a implementation is available". Importing this package
   for its side effect registers the pure-JS SigV4a signer into that container. It
   MUST be imported (a package.json dependency alone is inert) and must load before
   the KVS client signs any request — a top-level side-effect import guarantees both.
   Without it every PutKey/DeleteKey/DescribeKeyValueStore fails and the #289 edge
   fast path never fills, silently, with redirects still served by the Lambda. */
import "@aws-sdk/signature-v4a";
import { resolve as dnsResolve } from "node:dns/promises";
import { createDatabase, resolveDatabaseUrl, resolveSafeBrowsingApiKey, type Database } from "@snapurl/database";
import { DynamoDbCacheStore, type CacheStore } from "@snapurl/cache";
import { ensureClickPartitions, pruneRetention, rollupClicks, rotateSalts } from "./jobs/rollup.js";
import { makeSafeBrowsingScanner, type UrlScanner } from "./jobs/safe-browsing.js";
import {
  DEFAULT_RESCAN_CONFIG,
  rescanLinks,
  reputationWatch,
  type DomainBlocklistLookup,
  type ReputationHit,
} from "./jobs/link-scanning.js";
import { NoProjection, backfillDomainMeta, drainOutbox, pruneOutbox, stuckProjections, sweepExpired, type ProjectionTarget } from "./jobs/outbox.js";
import { DynamoProjection } from "./jobs/dynamo-projection.js";
import { KvsWriter } from "./jobs/kvs-projection.js";
import { deliverWebhooks, pruneDeliveries } from "./jobs/webhooks.js";
import { emitBacklogMetrics } from "./jobs/backlog-metrics.js";
import { applyDuePlanChanges } from "./jobs/plan-changes.js";

/* ============================================================
   The worker.

   Every job below is an exported function taking a Database, so
   the same implementation runs three ways: this loop locally, an
   EventBridge-scheduled Lambda in production, and `--once` in a
   test. Nothing about the schedule lives inside the jobs.
   ============================================================ */

/* Exported so the Lambda entrypoint logs through the same instance rather than
   creating a second pino with its own level and destination. */
export const log = pino({ level: process.env.LOG_LEVEL ?? "info" });
const ROLLUP_SECONDS = Number(process.env.ROLLUP_INTERVAL_SECONDS ?? 30);
/* Defaults to ROLLUP_SECONDS so nothing needs to change to keep today's
   cadence — the dynamo-smoke CI job's ROLLUP_INTERVAL_SECONDS=0.25 already
   governs this too, unless PROJECTION_INTERVAL_SECONDS overrides it
   separately. See runProjection's header for why this runs on its own timer
   rather than as a step inside runFrequent's. */
const PROJECTION_SECONDS = Number(process.env.PROJECTION_INTERVAL_SECONDS ?? ROLLUP_SECONDS);
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

/* #620: the hot-link cache buster handed to the DynamoProjection so the worker
   evicts a link's redirect-cache entry AFTER both the DynamoDB and edge-KVS
   writes for a delete/flag op have landed — closing the window where a request
   between the API's pre-drain bust and this drain re-caches the stale entry for
   up to LINK_CACHE_TTL_SECONDS (see DynamoProjection's cache param).

   OPT-IN and built directly (not via createCacheStore, which is async): only
   when CACHE_DRIVER=dynamodb + CACHE_DYNAMO_TABLE are set — the exact pairing
   the CDK stack wires on the worker — do we construct a DynamoDbCacheStore over
   the SAME table the redirect reads and the API busts. When either env is unset
   the buster is undefined and the projection makes ZERO cache calls, so every
   non-AWS profile (and any worker without the shared cache configured) is
   unchanged. The region/endpoint-override pattern matches the DynamoDB
   projection and KVS clients so CI can point it at dynamodb-local; the
   marshaller strips undefined for symmetry with those clients, though a bust is
   a bare DeleteItem on a key and never marshals an item. */
let cacheBusterStore: CacheStore | undefined;
function cacheBuster(): CacheStore | undefined {
  if ((process.env.CACHE_DRIVER ?? "memory") !== "dynamodb") return undefined;
  const cacheTable = process.env.CACHE_DYNAMO_TABLE;
  if (!cacheTable) return undefined;
  cacheBusterStore ??= new DynamoDbCacheStore(
    DynamoDBDocumentClient.from(
      new DynamoDBClient({ region: process.env.AWS_REGION, endpoint: dynamoEndpoint() }),
      { marshallOptions: { removeUndefinedValues: true } },
    ),
    cacheTable,
  );
  return cacheBusterStore;
}

/* #994 — the Safe Browsing scanner the rescan job and the reputation watch
   share. Built once from the API key resolved at cold start (Secrets Manager
   via the ARN, or the plain env var, or neither — in which case it scans every
   URL "clean" without a network call, exactly as the API documents). Memoised
   across warm invocations like the db handle. A one-time warn is logged when no
   key is configured so a silently-off scanner is discoverable. */
let safeBrowsingScanner: UrlScanner | undefined;
let safeBrowsingWarned = false;
async function scannerFor(): Promise<UrlScanner> {
  if (!safeBrowsingScanner) {
    const { apiKey, error } = await resolveSafeBrowsingApiKey();
    if (error) log.warn({ err: error }, "could not resolve the Safe Browsing API key — scanning is off");
    if (!apiKey && !safeBrowsingWarned) {
      safeBrowsingWarned = true;
      log.warn("GOOGLE_SAFE_BROWSING_API_KEY is not set — the rescan job marks links clean without scanning them");
    }
    safeBrowsingScanner = makeSafeBrowsingScanner(apiKey);
  }
  return safeBrowsingScanner;
}

/* #994 point 5 — the public domain-blocklist lookup (Spamhaus DBL by default).
   DBL is a DNS blocklist: a host is listed iff "<host>.dbl.spamhaus.org"
   resolves to a 127.0.1.x A record. A lookup that does not resolve (NXDOMAIN)
   means "not listed" — that is the normal case, and dnsResolve throwing
   ENOTFOUND is how DBL signals it, so a throw is treated as not-listed. The
   zone is overridable via DOMAIN_BLOCKLIST_ZONE; set it empty to turn the DBL
   check off (the lookup then always returns false). */
const domainBlocklistLookup: DomainBlocklistLookup = async (host: string): Promise<boolean> => {
  const zone = process.env.DOMAIN_BLOCKLIST_ZONE ?? "dbl.spamhaus.org";
  if (!zone) return false;
  try {
    const records = await dnsResolve(`${host}.${zone}`, "A");
    // DBL returns 127.0.1.2–127.0.1.99 for a listing; 127.255.255.x is an error
    // response (e.g. a query from an open resolver), which is NOT a listing.
    return records.some((ip) => ip.startsWith("127.0.1."));
  } catch {
    return false;
  }
};

/* Where a reputation hit on one of our own hosts is reported. Logged at error
   here (the single-node/Kubernetes worker); a production deployment can point
   REPUTATION_ALERT at an SNS topic, but the log line is always emitted so the
   signal is never silent. */
async function reputationAlert(hit: ReputationHit): Promise<void> {
  log.error({ host: hit.host, source: hit.source }, "reputation watch: one of our own hosts is LISTED");
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
      projectionTarget = new DynamoProjection(database, client, table, log, kvsWriter, cacheBuster());
    } else {
      projectionTarget = new NoProjection();
    }
  }
  return projectionTarget;
}

/** Drains the projection outbox — the ONLY thing standing between a link
 *  write and that link being resolvable from the DynamoDB projection (see
 *  @snapurl/database's link-projection module and DynamoLinkResolver).
 *
 *  Kept on its OWN timer (main()'s loop below), independent of runFrequent's
 *  rollupClicks + deliverWebhooks. It used to run as the middle step of
 *  runFrequent, so its effective cadence was hostage to however long the
 *  other two took on a given pass: rollupClicks runs a multi-statement
 *  transaction over click_events whose cost grows with click volume, and
 *  everyN's anti-overlap guard (see below) means a slow pass doesn't just
 *  delay that tick's drain — it pushes the NEXT tick's start out too, so the
 *  gap between a link's outbox insert and its projection could stretch well
 *  past the nominal interval under load. That is exactly the gap the
 *  LINK_PROJECTION=dynamo CI job's create-then-immediately-redirect smoke
 *  assertions race against (see verify.yml's dynamo-smoke job): a link
 *  created late in the smoke script's setup burst, then resolved moments
 *  later, could still 404 because its outbox row was still waiting on a slow
 *  rollup pass to finish. Running this alone keeps its cadence close to the
 *  configured interval regardless of what rollupClicks or deliverWebhooks are
 *  doing. */
export async function runProjection(database: Database) {
  const outbox = await drainOutbox(database, projectionFor(database));
  if (outbox.processed || outbox.failed) {
    log.info({ projected: outbox.processed, projectionFailures: outbox.failed }, "projection drain");
  }
  return outbox;
}

/** Runs often: this is the loop that makes the dashboards current. Outbox
 *  draining lives in the separate runProjection() (see its header) so its
 *  cadence is never hostage to how long rollupClicks or deliverWebhooks take
 *  here. */
export async function runFrequent(database: Database) {
  const rolled = await rollupClicks(database);
  const webhooks = await deliverWebhooks(database);

  /* #994 point 2 — rescan links due a re-check (pending within minutes, recent
     daily, click-burst). On the frequent timer so a pending link is re-checked
     within minutes of creation; the per-link cadence inside rescanLinks keeps
     the recent/burst sets to roughly daily. Isolated so a scanner outage never
     takes the rollup down. */
  let rescan = { scanned: 0, flagged: 0 };
  try {
    rescan = await rescanLinks(database, await scannerFor(), DEFAULT_RESCAN_CONFIG);
  } catch (err) {
    log.error({ err }, "link rescan pass failed");
  }

  if (rolled.events || webhooks.sent || webhooks.failed || rescan.scanned) {
    log.info(
      {
        clicks: rolled.events,
        days: rolled.days,
        webhooksSent: webhooks.sent,
        webhookFailures: webhooks.failed,
        rescanned: rescan.scanned,
        rescanFlagged: rescan.flagged,
      },
      "frequent pass",
    );
  }
  if (rescan.flagged > 0) {
    log.warn({ flagged: rescan.flagged }, "rescan flagged links that turned unsafe after creation — gated at the edge");
  }
  return { rolled, webhooks, rescan };
}

/** Runs hourly: housekeeping, and the jobs that keep the privacy promise. */
export async function runMaintenance(database: Database) {
  const failed: string[] = [];
  /** Kept next to the calls below so the all-failed check cannot drift from the
   *  number of jobs actually run. */
  const MAINTENANCE_JOB_COUNT = 9;

  /** Run one maintenance job without letting it take the others down.
   *
   *  Every job in this pass is independent — expiring salts has nothing to do
   *  with pruning webhook deliveries — so one throwing should cost that job, not
   *  the rest of the pass. Before this, only provisioning was isolated, and an
   *  unexpected error anywhere after it silently skipped everything below,
   *  including the privacy jobs. Silently is the operative word: the pass logged
   *  nothing, because it never reached its own log line.
   *
   *  Failures are collected and reported together, so a pass that half-worked
   *  says so instead of looking like a pass that had nothing to do. */
  const step = async <T>(name: string, job: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await job();
    } catch (err) {
      log.error({ err, job: name }, "maintenance job failed");
      failed.push(name);
      return fallback;
    }
  };

  /* Provisioning first, because it is what keeps a partition ready for every day
     that could receive a click. Its failure is the least alarming of the seven:
     the DEFAULT partition is what actually guarantees an insert cannot fail, so a
     pass that provisions nothing still loses no clicks — it only makes the
     queries less prunable until a later pass catches up. */
  const partitions = await step("ensureClickPartitions", () => ensureClickPartitions(database), {
    ready: 0,
    declined: 0,
  });
  const expired = await step("sweepExpired", () => sweepExpired(database), 0);
  const salts = await step("rotateSalts", () => rotateSalts(database), 0);
  const pruned = await step("pruneRetention", () => pruneRetention(database), {
    partitionsDropped: 0,
    rowsDeleted: 0,
    partitionsPinned: 0,
    partitionsContended: 0,
    partitionsMissing: 0,
  });
  const outbox = await step("pruneOutbox", () => pruneOutbox(database), 0);
  const deliveries = await step("pruneDeliveries", () => pruneDeliveries(database), 0);
  const stuck = await step("stuckProjections", () => stuckProjections(database), 0);

  /* #992 — apply plan changes whose effectiveAt has passed: period-end
     downgrades/changes and comp reverts. Hourly is fine — these are dated to a
     period end or a comp end date, not a per-second signal — and the sweep is
     idempotent, so a missed pass simply applies on the next one. Isolated like
     every sibling: a failure costs this job, not the privacy jobs. */
  const planChanges = await step("applyDuePlanChanges", () => applyDuePlanChanges(database), 0);

  /* #996: lift the projection-outbox and webhook backlog ROW COUNTS out to
     CloudWatch as an EMF metric line, so the launch-readiness alarms can watch
     them — CloudWatch cannot alarm on a count that only lives in Postgres.
     A no-op (returns null, emits nothing) unless BACKLOG_METRICS_NAMESPACE is
     set, which only the AWS Lambda worker is (by the CDK stack); every other
     profile is unchanged. Runs here, on the hourly pass, because the alarm
     periods are measured in tens of minutes — this is a trend signal, not a
     per-second gauge. Isolated like every sibling: a failure to read the
     counts costs this step, not the privacy jobs below-adjacent to it. */
  const backlog = await step("emitBacklogMetrics", () => emitBacklogMetrics(database), null);

  /* #994 point 5 — the domain reputation watch runs DAILY, not hourly: it is
     gated to the configured UTC hour (REPUTATION_WATCH_HOUR, default 0) so a
     maintenance pass fires it at most once a day. Kept OUT of the counted
     maintenance jobs above (and its own try/catch) so it never contributes to
     the all-failed check and a reputation-source outage never fails the pass.
     The alert sink always logs, so a hit is never silent. */
  const reputationHour = Number(process.env.REPUTATION_WATCH_HOUR ?? 0);
  if (new Date().getUTCHours() === reputationHour) {
    try {
      const rep = await reputationWatch({
        scan: await scannerFor(),
        domainBlocklist: domainBlocklistLookup,
        alert: reputationAlert,
      });
      log.info({ checked: rep.checked, hits: rep.hits.length }, "reputation watch pass");
    } catch (err) {
      log.error({ err }, "reputation watch pass failed");
    }
  }

  /* Isolation is per job, not for the pass as a whole.
   *
   * If every job failed, the cause is not a bad job — it is the database being
   * unreachable, or credentials being wrong — and swallowing that would leave the
   * invocation reporting success with a tidy object full of zeroes. That is the
   * shape of failure #323 and #326 were both about: a pass that did nothing,
   * looking exactly like a pass with nothing to do.
   *
   * Throwing hands the decision back to the scheduler, which is better placed to
   * make it: the EventBridge rule carries retryAttempts: 2, so a transient
   * outage gets two more chances inside the minute instead of waiting an hour. */
  if (failed.length === MAINTENANCE_JOB_COUNT) {
    throw new Error(`every maintenance job failed (${failed.join(", ")}) — the database is likely unreachable`);
  }

  log.info(
    {
      partitionsReady: partitions.ready,
      expired,
      saltsDropped: salts,
      /* Reported separately because they cost wildly different amounts. A
         dropped partition is a catalogue change; a deleted row is WAL, bloat
         and vacuum work. A steadily non-zero rowsDeleted means workspaces are
         using mixed retention settings, which is supported but not free. */
      clickPartitionsDropped: pruned.partitionsDropped,
      clickRowsDeleted: pruned.rowsDeleted,
      /* Only present when non-zero, so the ordinary pass stays readable and
         anything here is worth a second look. `pinned` and `missing` are both
         benign — a rollup yet to catch up, and a partition a concurrent pass got
         to first — but they are counted so they cannot hide inside a pass that
         merely looks idle. */
      ...(pruned.partitionsPinned > 0 ? { clickPartitionsPinned: pruned.partitionsPinned } : {}),
      ...(pruned.partitionsMissing > 0 ? { clickPartitionsMissing: pruned.partitionsMissing } : {}),
      ...(partitions.declined > 0 ? { partitionsDeclined: partitions.declined } : {}),
      outboxPruned: outbox,
      deliveriesPruned: deliveries,
      /* #992: present only when a scheduled plan change actually applied, so an
         ordinary pass with nothing due stays quiet. */
      ...(planChanges > 0 ? { planChangesApplied: planChanges } : {}),
      /* #996: the backlog counts emitted to CloudWatch this pass, present only
         when the metric is actually being emitted (BACKLOG_METRICS_NAMESPACE
         set, i.e. the AWS worker). Null on every other profile, so the ordinary
         local/k8s pass log is unchanged. */
      ...(backlog ? { backlog } : {}),
      /* Present only when something went wrong, so the happy path stays quiet
         and a partial pass is impossible to mistake for a complete one. */
      ...(failed.length > 0 ? { failedJobs: failed } : {}),
    },
    failed.length > 0 ? "maintenance pass completed with failures" : "maintenance pass",
  );

  /* A stuck projection means the edge is serving link config that the
     dashboard believes was changed. That is a correctness problem, not a
     backlog, so it is logged at error even though nothing is on fire. */
  if (stuck > 0) {
    log.error({ stuck }, "projection rows have exhausted their retries — the edge may be serving stale link config");
  }

  /* The one retention count worth acting on.
   *
   * Everything else the pass reports is either progress or a benign no-op.
   * Contention means partition maintenance could not take its locks before the
   * timeout, so it did no work — and a pass that keeps reporting it is a pass
   * making no progress while storage keeps growing. Until this was counted, that
   * state was indistinguishable from having nothing to drop: both read
   * `clickPartitionsDropped: 0`.
   *
   * Warn rather than error: one contended pass is normal under load and the next
   * one will very likely succeed. It is the pattern over time that matters, which
   * is what a metric filter on this line is for. */
  if (pruned.partitionsContended > 0) {
    log.warn(
      { contended: pruned.partitionsContended, dropped: pruned.partitionsDropped },
      "partition retention lost locks to write traffic — no progress on those days this pass",
    );
  }

  /* The provisioning half of the same signal, and it warns for the same reason.
   *
   * A declined day has no partition, so its clicks land in the DEFAULT
   * partition — which no query can prune and which the retention pass skips by
   * design. One declined day is nothing; a provisioner that never wins its lock
   * quietly accumulates rows somewhere they will sit for ever. That deserves the
   * same visibility as a retention pass making no progress, rather than being a
   * field on an info line that reads as success. */
  if (partitions.declined > 0) {
    log.warn(
      { declined: partitions.declined, ready: partitions.ready },
      "partition provisioning lost locks — those days' clicks will land in the default partition",
    );
  }

  return { partitions, expired, salts, pruned, outbox, deliveries, stuck, planChanges, backlog, failed };
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

  if (process.argv.includes("--backfill-domain-meta")) {
    // #713 item 5: one-off, idempotent; deploy the worker first (see outbox.ts).
    const enqueued = await backfillDomainMeta(db);
    const projection = await runProjection(db);
    log.info({ enqueued, projection }, "domain-meta backfill complete");
    await close();
    return;
  }

  if (process.argv.includes("--once")) {
    const projection = await runProjection(db);
    const frequent = await runFrequent(db);
    const maintenance = await runMaintenance(db);
    log.info({ projection, frequent, maintenance }, "single pass complete");
    await close();
    return;
  }

  log.info(
    { projectionSeconds: PROJECTION_SECONDS, rollupSeconds: ROLLUP_SECONDS, maintenanceSeconds: MAINTENANCE_SECONDS },
    "worker started",
  );
  const timers = [
    everyN(PROJECTION_SECONDS, () => runProjection(db)),
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
 * dist/lambda.js imports runProjection, runFrequent and runMaintenance from
 * here, and an
 * unguarded main() would start a 30-second interval inside a Lambda that is
 * about to be frozen — burning the invocation's time budget on work nobody
 * asked for, then being suspended mid-flight. */
if (require.main === module) {
  main().catch((err) => {
    log.error({ err }, "worker failed to start");
    process.exit(1);
  });
}

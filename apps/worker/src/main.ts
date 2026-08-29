import pino from "pino";
import { createDatabase, type Database } from "@snapurl/database";
import { ensureClickPartitions, pruneRetention, pruneVisitors, rollupClicks, rotateSalts } from "./jobs/rollup.js";
import { NoProjection, drainOutbox, pruneOutbox, stuckProjections, sweepExpired } from "./jobs/outbox.js";
import { deliverWebhooks, pruneDeliveries } from "./jobs/webhooks.js";

/* ============================================================
   The worker.

   Every job below is an exported function taking a Database, so
   the same implementation runs three ways: this loop locally, an
   EventBridge-scheduled Lambda in production, and `--once` in a
   test. Nothing about the schedule lives inside the jobs.
   ============================================================ */

const log = pino({ level: process.env.LOG_LEVEL ?? "info" });
const DATABASE_URL = process.env.DATABASE_URL ?? "postgres://snapurl:snapurl@localhost:5433/snapurl";
const ROLLUP_SECONDS = Number(process.env.ROLLUP_INTERVAL_SECONDS ?? 30);
const MAINTENANCE_SECONDS = Number(process.env.MAINTENANCE_INTERVAL_SECONDS ?? 3600);

/* Four for the long-running process; the scheduled Lambda sets this to 1,
   where every extra connection is idle and counted against RDS's limit. */
const POOL_MAX = Number(process.env.DATABASE_POOL_MAX ?? 4);

export const { db, close } = createDatabase({ url: DATABASE_URL, ssl: process.env.DATABASE_SSL === "true", max: POOL_MAX });
const projection = new NoProjection();

/** Runs often: this is the loop that makes the dashboards current. */
export async function runFrequent(database: Database) {
  const rolled = await rollupClicks(database);
  const outbox = await drainOutbox(database, projection);
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
  /* First, and deliberately so: click_events is partitioned by day, and this is
     what guarantees a partition exists for every day that could receive a
     click. Running it before anything that can fail means a maintenance pass
     which dies halfway has still done the one job the redirect path depends on. */
  const partitions = await ensureClickPartitions(database);
  const expired = await sweepExpired(database);
  const salts = await rotateSalts(database);
  const pruned = await pruneRetention(database);
  const visitors = await pruneVisitors(database);
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
      visitorsPruned: visitors,
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

  return { partitions, expired, salts, pruned, visitors, outbox, deliveries, stuck };
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

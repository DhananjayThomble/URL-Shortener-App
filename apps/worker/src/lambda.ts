import { resolveDatabaseUrl, runMigrations } from "@snapurl/database";
import { initDb, runFrequent, runMaintenance } from "./main.js";

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
 *   - `"maintenance"`        -> runMaintenance only.
 *   - `"frequent"`           -> runFrequent only.
 *   - `"rollup"`             -> runFrequent only (back-compat alias for the
 *                               old payload; the previous handler treated a
 *                               no-payload/rollup invocation as the recurring
 *                               job).
 *   - default / no payload   -> runFrequent only.
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
 */
export interface WorkerEvent {
  task?: "frequent" | "maintenance" | "rollup" | "migrate";
}

export const handler = async (event: WorkerEvent = {}) => {
  if (event.task === "migrate") {
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
     connection is made. Shared by both the frequent and maintenance branches. */
  const { db } = await initDb();

  if (event.task === "maintenance") {
    const maintenance = await runMaintenance(db);
    return { task: "maintenance", maintenance };
  }

  /* Everything else — the 1-minute frequent schedule, the "rollup" back-compat
     alias, and a bare no-payload invocation — runs the frequent job only. */
  const frequent = await runFrequent(db);
  return { task: "frequent", frequent };
};

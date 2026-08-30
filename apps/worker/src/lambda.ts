import { resolveDatabaseUrl, runMigrations } from "@snapurl/database";
import { initDb, runFrequent, runMaintenance } from "./main.js";

/* The worker as a Lambda, with two jobs.
 *
 * EventBridge invokes it on a schedule with no payload, which runs the
 * rollups. Passing `{ "task": "migrate" }` applies database migrations
 * instead.
 *
 * Migrations live here because this is the only place they can run. RDS sits
 * in isolated subnets with publiclyAccessible false, so there is no route to
 * it from a laptop -- `pnpm db:migrate` cannot reach a deployed environment.
 * The Lambdas are inside the VPC, and this image already ships the migration
 * SQL, so it is the one process that can.
 *
 * It is a separate task rather than something the schedule does, because
 * migrations should run when someone decides to run them. A scheduled
 * migration is a schema change nobody was watching.
 */
export interface WorkerEvent {
  task?: "rollup" | "migrate";
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
     connection is made. */
  const { db } = await initDb();
  const frequent = await runFrequent(db);
  const maintenance = await runMaintenance(db);
  return { task: "rollup", frequent, maintenance };
};

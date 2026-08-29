import { runMigrations } from "@snapurl/database";
import { db, runFrequent, runMaintenance } from "./main.js";

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
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set on this function.");
    const result = await runMigrations(url, process.env.DATABASE_SSL === "true");
    return { task: "migrate", ...result };
  }

  /* `db` is module-level on purpose. Lambda reuses a warm container across
     invocations, so the connection survives between runs rather than being
     rebuilt every minute. It is deliberately not closed at the end of a call:
     closing it would make the next warm invocation reconnect for nothing. */
  const frequent = await runFrequent(db);
  const maintenance = await runMaintenance(db);
  return { task: "rollup", frequent, maintenance };
};

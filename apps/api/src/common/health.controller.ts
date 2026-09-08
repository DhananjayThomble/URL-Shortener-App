import { Controller, Get, Inject, ServiceUnavailableException } from "@nestjs/common";
import { sql, type Database } from "@snapurl/database";
import { DB } from "../database/database.module.js";
import { Public } from "../auth/auth.guard.js";

@Controller("health")
export class HealthController {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** Checks the database too — a process that is up but cannot reach Postgres
   *  is not healthy, and a load balancer should know that. The unhealthy path
   *  therefore responds 503 (not a 200 body), so an LB / orchestrator that
   *  keys on the HTTP status code stops routing traffic to this instance. */
  @Public()
  @Get()
  async check() {
    const startedAt = Date.now();
    try {
      await this.db.execute(sql`select 1`);
      return { status: "ok", database: "ok", latencyMs: Date.now() - startedAt };
    } catch {
      throw new ServiceUnavailableException({
        status: "degraded",
        database: "unreachable",
        latencyMs: Date.now() - startedAt,
      });
    }
  }
}

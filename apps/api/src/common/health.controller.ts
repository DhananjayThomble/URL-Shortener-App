import { Controller, Get, Inject } from "@nestjs/common";
import { sql, type Database } from "@snapurl/database";
import { DB } from "../database/database.module.js";
import { Public } from "../auth/auth.guard.js";

@Controller("health")
export class HealthController {
  constructor(@Inject(DB) private readonly db: Database) {}

  /** Checks the database too — a process that is up but cannot reach Postgres
   *  is not healthy, and a load balancer should know that. */
  @Public()
  @Get()
  async check() {
    const startedAt = Date.now();
    try {
      await this.db.execute(sql`select 1`);
      return { status: "ok", database: "ok", latencyMs: Date.now() - startedAt };
    } catch {
      return { status: "degraded", database: "unreachable", latencyMs: Date.now() - startedAt };
    }
  }
}

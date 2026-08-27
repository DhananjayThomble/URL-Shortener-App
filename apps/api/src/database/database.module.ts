import { Global, Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import { createDatabase, type Database } from "@snapurl/database";
import { ENV } from "../config/env.js";
import type { Env } from "../config/env.js";

export const DB = Symbol("DB");
export const DB_HANDLE = Symbol("DB_HANDLE");

type Handle = ReturnType<typeof createDatabase>;

@Global()
@Module({
  providers: [
    {
      provide: DB_HANDLE,
      inject: [ENV],
      useFactory: (env: Env) =>
        createDatabase({ url: env.DATABASE_URL, ssl: env.DATABASE_SSL, max: env.DATABASE_POOL_MAX }),
    },
    { provide: DB, inject: [DB_HANDLE], useFactory: (h: Handle) => h.db },
  ],
  exports: [DB, DB_HANDLE],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DB_HANDLE) private readonly handle: Handle) {}

  /** Without this, a redeploy leaves connections held open against RDS's
   *  fairly small max_connections until they time out. */
  async onApplicationShutdown() {
    await this.handle.close();
  }
}

export type { Database };

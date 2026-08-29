import { Global, Inject, Module, type OnApplicationShutdown } from "@nestjs/common";
import { createDatabase, type Database } from "@snapurl/database";
import { ENV } from "../config/env.js";
import type { Env } from "../config/env.js";

export const DB = Symbol("DB");
/** Read-only handle. Points at the replica when DATABASE_REPLICA_URL is set,
 *  otherwise it is the same handle as DB. Only inject this for reads that are
 *  NOT part of a read-then-write operation — replica lag would make such reads
 *  stale relative to the write that follows. */
export const READ_DB = Symbol("READ_DB");
export const DB_HANDLE = Symbol("DB_HANDLE");

type Handle = ReturnType<typeof createDatabase>;

@Global()
@Module({
  providers: [
    {
      provide: DB_HANDLE,
      inject: [ENV],
      useFactory: (env: Env) =>
        createDatabase({
          url: env.DATABASE_URL,
          replicaUrl: env.DATABASE_REPLICA_URL,
          ssl: env.DATABASE_SSL,
          sslNoVerify: env.DATABASE_SSL_NO_VERIFY,
          sslCaCert: env.DATABASE_CA_CERT,
          max: env.DATABASE_POOL_MAX,
        }),
    },
    { provide: DB, inject: [DB_HANDLE], useFactory: (h: Handle) => h.db },
    { provide: READ_DB, inject: [DB_HANDLE], useFactory: (h: Handle) => h.readDb },
  ],
  exports: [DB, READ_DB, DB_HANDLE],
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

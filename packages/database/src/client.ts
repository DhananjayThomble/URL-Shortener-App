import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

export type Database = ReturnType<typeof createDatabase>["db"];

/** What a callback passed to db.transaction() receives. It is NOT a Database —
 *  it has no $client — so anything that runs both inside and outside a
 *  transaction has to accept this union. */
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
export type Executor = Database | Transaction;

export interface DatabaseOptions {
  url: string;
  /** Lambda gets 1 — a function instance serves one request at a time, so a
   *  pool there just multiplies idle connections against RDS's small limit. */
  max?: number;
  ssl?: boolean;
}

export function createDatabase(opts: DatabaseOptions) {
  const sql = postgres(opts.url, {
    max: opts.max ?? 10,
    idle_timeout: 20,
    connect_timeout: 10,
    ssl: opts.ssl ? { rejectUnauthorized: false } : undefined,
    // Postgres NUMERIC/BIGINT arrive as strings by default; the contract wants numbers.
    types: {
      bigint: postgres.BigInt,
    },
    onnotice: () => {},
  });

  const db = drizzle(sql, { schema, casing: "snake_case" });
  return { db, sql, close: () => sql.end({ timeout: 5 }) };
}

export { schema };

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
  /** Optional read-replica connection string. When absent (the common
   *  single-node case) every read uses the primary and behaviour is
   *  byte-identical to before this option existed. When set, reads issued
   *  through `readDb` land on the replica while writes stay on the primary.
   *
   *  ONLY route a query here if it does not read-then-write in the same
   *  logical operation. Replica lag means a value read from the replica can be
   *  stale relative to a write you are about to make against the primary, which
   *  turns gates and counters into wrong answers. Pure analytics/list reads are
   *  safe; anything guarding a subsequent write is not. */
  replicaUrl?: string;
  /** Lambda gets 1 — a function instance serves one request at a time, so a
   *  pool there just multiplies idle connections against RDS's small limit. */
  max?: number;
  ssl?: boolean;
  /** Opt out of TLS certificate verification ({ rejectUnauthorized: false }).
   *  This is the old default and is only safe inside a trusted network (a VPC),
   *  where there is no MITM to defend against. Do not enable it for a
   *  connection that crosses a network you do not control. */
  sslNoVerify?: boolean;
  /** PEM contents of a CA bundle to verify the server certificate against, for
   *  RDS or a self-signed setup whose CA is not in the system trust store. */
  sslCaCert?: string;
}

/** Build the postgres-js `ssl` option.
 *
 *  Certificate verification defends the database connection against a
 *  man-in-the-middle: without it, anything on the network path can present its
 *  own certificate and read or rewrite queries. So when TLS is on we default to
 *  'verify-full' (verifies the certificate chain AND the hostname) rather than
 *  the old `{ rejectUnauthorized: false }`, which accepted any certificate.
 *
 *  Precedence, most explicit first:
 *    1. sslNoVerify  — deliberate opt-out for VPC/self-signed (insecure).
 *    2. sslCaCert    — verify against a supplied CA bundle.
 *    3. 'verify-full'— verify against the system CA store (the default). */
function buildSslOption(opts: DatabaseOptions): postgres.Options<Record<string, never>>["ssl"] {
  if (!opts.ssl) return undefined;
  if (opts.sslNoVerify) return { rejectUnauthorized: false };
  if (opts.sslCaCert) return { ca: opts.sslCaCert, rejectUnauthorized: true };
  return "verify-full";
}

export function createDatabase(opts: DatabaseOptions) {
  const ssl = buildSslOption(opts);
  const connectionOptions = {
    max: opts.max ?? 10,
    idle_timeout: 20,
    connect_timeout: 10,
    ssl,
    // Postgres NUMERIC/BIGINT arrive as strings by default; the contract wants numbers.
    types: {
      bigint: postgres.BigInt,
    },
    onnotice: () => {},
  } as const;

  const sql = postgres(opts.url, connectionOptions);
  const db = drizzle(sql, { schema, casing: "snake_case" });

  /* Only open a second pool when there is a distinct replica to talk to.
     When replicaUrl is absent/empty, readDb IS db (same reference) so
     single-node deployments carry exactly one pool and behaviour is
     unchanged. */
  const hasReplica = Boolean(opts.replicaUrl && opts.replicaUrl !== opts.url);
  const replicaSql = hasReplica ? postgres(opts.replicaUrl!, connectionOptions) : undefined;
  const readDb = replicaSql ? drizzle(replicaSql, { schema, casing: "snake_case" }) : db;

  return {
    db,
    /** Read-only handle. Identical Drizzle type to `db`. Points at the replica
     *  when replicaUrl is set, otherwise at the primary. Only use for reads that
     *  are NOT part of a read-then-write operation (see DatabaseOptions.replicaUrl). */
    readDb,
    sql,
    close: async () => {
      await sql.end({ timeout: 5 });
      // Guard against double-ending: replicaSql only exists when a distinct pool was opened.
      if (replicaSql) await replicaSql.end({ timeout: 5 });
    },
  };
}

export { schema };

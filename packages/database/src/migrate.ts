import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

/* ============================================================
   Applying migrations from inside the VPC.

   RDS lives in isolated subnets with publiclyAccessible false,
   so there is no route from a developer's laptop to the
   database. `pnpm db:migrate` works locally and cannot reach a
   deployed environment at all.

   The only things that can reach it are the Lambdas, which is
   why this is a library function rather than only a script: the
   worker image already ships the migration SQL (the database
   package lists `drizzle` in its `files`), so it can run them
   on request.

   Deliberately not run on API cold start. Several Lambdas can
   cold-start at once, and racing each other for a schema lock is
   a bad way to find out that migrations are not serialised.
   ============================================================ */

/** Where the .sql files ended up, which differs between the repo and an image. */
function migrationsFolder(): string {
  const candidates = [
    // Inside a Lambda image: node_modules/@snapurl/database/drizzle
    resolve(__dirname, "..", "drizzle"),
    // Running from the repo: packages/database/drizzle
    resolve(__dirname, "..", "..", "drizzle"),
  ];
  const found = candidates.find((c) => existsSync(c));
  if (!found) {
    throw new Error(
      `No migrations folder found. Looked in:\n${candidates.map((c) => `  ${c}`).join("\n")}\n` +
        `The database package must ship "drizzle" in its package.json "files".`,
    );
  }
  return found;
}

export interface MigrateResult {
  applied: true;
  folder: string;
}

/**
 * Apply every pending migration, then close the connection.
 *
 * Uses its own single connection rather than a shared pool: this runs once,
 * holds a lock while it works, and should not leave anything behind.
 */
export async function runMigrations(databaseUrl: string, ssl = false): Promise<MigrateResult> {
  const folder = migrationsFolder();
  const sql = postgres(databaseUrl, {
    max: 1,
    ssl: ssl ? { rejectUnauthorized: false } : undefined,
    onnotice: () => {},
  });
  try {
    await migrate(drizzle(sql), { migrationsFolder: folder });
    return { applied: true, folder };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

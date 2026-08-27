import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { resolve } from "node:path";

/* Applied by `pnpm db:migrate`. Kept as a script rather than run on API boot:
   a Lambda cold start racing another Lambda's migration is a bad way to
   discover a schema lock. */
async function main() {
  const url = process.env.DATABASE_URL ?? "postgres://snapurl:snapurl@localhost:5433/snapurl";
  const sql = postgres(url, { max: 1 });
  try {
    await migrate(drizzle(sql), { migrationsFolder: resolve(__dirname, "../drizzle") });
    console.log("migrations applied");
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

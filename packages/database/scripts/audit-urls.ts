import postgres from "postgres";
import { HttpUrl } from "@snapurl/contract";

/* Issue #280: the contract now rejects javascript:/data:/file: schemes and
   private / loopback / link-local hosts at every URL-bearing field. Rows that
   were written before that check exists can still hold such a value and would
   be emitted as a Location header or rendered as a clickable <a href>.

   This read-only script lists every existing row whose URL would now be
   rejected, so an operator can see the blast radius before enforcing. It never
   writes: it is a report, not a migration.

     DATABASE_URL=… pnpm --filter @snapurl/database audit-urls

   Exit code is non-zero when offending rows are found, so it can gate a deploy. */

interface Offender {
  table: string;
  column: string;
  id: string;
  value: string;
}

const bad = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && !HttpUrl.safeParse(value).success;

async function main() {
  const url = process.env.DATABASE_URL ?? "postgres://snapurl:snapurl@localhost:5433/snapurl";
  const sql = postgres(url, { max: 1 });
  const offenders: Offender[] = [];

  try {
    const links = await sql<{ id: string; destination: string; social: unknown }[]>`
      SELECT id, destination, social FROM links`;
    for (const row of links) {
      if (bad(row.destination)) {
        offenders.push({ table: "links", column: "destination", id: row.id, value: row.destination });
      }
      const image = (row.social as { image?: unknown } | null)?.image;
      if (bad(image)) {
        offenders.push({ table: "links", column: "social.image", id: row.id, value: image });
      }
    }

    const rules = await sql<{ id: string; then: string }[]>`
      SELECT id, "then" FROM routing_rules`;
    for (const row of rules) {
      if (bad(row.then)) {
        offenders.push({ table: "routing_rules", column: "then", id: row.id, value: row.then });
      }
    }

    const domains = await sql<{ id: string; root_redirect: string | null; not_found_redirect: string | null }[]>`
      SELECT id, root_redirect, not_found_redirect FROM domains`;
    for (const row of domains) {
      if (bad(row.root_redirect)) {
        offenders.push({ table: "domains", column: "root_redirect", id: row.id, value: row.root_redirect! });
      }
      if (bad(row.not_found_redirect)) {
        offenders.push({ table: "domains", column: "not_found_redirect", id: row.id, value: row.not_found_redirect! });
      }
    }

    const webhooks = await sql<{ id: string; endpoint: string }[]>`
      SELECT id, endpoint FROM webhooks`;
    for (const row of webhooks) {
      if (bad(row.endpoint)) {
        offenders.push({ table: "webhooks", column: "endpoint", id: row.id, value: row.endpoint });
      }
    }

    const blocks = await sql<{ id: string; href: string | null }[]>`
      SELECT id, href FROM bio_blocks`;
    for (const row of blocks) {
      if (bad(row.href)) {
        offenders.push({ table: "bio_blocks", column: "href", id: row.id, value: row.href! });
      }
    }
  } finally {
    await sql.end();
  }

  if (offenders.length === 0) {
    console.log("audit-urls: no rows would be rejected by the new HttpUrl schema.");
    return;
  }

  console.error(`audit-urls: ${offenders.length} row(s) hold a URL the contract now rejects:`);
  for (const o of offenders) {
    console.error(`  ${o.table}.${o.column} id=${o.id} => ${JSON.stringify(o.value)}`);
  }
  process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

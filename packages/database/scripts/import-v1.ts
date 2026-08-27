import postgres from "postgres";

/* ============================================================
   G9 — importing the v1 Mongo data.

   Run this BEFORE v2 accepts its first write, or do not run it
   at all.

   The unrecoverable failure is a v2 link claiming a slug that a
   v1 link already owns. Printed QR codes and links people have
   already shared would start resolving to somebody else's
   destination, and nothing detects it after the fact — the row
   looks completely normal.

   So: import first and reserve every v1 slug, or declare v1 dead
   and accept that its links stop working. What you must not do
   is run both and hope.

   Usage:
     MONGO_EXPORT=./v1-urls.json pnpm --filter @snapurl/database import-v1

   Produce the export with:
     mongoexport --uri "<v1 uri>" --collection url_collection \
       --jsonArray --out v1-urls.json
   ============================================================ */

const URL = process.env.DATABASE_URL ?? "postgres://snapurl:snapurl@localhost:5433/snapurl";
const EXPORT_PATH = process.env.MONGO_EXPORT;
const TARGET_WORKSPACE = process.env.TARGET_WORKSPACE_SLUG ?? "acme-growth";
const DOMAIN = process.env.DEFAULT_DOMAIN ?? "localhost:3002";
const DRY_RUN = process.argv.includes("--dry-run");

/** The v1 shape, from backend/models/UrlModel.js. */
interface V1Url {
  _id?: { $oid?: string } | string;
  shortUrl?: string;
  originalUrl?: string;
  customBackHalf?: string;
  category?: string;
  visitCount?: number;
  createdAt?: { $date?: string } | string;
}

function asDate(value: V1Url["createdAt"]): Date {
  if (!value) return new Date();
  const raw = typeof value === "string" ? value : value.$date;
  const date = raw ? new Date(raw) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

async function main() {
  if (!EXPORT_PATH) {
    console.error("Set MONGO_EXPORT to a mongoexport --jsonArray file. See the header of this file.");
    process.exit(1);
  }

  const { readFile } = await import("node:fs/promises");
  const documents = JSON.parse(await readFile(EXPORT_PATH, "utf8")) as V1Url[];
  console.log(`read ${documents.length} v1 documents from ${EXPORT_PATH}`);

  const sql = postgres(URL, { max: 1 });
  try {
    const [workspace] = await sql`select id from workspaces where slug = ${TARGET_WORKSPACE}`;
    if (!workspace) {
      console.error(`No workspace with slug "${TARGET_WORKSPACE}". Set TARGET_WORKSPACE_SLUG.`);
      process.exit(1);
    }

    const [domain] = await sql`select id from domains where lower(domain) = ${DOMAIN.toLowerCase()}`;
    if (!domain) {
      console.error(`No domain "${DOMAIN}" in the database. Set DEFAULT_DOMAIN.`);
      process.exit(1);
    }

    let imported = 0;
    let skippedTaken = 0;
    let skippedInvalid = 0;

    for (const doc of documents) {
      // v1 had two slug fields; the custom back-half wins because that is the
      // one a customer chose and therefore the one they printed.
      const slug = (doc.customBackHalf || doc.shortUrl || "").trim();
      const destination = (doc.originalUrl || "").trim();

      if (!slug || !destination) {
        skippedInvalid++;
        continue;
      }
      if (!/^https?:\/\//i.test(destination)) {
        skippedInvalid++;
        continue;
      }

      /* Never overwrite. If the slug is already taken in v2, the v1 link loses
         — but loudly, in the summary, rather than by silently redirecting
         someone else's traffic. */
      const [taken] = await sql`
        select 1 from links where domain_id = ${domain.id} and lower(slug) = ${slug.toLowerCase()}`;
      if (taken) {
        skippedTaken++;
        console.warn(`  slug already taken, v1 link NOT imported: ${slug} -> ${destination}`);
        continue;
      }

      if (DRY_RUN) {
        imported++;
        continue;
      }

      const createdAt = asDate(doc.createdAt);
      const tags = doc.category ? [doc.category] : [];

      const [row] = await sql`
        insert into links (
          workspace_id, domain_id, slug, destination, tags, redirect_type,
          safe_browsing_status, safe_browsing_checked_at, clicks, unique_clicks, created_at
        ) values (
          ${workspace.id}, ${domain.id}, ${slug}, ${destination}, ${tags}, '302',
          'pending', null, ${doc.visitCount ?? 0}, 0, ${createdAt}
        ) returning id`;

      /* v1 only ever stored a lifetime counter, with no dates attached. Rather
         than invent a distribution across 90 days that never happened, the
         whole total lands on the import date and is visibly a single spike.
         A fabricated history would look more plausible and be a lie. */
      if ((doc.visitCount ?? 0) > 0) {
        await sql`
          insert into click_daily ("link_id", "workspace_id", "day", "clicks", "uniques", "scans", "blocked")
          values (${row!.id}, ${workspace.id}, current_date, ${doc.visitCount}, 0, 0, 0)
          on conflict (link_id, day) do update set clicks = excluded.clicks`;
      }

      // Make the redirect path pick it up.
      await sql`
        insert into projection_outbox (link_id, operation, payload)
        values (${row!.id}, 'upsert', ${sql.json({ linkId: row!.id, operation: "upsert", source: "v1-import" })})`;

      imported++;
    }

    console.log("");
    console.log(DRY_RUN ? "  DRY RUN — nothing written" : "  import complete");
    console.log(`    imported          ${imported}`);
    console.log(`    skipped (taken)   ${skippedTaken}`);
    console.log(`    skipped (invalid) ${skippedInvalid}`);
    if (skippedTaken > 0) {
      console.log("");
      console.log("  Slugs listed above already existed in v2 and were left alone.");
      console.log("  Decide what those v1 links should do before pointing DNS at v2.");
    }
    console.log("");
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

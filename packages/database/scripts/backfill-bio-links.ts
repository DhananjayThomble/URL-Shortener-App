import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { bioManagedDestination } from "@snapurl/domain";

/* #650 — backfill managed links for bio pages published BEFORE this change.

   A published (status='live') bio page now owns a link at its <domain>/<slug>
   whose destination is the web app's /b/<domain>/<slug>. Pages published before
   the feature shipped have no such link, so their short URL does not resolve.
   This one-off creates the missing managed links.

   Idempotent and non-destructive by construction:
     - A page that ALREADY has a managed link is skipped.
     - A page whose <domain>/<slug> is already occupied by ANOTHER link (a user
       link, or a sibling bio page's managed link) is LEFT ALONE and reported —
       its short URL stays on the backward-compatible slug alias. We never
       overwrite an existing link (task #650 item 4).
     - Each created link also gets a projection_outbox 'upsert' row so the
       redirect/Dynamo/edge projection picks it up exactly like any other link.

   Run:  WEB_ORIGIN=https://app.example.com DATABASE_URL=… \
         pnpm --filter @snapurl/database backfill-bio-links
   WEB_ORIGIN defaults to the API's own default (http://localhost:3000). */

interface LivePage {
  id: string;
  slug: string;
  workspace_id: string;
  domain_id: string;
  domain: string;
}

async function main() {
  const url = process.env.DATABASE_URL ?? "postgres://snapurl:snapurl@localhost:5433/snapurl";
  const webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:3000";
  const sql = postgres(url, { max: 1 });

  let created = 0;
  const collisions: string[] = [];
  const alreadyManaged: string[] = [];

  try {
    const pages = await sql<LivePage[]>`
      SELECT bp.id, bp.slug, bp.workspace_id, bp.domain_id, d.domain
      FROM bio_pages bp
      JOIN domains d ON d.id = bp.domain_id
      WHERE bp.status = 'live'
      ORDER BY bp.created_at ASC`;

    for (const page of pages) {
      const address = `${page.domain}/${page.slug}`;

      // Already has its managed link? Nothing to do.
      const [owned] = await sql<{ id: string }[]>`
        SELECT id FROM links WHERE managed_bio_page_id = ${page.id} LIMIT 1`;
      if (owned) {
        alreadyManaged.push(address);
        continue;
      }

      // Is <domain>/<slug> already taken by some other link? Leave it.
      const [occupied] = await sql<{ id: string }[]>`
        SELECT id FROM links
        WHERE domain_id = ${page.domain_id} AND lower(slug) = ${page.slug.toLowerCase()}
        LIMIT 1`;
      if (occupied) {
        collisions.push(address);
        continue;
      }

      const destination = bioManagedDestination(webOrigin, page.domain, page.slug);
      // Create the managed link and enqueue its projection in one transaction.
      // A concurrent create racing the same back-half would violate
      // links_domain_slug_key; caught and reported as a collision, never
      // overwriting.
      try {
        await sql.begin(async (tx) => {
          const [row] = await tx<{ id: string }[]>`
            INSERT INTO links (id, workspace_id, domain_id, slug, destination, managed_bio_page_id,
                               redirect_type, safe_browsing_status, safe_browsing_checked_at)
            VALUES (${randomUUID()}, ${page.workspace_id}, ${page.domain_id}, ${page.slug},
                    ${destination}, ${page.id}, '302', 'clean', now())
            RETURNING id`;
          await tx`
            INSERT INTO projection_outbox (id, link_id, operation, payload)
            VALUES (${randomUUID()}, ${row!.id}, 'upsert',
                    ${tx.json({ linkId: row!.id, operation: "upsert" })})`;
        });
        created += 1;
      } catch (err) {
        const code = (err as { code?: string } | null)?.code;
        if (code === "23505") {
          // unique_violation — someone else holds the back-half now. Leave it.
          collisions.push(address);
        } else {
          throw err;
        }
      }
    }
  } finally {
    await sql.end();
  }

  console.log(`backfill-bio-links: created ${created} managed link(s).`);
  if (alreadyManaged.length) {
    console.log(`  ${alreadyManaged.length} page(s) already had a managed link (skipped).`);
  }
  if (collisions.length) {
    console.warn(
      `  ${collisions.length} page(s) left on the slug alias — their <domain>/<slug> is already occupied by another link (not overwritten):`,
    );
    for (const a of collisions) console.warn(`    ${a}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

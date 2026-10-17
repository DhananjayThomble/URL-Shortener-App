import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createDatabase,
  DOMAIN_OP,
  domains,
  eq,
  projectionOutbox,
  sql,
  workspaces,
  type Database,
} from "@snapurl/database";
import { backfillDomainMeta } from "./outbox.js";

/* ============================================================
   #729 item 2 — backfillDomainMeta must not treat a DEAD-LETTERED outbox row
   (attempts >= MAX_ATTEMPTS) as a pending op.

   The backfill enqueues one domain op for every LIVE domain with a redirect
   that does not already have an unprocessed op. "Unprocessed" previously meant
   `processed_at is null` alone — which includes a row that already exhausted
   MAX_ATTEMPTS and will NEVER be retried by the drain (its claim query filters
   on attempts < MAX_ATTEMPTS). So a domain whose only outbox row is dead-
   lettered was permanently skipped by the backfill: exactly the domain whose
   projection is broken and most needs it.

   This test seeds a live domain with a redirect whose only outbox row is at
   MAX_ATTEMPTS, and asserts the backfill ENQUEUES a fresh op for it. The
   fail-first proof against the pre-change query is in the task report.

   Runs only when DATABASE_URL is set (CI applies the migrations first).
   ============================================================ */

const MAX_ATTEMPTS = 8;

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

describeDb("backfillDomainMeta skips dead-lettered ops (#729 item 2)", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;
  let workspaceId: string;
  const stamp = `${Date.now().toString(36)}${Math.random().toString(16).slice(2, 6)}`;

  // A domain whose only op is dead-lettered (must be re-enqueued).
  let deadLetteredDomainId: string;
  // A domain with a genuinely pending (live-attempt) op (must stay skipped).
  let pendingDomainId: string;
  // A live domain with a redirect and NO op at all (the ordinary backfill case).
  let freshDomainId: string;

  beforeAll(async () => {
    handle = createDatabase({ url: DATABASE_URL!, max: 1 });
    db = handle.db;

    const [ws] = await db
      .insert(workspaces)
      .values({ name: "backfill-729", slug: `bf729-${stamp}` })
      .returning({ id: workspaces.id });
    workspaceId = ws!.id;

    const mk = async (sub: string) => {
      const [d] = await db
        .insert(domains)
        .values({
          workspaceId,
          domain: `${sub}-${stamp}.test`,
          status: "live",
          rootRedirect: "https://example.com/root",
        })
        .returning({ id: domains.id });
      return d!.id;
    };
    deadLetteredDomainId = await mk("dead");
    pendingDomainId = await mk("pending");
    freshDomainId = await mk("fresh");

    // The dead-lettered domain's ONLY op: processed_at null but attempts maxed.
    await db.insert(projectionOutbox).values({
      linkId: deadLetteredDomainId,
      operation: DOMAIN_OP,
      payload: { domainId: deadLetteredDomainId, host: `dead-${stamp}.test`, operation: DOMAIN_OP },
      attempts: MAX_ATTEMPTS,
    });

    // The pending domain's op: a live, retryable attempt — the backfill must
    // NOT enqueue a duplicate for it.
    await db.insert(projectionOutbox).values({
      linkId: pendingDomainId,
      operation: DOMAIN_OP,
      payload: { domainId: pendingDomainId, host: `pending-${stamp}.test`, operation: DOMAIN_OP },
      attempts: 1,
    });
  });

  afterAll(async () => {
    if (workspaceId) await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await handle?.close();
  });

  /** Count the PENDING ('backfill' reason) ops the backfill wrote for a domain. */
  const freshBackfillOps = async (domainId: string): Promise<number> => {
    const [{ n }] = (await db.execute(sql`
      select count(*)::int as n from projection_outbox
      where link_id = ${domainId}::uuid
        and processed_at is null
        and attempts = 0
        and payload->>'reason' = 'backfill'
    `)) as unknown as [{ n: number }];
    return n;
  };

  it("enqueues a fresh op for a domain whose only op is dead-lettered, and skips the one with a live op", async () => {
    await backfillDomainMeta(db);

    // The dead-lettered domain gets a brand-new attempts=0 op the drain WILL run.
    expect(await freshBackfillOps(deadLetteredDomainId)).toBe(1);
    // The fresh (no-op) domain is backfilled as usual.
    expect(await freshBackfillOps(freshDomainId)).toBe(1);
    // The domain with a genuinely pending op is NOT given a duplicate.
    expect(await freshBackfillOps(pendingDomainId)).toBe(0);
  });

  it("is idempotent: a second run adds nothing (the fresh op is now the pending one)", async () => {
    const before = await freshBackfillOps(deadLetteredDomainId);
    await backfillDomainMeta(db);
    expect(await freshBackfillOps(deadLetteredDomainId)).toBe(before);
  });
});

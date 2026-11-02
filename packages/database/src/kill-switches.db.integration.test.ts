import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase, type Database } from "./client.js";
import { countEmailsSince, pruneEmailSendLog, recordEmailSent } from "./kill-switches.js";

/* #1020 — the email-cap ledger helpers against a REAL Postgres. The pure-fake
   unit test mocks the query builder and so cannot catch a bad parameter bind;
   this exercises record -> count -> prune end to end, which is what caught the
   pruneEmailSendLog Date-binding bug (postgres.js rejected a raw sql`< ${Date}`
   fragment, logged at error level, and tripped the compose error gate).

   DB-gated: skips with no DATABASE_URL. Asserts on counts within its OWN
   trailing windows, cleaning up its rows afterwards (the table is tiny and
   platform-wide, so it prunes everything it wrote). */

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

describeDb("email-send-log helpers (#1020)", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;

  beforeAll(() => {
    handle = createDatabase({ url: DATABASE_URL!, max: 1 });
    db = handle.db;
  });

  afterAll(async () => {
    if (!db) return;
    // Prune everything this test wrote (and anything older), proving prune runs
    // against a live DB without a bind error.
    await pruneEmailSendLog(db, 0);
    await handle.close();
  });

  it("records sends and counts them within a trailing window; prune removes old rows", async () => {
    const before = await countEmailsSince(db, 60 * 60_000);

    await recordEmailSent(db, false);
    await recordEmailSent(db, true);

    const after = await countEmailsSince(db, 60 * 60_000);
    expect(after).toBe(before + 2);

    // Prune with keepMs 0 deletes everything at/older than now — must NOT throw
    // (the Date-binding regression). It returns the count it deleted.
    const deleted = await pruneEmailSendLog(db, 0);
    expect(deleted).toBeGreaterThanOrEqual(2);

    // After pruning everything, the trailing-hour count is 0.
    expect(await countEmailsSince(db, 60 * 60_000)).toBe(0);
  });
});

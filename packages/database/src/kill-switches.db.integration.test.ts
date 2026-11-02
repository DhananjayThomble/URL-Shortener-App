import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { createDatabase, type Database } from "./client.js";
import { countEmailsSince, pruneEmailSendLog, recordEmailSent } from "./kill-switches.js";
import { pruneKillSwitchRefusalWindows, recordKillSwitchRefusal } from "./events.js";
import { adminAuditLog, killSwitchRefusalWindow } from "./schema/index.js";

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


/* #1032 — the refusal-audit dedupe helper against a REAL Postgres. The fake-DB
   unit test mocks the upsert's RETURNING, so it cannot prove the ON CONFLICT
   behaviour the flood-safety invariant turns on. This exercises it end to end:
     • the first refusal in a window INSERTs the window row (count 1) and writes
       exactly ONE admin_audit_log row with action admin.killswitch.refused;
     • repeated refusals on the SAME dedupe key bump the window counter and
       write NO further audit rows (a flood -> one row + a count, not N rows);
     • a DIFFERENT dedupe key (another subject) gets its own row;
     • prune removes the window rows.

   DB-gated; cleans up both the windows it wrote and the admin_audit_log rows,
   matched by the unique switch key it uses so it never touches real rows. */
const TEST_SWITCH = "billing.checkout";

async function countAuditRows(db: Database, switchKey: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(adminAuditLog)
    .where(and(eq(adminAuditLog.action, "admin.killswitch.refused"), eq(adminAuditLog.targetId, switchKey)));
  return row?.n ?? 0;
}

describeDb("kill-switch refusal audit (#1032)", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;
  // A unique minute bucket for this run so the dedupe keys cannot collide with
  // a concurrent run or a real refusal.
  const bucket = `t${Date.now()}`;
  const keyA = `${TEST_SWITCH}|feature_off|wsA-${bucket}|0`;
  const keyB = `${TEST_SWITCH}|feature_off|wsB-${bucket}|0`;

  beforeAll(() => {
    handle = createDatabase({ url: DATABASE_URL!, max: 1 });
    db = handle.db;
  });

  afterAll(async () => {
    if (!db) return;
    // Remove the admin_audit_log refusal rows for the test switch and all
    // refusal windows. On the shared integration DB these rows are only ever
    // written by this test (no real refusal fires in a test run).
    await db
      .delete(adminAuditLog)
      .where(and(eq(adminAuditLog.action, "admin.killswitch.refused"), eq(adminAuditLog.targetId, TEST_SWITCH)));
    await pruneKillSwitchRefusalWindows(db, 0);
    await handle.close();
  });

  it("first refusal writes ONE audit row; a flood on the same key only counts (dedupe)", async () => {
    const auditBefore = await countAuditRows(db, TEST_SWITCH);

    // First refusal in the window: INSERT path, count 1, audit row written.
    const first = await recordKillSwitchRefusal(db, {
      dedupeKey: keyA,
      switchKey: TEST_SWITCH,
      reason: "feature_off",
      workspaceId: null,
      actorId: null,
      actorLabel: null,
    });
    expect(first.count).toBe(1);
    expect(first.auditWritten).toBe(true);

    // Nine more refusals on the SAME key: each bumps the counter, writes no row.
    for (let i = 0; i < 9; i++) {
      const again = await recordKillSwitchRefusal(db, {
        dedupeKey: keyA,
        switchKey: TEST_SWITCH,
        reason: "feature_off",
      });
      expect(again.auditWritten).toBe(false);
    }

    // The window row carries the running count (1 + 9 = 10).
    const [win] = await db
      .select({ count: killSwitchRefusalWindow.count })
      .from(killSwitchRefusalWindow)
      .where(eq(killSwitchRefusalWindow.dedupeKey, keyA));
    expect(win?.count).toBe(10);

    // Exactly one new admin_audit_log row for the ten refusals on this key.
    expect(await countAuditRows(db, TEST_SWITCH)).toBe(auditBefore + 1);
  });

  it("a different subject (dedupe key) gets its own audit row", async () => {
    const auditBefore = await countAuditRows(db, TEST_SWITCH);
    const res = await recordKillSwitchRefusal(db, {
      dedupeKey: keyB,
      switchKey: TEST_SWITCH,
      reason: "feature_off",
    });
    expect(res.auditWritten).toBe(true);
    expect(await countAuditRows(db, TEST_SWITCH)).toBe(auditBefore + 1);
  });

  it("prune removes the refusal windows", async () => {
    const deleted = await pruneKillSwitchRefusalWindows(db, 0);
    expect(deleted).toBeGreaterThanOrEqual(2);
    const [win] = await db
      .select({ count: killSwitchRefusalWindow.count })
      .from(killSwitchRefusalWindow)
      .where(eq(killSwitchRefusalWindow.dedupeKey, keyA));
    expect(win).toBeUndefined();
  });
});

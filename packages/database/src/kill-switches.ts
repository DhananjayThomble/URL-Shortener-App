import { eq, gte, sql } from "drizzle-orm";
import type { Database } from "./client.js";
import { emailSendLog, platformSettings } from "./schema/admin.js";

/* ============================================================
   #1020 — the DB-side primitives for the typed kill-switch set.

   DELIBERATELY FREE OF A RUNTIME @snapurl/contract IMPORT. The database package
   is pulled into the stack-test module graph (via apps/api/src/stack/principals
   → @snapurl/database), and importing contract's runtime zod HERE loaded a
   SECOND contract/zod instance through the database package's own resolution.
   That broke @asteasolutions/zod-to-openapi's prototype patch for the whole
   process (every `.openapi()` became undefined) and red the real-stack fuzz +
   access-matrix suites. So this module only touches tables; the FOLD and
   FAIL-CLOSED logic (which needs the contract schema) lives in
   @snapurl/contract (foldKillSwitches / failClosedKillSwitches), called by the
   API service and the worker — both of which already import contract.

   The worker reads the raw row with readKillSwitchesRow and folds it with the
   contract helper; the API reads through PlatformSettingsService's cache. The
   email helpers back the email.outbound rolling-window caps.
   ============================================================ */

/** Read the raw stored `killSwitches` value from platform_settings, or null
 *  when the row has never been set. Throws only on a real DB error — the caller
 *  decides the fail-closed behaviour (the worker folds a thrown read to the
 *  fail-closed set via the contract helper). Returns `unknown`: the caller
 *  validates it against the contract shape with foldKillSwitches. */
export async function readKillSwitchesRow(db: Database): Promise<unknown> {
  const [row] = await db
    .select({ value: platformSettings.value })
    .from(platformSettings)
    .where(eq(platformSettings.key, "killSwitches"))
    .limit(1);
  return row?.value ?? null;
}

/** Count outbound emails sent in the trailing `windowMs`. The email.outbound
 *  cap check calls this before a send; the N+1th send in a window is refused. */
export async function countEmailsSince(
  db: Database,
  windowMs: number,
  now: Date = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - windowMs);
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(emailSendLog)
    .where(gte(emailSendLog.sentAt, cutoff));
  return r?.n ?? 0;
}

/** Record that one outbound email was sent, for the rolling-window caps. Called
 *  only after a send is ALLOWED and performed. `authCritical` marks the
 *  verification/reset mail that may bypass the OFF switch but is still counted. */
export async function recordEmailSent(
  db: Database,
  authCritical: boolean,
  now: Date = new Date(),
): Promise<void> {
  await db.insert(emailSendLog).values({ authCritical, sentAt: now });
}

/** Prune email-send-log rows older than `keepMs` (the longest cap window, with
 *  a margin). Called by the worker's hourly maintenance so the ledger never
 *  grows without bound — it is only ever read as a trailing-window count. */
export async function pruneEmailSendLog(
  db: Database,
  keepMs: number,
  now: Date = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - keepMs);
  const deleted = await db
    .delete(emailSendLog)
    .where(sql`${emailSendLog.sentAt} < ${cutoff}`)
    .returning({ id: emailSendLog.id });
  return deleted.length;
}

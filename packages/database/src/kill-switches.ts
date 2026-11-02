import { eq, gte, sql } from "drizzle-orm";
import {
  DEFAULT_KILL_SWITCHES,
  KillSwitchesSetting,
  type KillSwitchKey,
  type KillSwitchState,
  PAID_KILL_SWITCH_KEYS,
} from "@snapurl/contract";
import type { Database } from "./client.js";
import { emailSendLog, platformSettings } from "./schema/admin.js";

/* ============================================================
   #1020 — the shared, FAIL-CLOSED reader for the typed kill-switch set.

   The API reads kill switches through PlatformSettingsService's short cache;
   the WORKER (a Lambda, no Nest DI) reads them straight from platform_settings
   on each maintenance pass. Both need the SAME fail-closed semantics, so the
   read + fold lives here in the database package, which both import.

   FAIL CLOSED is the whole point: if the `killSwitches` row cannot be read or
   does not parse, every PAID switch reads OFF and the rest fall back to their
   shipped default (email/error/rescans ON). A paid, money-incurring action's
   safe answer on "I can't tell" is "refuse"; a background cost-incurring one's
   is "keep shipped behaviour". readKillSwitchesFailClosed encodes exactly that.
   ============================================================ */

/** Fold a (possibly partial or malformed) stored value onto the shipped
 *  defaults so every key is present and typed. A key whose stored state fails
 *  its schema is replaced by its default — NOT dropped — so the set is always
 *  complete. Exported for the API service, which folds its own cached row the
 *  same way. */
export function foldKillSwitches(stored: unknown): KillSwitchesSetting {
  const base = structuredClone(DEFAULT_KILL_SWITCHES);
  if (stored == null || typeof stored !== "object") return base;
  const rec = stored as Record<string, unknown>;
  for (const key of Object.keys(base) as KillSwitchKey[]) {
    const parsed = parseState(rec[key]);
    if (parsed) base[key] = parsed;
  }
  return base;
}

/** The fail-closed answer: every PAID switch OFF, the background switches on
 *  their shipped default. Used when the store cannot be read at all. */
export function failClosedKillSwitches(): KillSwitchesSetting {
  const safe = structuredClone(DEFAULT_KILL_SWITCHES);
  for (const key of PAID_KILL_SWITCH_KEYS) {
    safe[key] = { ...safe[key], on: false };
  }
  return safe;
}

/**
 * Read the effective kill-switch set straight from platform_settings, folded
 * onto the defaults, FAILING CLOSED on any read error. A missing row is not an
 * error — it means "never set", so the shipped defaults (billing/domains OFF)
 * stand. A read that THROWS (the DB is unreachable) returns
 * failClosedKillSwitches(): the paid switches read OFF regardless of what the
 * row might have said. This is the worker's path and the API's cache-miss
 * fallback.
 */
export async function readKillSwitchesFailClosed(db: Database): Promise<KillSwitchesSetting> {
  try {
    const [row] = await db
      .select({ value: platformSettings.value })
      .from(platformSettings)
      .where(eq(platformSettings.key, "killSwitches"))
      .limit(1);
    // No row => never set => shipped defaults (billing/domains OFF already).
    return foldKillSwitches(row?.value);
  } catch {
    // The store is unreadable. Every paid switch reads OFF; the webhook (which
    // reads no switch) is unaffected. This is the invariant the issue names.
    return failClosedKillSwitches();
  }
}

/** Count outbound emails sent in the trailing `windowMs`, optionally only the
 *  auth-critical ones. The email.outbound cap check calls this before a send;
 *  the N+1th send in a window is the one refused. */
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

/* ── internals ── */

/** Parse one stored switch state, returning null when it does not match the
 *  contract shape (so the caller keeps the default for that key). Kept local
 *  and defensive: a hand-edited or stale row must never crash a hot path. */
function parseState(value: unknown): KillSwitchState | null {
  const parsed = KillSwitchesSetting.shape["billing.checkout"].safeParse(value);
  return parsed.success ? parsed.data : null;
}

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  adminAuditLog,
  and,
  createDatabase,
  domains,
  eq,
  killSwitchRefusalWindow,
  links,
  platformSettings,
  sql,
  workspaces,
  type Database,
} from "@snapurl/database";
import { DEFAULT_KILL_SWITCHES, foldKillSwitchChanges } from "@snapurl/contract";
import { runFrequent } from "../main.js";

/* ============================================================
   #1020 — the worker honours the linkScanning.rescans kill switch.

   runFrequent reads the kill switches straight from platform_settings
   (fail-closed) and SKIPS the rescan pass when linkScanning.rescans is OFF. The
   observable proof: a pending link that is due for a re-check is left untouched
   while the switch is OFF (runFrequent never calls the scanner), and the pass
   reports rescan.scanned === 0. Flipping the switch ON lets the same link be
   rescanned (the no-API-key scanner marks it clean), so scanned > 0.

   Oracle: the issue's "worker jobs honour the switches". Red-on-broken: remove
   the `if (switches[...].on)` guard and the OFF case reds (the pending link is
   rescanned to clean and scanned > 0).

   DB-gated; writes the singleton killSwitches row, so it cleans up after itself
   and asserts only on rows it seeded.
   ============================================================ */

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

describeDb("runFrequent honours linkScanning.rescans (#1020)", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;
  let workspaceId: string;
  let domainId: string;

  const stamp = `${Date.now().toString(36)}${Math.random().toString(16).slice(2, 6)}`;
  const minsAgo = (n: number) => new Date(Date.now() - n * 60_000);

  async function setSwitch(on: boolean): Promise<void> {
    const value = foldKillSwitchChanges(DEFAULT_KILL_SWITCHES, { "linkScanning.rescans": { on } });
    await db
      .insert(platformSettings)
      .values({ key: "killSwitches", value, updatedAt: new Date() })
      .onConflictDoUpdate({ target: platformSettings.key, set: { value, updatedAt: new Date() } });
  }

  async function addPendingLink(slug: string): Promise<string> {
    const [row] = await db
      .insert(links)
      .values({
        workspaceId,
        domainId,
        slug,
        destination: `https://dest.example/${slug}`,
        safeBrowsingStatus: "pending",
        safeBrowsingCheckedAt: minsAgo(10), // due for a re-check
      })
      .returning({ id: links.id });
    return row!.id;
  }

  const statusOf = async (id: string) =>
    (await db.select({ s: links.safeBrowsingStatus }).from(links).where(eq(links.id, id)))[0]!.s;

  beforeAll(async () => {
    handle = createDatabase({ url: DATABASE_URL!, max: 1 });
    db = handle.db;
    const [ws] = await db.insert(workspaces).values({ name: "ks-rescan", slug: `ks-rescan-${stamp}` }).returning({ id: workspaces.id });
    workspaceId = ws!.id;
    const [dom] = await db.insert(domains).values({ workspaceId, domain: `ks-rescan-${stamp}.test` }).returning({ id: domains.id });
    domainId = dom!.id;
  });

  afterAll(async () => {
    if (!db) return;
    await db.delete(platformSettings).where(eq(platformSettings.key, "killSwitches"));
    // #1032 — remove the refusal audit rows this test wrote for the rescans
    // switch, plus the dedupe windows (the whole table, tiny and test-only).
    await db
      .delete(adminAuditLog)
      .where(
        and(eq(adminAuditLog.action, "admin.killswitch.refused"), eq(adminAuditLog.targetId, "linkScanning.rescans")),
      );
    await db.delete(killSwitchRefusalWindow);
    if (workspaceId) await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await handle?.close();
  });

  const countRescanRefusals = async () =>
    (
      await db
        .select({ n: sql<number>`count(*)::int` })
        .from(adminAuditLog)
        .where(
          and(
            eq(adminAuditLog.action, "admin.killswitch.refused"),
            eq(adminAuditLog.targetId, "linkScanning.rescans"),
          ),
        )
    )[0]!.n;

  it("skips the rescan while linkScanning.rescans is OFF (pending link untouched)", async () => {
    await setSwitch(false);
    const id = await addPendingLink(`off-${stamp}`);

    const result = await runFrequent(db);

    expect(result.rescan.scanned).toBe(0);
    expect(await statusOf(id)).toBe("pending"); // never rescanned
  });

  it("audits the worker-job refusal while linkScanning.rescans is OFF (#1032)", async () => {
    // RED ON MAIN: before #1032 the OFF branch only logged and skipped — no
    // admin_audit_log row. This asserts the skip records a refusal row.
    //
    // Clear any prior refusal rows + windows so this assertion does not race a
    // sibling test that already opened this minute's window (the dedupe makes a
    // second pass in the same minute write nothing).
    await db
      .delete(adminAuditLog)
      .where(
        and(eq(adminAuditLog.action, "admin.killswitch.refused"), eq(adminAuditLog.targetId, "linkScanning.rescans")),
      );
    await db.delete(killSwitchRefusalWindow);
    await setSwitch(false);

    await runFrequent(db);

    // One refusal row for the switched-off rescan pass, action + reason set.
    expect(await countRescanRefusals()).toBe(1);
    const [row] = await db
      .select({ reason: sql<string>`${adminAuditLog.after}->>'reason'`, actor: adminAuditLog.actorLabel })
      .from(adminAuditLog)
      .where(
        and(eq(adminAuditLog.action, "admin.killswitch.refused"), eq(adminAuditLog.targetId, "linkScanning.rescans")),
      )
      .orderBy(sql`${adminAuditLog.at} desc`)
      .limit(1);
    expect(row?.reason).toBe("feature_off");
    // No principal behind a worker pass → labelled by the switch, no PII.
    expect(row?.actor).toBe("kill-switch:linkScanning.rescans");

    // A SECOND pass in the same minute does NOT add a second row (dedupe).
    await runFrequent(db);
    expect(await countRescanRefusals()).toBe(1);
  });

  it("runs the rescan when linkScanning.rescans is ON (pending link resolved)", async () => {
    await setSwitch(true);
    const id = await addPendingLink(`on-${stamp}`);

    const result = await runFrequent(db);

    expect(result.rescan.scanned).toBeGreaterThan(0);
    // The no-API-key scanner marks a due link clean.
    expect(await statusOf(id)).toBe("clean");
  });
});

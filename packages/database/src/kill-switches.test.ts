import { describe, expect, it } from "vitest";
import { DEFAULT_KILL_SWITCHES } from "@snapurl/contract";
import {
  countEmailsSince,
  failClosedKillSwitches,
  foldKillSwitches,
  pruneEmailSendLog,
  readKillSwitchesFailClosed,
  recordEmailSent,
} from "./kill-switches.js";
import type { Database } from "./client.js";

/* ============================================================
   #1020 — the shared, fail-closed kill-switch reader + email-cap ledger
   helpers. No live Postgres: the subject is the FOLD and the FAIL-CLOSED
   control flow, not the SQL. A fake `db` returns a chosen row (or throws) so
   the branches are pinned here; the real query shapes run against the DB in the
   api/worker integration suites.
   ============================================================ */

/** A db fake whose `select().from().where()` resolves to `rows`, or throws. */
function selectStub(rows: unknown[] | Error): Database {
  // A node-postgres/drizzle query builder is thenable AND chainable: you can
  // `await builder` to run it, or call `.limit()` first. countEmailsSince
  // awaits `.where()` directly; readKillSwitchesFailClosed calls `.where().limit()`.
  // So the where-result is BOTH a thenable (resolving to rows) and carries
  // `.limit()` (also resolving to rows).
  const settle = (): Promise<unknown[]> => (rows instanceof Error ? Promise.reject(rows) : Promise.resolve(rows));
  const whereResult = {
    then: (res: (v: unknown[]) => unknown, rej: (e: unknown) => unknown) => settle().then(res, rej),
    limit: () => settle(),
  };
  const chain = {
    from: () => chain,
    where: () => whereResult,
  };
  return { select: () => chain } as unknown as Database;
}

describe("foldKillSwitches", () => {
  it("returns the shipped defaults for null/undefined/garbage", () => {
    expect(foldKillSwitches(null)).toEqual(DEFAULT_KILL_SWITCHES);
    expect(foldKillSwitches(undefined)).toEqual(DEFAULT_KILL_SWITCHES);
    expect(foldKillSwitches("not an object")).toEqual(DEFAULT_KILL_SWITCHES);
    expect(foldKillSwitches(42)).toEqual(DEFAULT_KILL_SWITCHES);
  });

  it("keeps a valid stored switch and defaults the rest", () => {
    const folded = foldKillSwitches({ "billing.checkout": { on: true } });
    expect(folded["billing.checkout"].on).toBe(true);
    // every other key present, on its default
    expect(folded["billing.refunds"]).toEqual(DEFAULT_KILL_SWITCHES["billing.refunds"]);
    expect(folded["email.outbound"]).toEqual(DEFAULT_KILL_SWITCHES["email.outbound"]);
  });

  it("replaces a malformed switch state with its default (never drops the key)", () => {
    const folded = foldKillSwitches({ "billing.checkout": { on: "yes" }, errorTracking: { on: true, errorCaps: { sampleRate: 9 } } });
    expect(folded["billing.checkout"]).toEqual(DEFAULT_KILL_SWITCHES["billing.checkout"]);
    expect(folded.errorTracking).toEqual(DEFAULT_KILL_SWITCHES.errorTracking);
  });

  it("does not mutate the shipped defaults constant", () => {
    const folded = foldKillSwitches({ "billing.checkout": { on: true } });
    folded["billing.checkout"].on = false;
    expect(DEFAULT_KILL_SWITCHES["billing.checkout"].on).toBe(false);
  });
});

describe("failClosedKillSwitches", () => {
  it("forces every paid switch OFF", () => {
    const safe = failClosedKillSwitches();
    expect(safe["billing.checkout"].on).toBe(false);
    expect(safe["billing.planChanges"].on).toBe(false);
    expect(safe["billing.coupons"].on).toBe(false);
    expect(safe["billing.trials"].on).toBe(false);
    expect(safe["billing.refunds"].on).toBe(false);
    expect(safe["customDomains.create"].on).toBe(false);
  });

  it("leaves the background switches on their shipped default", () => {
    const safe = failClosedKillSwitches();
    expect(safe["email.outbound"].on).toBe(DEFAULT_KILL_SWITCHES["email.outbound"].on);
    expect(safe.errorTracking.on).toBe(DEFAULT_KILL_SWITCHES.errorTracking.on);
    expect(safe["linkScanning.rescans"].on).toBe(DEFAULT_KILL_SWITCHES["linkScanning.rescans"].on);
  });
});

describe("readKillSwitchesFailClosed", () => {
  it("returns the shipped defaults when there is no row (never set)", async () => {
    const switches = await readKillSwitchesFailClosed(selectStub([]));
    expect(switches).toEqual(DEFAULT_KILL_SWITCHES);
  });

  it("folds a stored row onto the defaults", async () => {
    const switches = await readKillSwitchesFailClosed(selectStub([{ value: { "billing.checkout": { on: true } } }]));
    expect(switches["billing.checkout"].on).toBe(true);
  });

  it("FAILS CLOSED (paid switches off) when the read throws", async () => {
    const switches = await readKillSwitchesFailClosed(selectStub(new Error("db down")));
    expect(switches["billing.checkout"].on).toBe(false);
    expect(switches["customDomains.create"].on).toBe(false);
    // background switch unaffected
    expect(switches["email.outbound"].on).toBe(true);
  });
});

describe("countEmailsSince", () => {
  it("returns the counted rows", async () => {
    const n = await countEmailsSince(selectStub([{ n: 7 }]), 60_000);
    expect(n).toBe(7);
  });

  it("returns 0 when the count row is absent", async () => {
    const n = await countEmailsSince(selectStub([]), 60_000);
    expect(n).toBe(0);
  });
});

describe("recordEmailSent / pruneEmailSendLog build their writes", () => {
  it("recordEmailSent inserts one row with the authCritical flag", async () => {
    let inserted: unknown;
    const db = { insert: () => ({ values: async (v: unknown) => { inserted = v; } }) } as unknown as Database;
    await recordEmailSent(db, true);
    expect(inserted).toMatchObject({ authCritical: true });
  });

  it("pruneEmailSendLog returns how many rows it deleted", async () => {
    const db = {
      delete: () => ({ where: () => ({ returning: async () => [{ id: "1" }, { id: "2" }] }) }),
    } as unknown as Database;
    const deleted = await pruneEmailSendLog(db, 1000);
    expect(deleted).toBe(2);
  });
});

import { describe, expect, it } from "vitest";
import {
  countEmailsSince,
  pruneEmailSendLog,
  readKillSwitchesRow,
  recordEmailSent,
} from "./kill-switches.js";
import type { Database } from "./client.js";

/* #1020 — the DB-side kill-switch primitives. No live Postgres: the subject is
   the query shape and the "no row => null" behaviour, pinned with a fake db.
   The FOLD / FAIL-CLOSED logic deliberately lives in @snapurl/contract (so the
   database package carries no runtime contract import) and is tested there. */

/** A db fake whose select().from().where()[.limit()] resolves to `rows`. The
   where-result is thenable AND chainable so both `await ...where()` and
   `...where().limit()` work. */
function selectStub(rows: unknown[]): Database {
  const settle = (): Promise<unknown[]> => Promise.resolve(rows);
  const whereResult = {
    then: (res: (v: unknown[]) => unknown, rej: (e: unknown) => unknown) => settle().then(res, rej),
    limit: () => settle(),
  };
  const chain = { from: () => chain, where: () => whereResult };
  return { select: () => chain } as unknown as Database;
}

describe("readKillSwitchesRow", () => {
  it("returns the stored value when the row exists", async () => {
    const value = { "billing.checkout": { on: true } };
    expect(await readKillSwitchesRow(selectStub([{ value }]))).toEqual(value);
  });

  it("returns null when the row has never been set", async () => {
    expect(await readKillSwitchesRow(selectStub([]))).toBeNull();
  });

  it("propagates a read error (the caller decides fail-closed)", async () => {
    const throwing = {
      select: () => ({ from: () => ({ where: () => ({ limit: () => Promise.reject(new Error("db down")) }) }) }),
    } as unknown as Database;
    await expect(readKillSwitchesRow(throwing)).rejects.toThrow("db down");
  });
});

describe("countEmailsSince", () => {
  it("returns the counted rows", async () => {
    expect(await countEmailsSince(selectStub([{ n: 7 }]), 60_000)).toBe(7);
  });

  it("returns 0 when the count row is absent", async () => {
    expect(await countEmailsSince(selectStub([]), 60_000)).toBe(0);
  });
});

describe("recordEmailSent / pruneEmailSendLog", () => {
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
    expect(await pruneEmailSendLog(db, 1000)).toBe(2);
  });
});

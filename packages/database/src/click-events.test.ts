import { describe, expect, it, vi } from "vitest";
import { deserializeClickEvent, insertClickEvents, serializeClickEvent, type ClickEvent } from "./click-events.js";
import type { Database } from "./client.js";

/* ============================================================
   The shared click INSERT, and its one retry.

   No live Postgres here: the point is the control flow around
   the insert, not the SQL. A fake `db` records how many times
   `values()` was reached and can be told to throw a chosen
   driver error on the first attempt.
   ============================================================ */

const event: ClickEvent = {
  linkId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  workspaceId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  occurredAt: new Date("2026-08-30T11:00:00.000Z"),
  visitorHash: "hash",
  country: "IN",
  city: "Pune",
  device: "desktop",
  browser: "Chrome",
  os: "Windows",
  referrerHost: null,
  isQr: false,
  isBot: false,
  blockedReason: null,
  matchedRuleId: null,
  variant: null,
};

/** Drizzle wraps driver errors and puts the SQLSTATE on `.cause`, so the fake
 *  has to fail in that shape or the detector would never match. */
const driverError = (code: string, message: string) =>
  Object.assign(new Error("Failed query: insert into click_events"), {
    cause: Object.assign(new Error(message), { code }),
  });

const PARTITION_RACE = () =>
  driverError("23514", 'new row for relation "click_events_default" violates partition constraint');

/** A `db` that counts insert attempts and optionally throws on the first. */
function fakeDb(failFirstWith?: () => Error) {
  const attempts: unknown[][] = [];
  const db = {
    insert: () => ({
      values: (rows: unknown[]) => {
        attempts.push(rows);
        if (failFirstWith && attempts.length === 1) return Promise.reject(failFirstWith());
        return Promise.resolve();
      },
    }),
  } as unknown as Database;
  return { db, attempts };
}

describe("insertClickEvents", () => {
  it("inserts once when nothing goes wrong", async () => {
    const { db, attempts } = fakeDb();

    await insertClickEvents(db, [event]);

    expect(attempts).toHaveLength(1);
    // The whole ClickEvent is mapped, not just the identifiers.
    expect(attempts[0]![0]).toMatchObject({
      linkId: event.linkId,
      workspaceId: event.workspaceId,
      occurredAt: event.occurredAt,
      visitorHash: "hash",
      country: "IN",
      city: "Pune",
    });
  });

  it("is a no-op on an empty batch", async () => {
    const { db, attempts } = fakeDb();
    await insertClickEvents(db, []);
    expect(attempts).toHaveLength(0);
  });

  it("retries once and succeeds when a concurrent ATTACH invalidates the route", async () => {
    /* The #329 regression. The row was routed to the DEFAULT partition, an ATTACH
       for its day committed, and the partition constraint was evaluated after
       that. Transient by nature: the second attempt plans against fresh
       catalogue state and lands the row in the partition that now exists.
       
       Without the retry this click is lost outright — click writes are awaited,
       so the caller logs the failure and moves on with the count short. */
    const { db, attempts } = fakeDb(PARTITION_RACE);

    await expect(insertClickEvents(db, [event])).resolves.toBeUndefined();

    expect(attempts).toHaveLength(2);
    // The retry sends the same row, not a mutated one.
    expect(attempts[1]).toEqual(attempts[0]);
  });

  it("gives up after one retry rather than looping", async () => {
    // A row failing the same way twice is failing for some other reason, and
    // should surface instead of being retried into silence.
    let calls = 0;
    const db = {
      insert: () => ({
        values: () => {
          calls++;
          return Promise.reject(PARTITION_RACE());
        },
      }),
    } as unknown as Database;

    await expect(insertClickEvents(db, [event])).rejects.toThrow(/Failed query/);
    expect(calls).toBe(2);
  });

  it("does not retry an ordinary check violation", async () => {
    /* 23514 is shared with every CHECK constraint. Retrying one would cost a
       round trip to fail identically, and would make a real data problem look
       intermittent. */
    const { db, attempts } = fakeDb(() =>
      driverError("23514", 'new row for relation "workspaces" violates check constraint "x"'),
    );

    await expect(insertClickEvents(db, [event])).rejects.toThrow(/Failed query/);
    expect(attempts).toHaveLength(1);
  });

  it("does not retry an unrelated failure", async () => {
    const { db, attempts } = fakeDb(() => driverError("23503", "violates foreign key constraint"));

    await expect(insertClickEvents(db, [event])).rejects.toThrow(/Failed query/);
    expect(attempts).toHaveLength(1);
  });

  it("round-trips a click through the SQS wire shape unchanged", async () => {
    // The retry must not have changed what a serialised click looks like, since
    // the worker's consumer inserts the revived row into the same table.
    const revived = deserializeClickEvent(serializeClickEvent(event));
    expect(revived).toEqual(event);
    expect(revived.occurredAt).toBeInstanceOf(Date);
  });
});

describe("insertClickEvents retry logging", () => {
  it("does not swallow the first error's identity when it gives up", async () => {
    // The error the caller sees must be a real driver error, so the log line
    // downstream still carries the SQLSTATE.
    const db = {
      insert: () => ({ values: () => Promise.reject(PARTITION_RACE()) }),
    } as unknown as Database;

    const err = await insertClickEvents(db, [event]).catch((e: unknown) => e);
    expect((err as { cause?: { code?: string } }).cause?.code).toBe("23514");
    vi.restoreAllMocks();
  });
});

import { describe, expect, it } from "vitest";
import {
  deserializeClickEvent,
  insertClickEvents,
  serializeClickEvent,
  type ClickEvent,
} from "./click-events.js";
import type { Database } from "./client.js";

/* ============================================================
   The shared click INSERT, and its one retry.

   No live Postgres here: the subject is the control flow around
   the insert, not the SQL. A fake `db` records what reached
   `values()` on each attempt and can be told to throw a chosen
   driver error on the first one.

   The real error shapes, and that the retry actually lands the
   row after a concurrent ATTACH, are pinned against a live
   server in apps/worker/src/jobs/partitions.test.ts. This file
   covers the branches; that one covers the premise.
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

const eventAt = (visitorHash: string): ClickEvent => ({ ...event, visitorHash });

/** Drizzle wraps driver errors and puts the SQLSTATE on `.cause`, so the fake
 *  has to fail in that shape or the detector would never match. Routine and
 *  message are Postgres 18.6's actual output. */
const driverError = (code: string, message: string, routine: string) =>
  Object.assign(new Error("Failed query: insert into click_events"), {
    cause: Object.assign(new Error(message), { code, routine }),
  });

const PARTITION_RACE = () =>
  driverError(
    "23514",
    'new row for relation "click_events_default" violates partition constraint',
    "ExecPartitionCheckEmitError",
  );

/** A `db` that records the rows of every insert attempt and optionally throws on
 *  the first. Recording the rows, not just a count, is what lets the batch
 *  contract be asserted. */
function fakeDb(failFirstWith?: () => Error) {
  const attempts: Array<Array<{ visitorHash: string }>> = [];
  const db = {
    insert: () => ({
      values: (rows: Array<{ visitorHash: string }>) => {
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

  it("sends every event in the batch, in order", async () => {
    /* The parameter is an array and the retry resends all of it, so cardinality
       is part of the contract rather than an implementation detail. Without this,
       silently inserting only the first row of a batch would pass every other
       test in this file. */
    const { db, attempts } = fakeDb();
    const batch = [eventAt("a"), eventAt("b"), eventAt("c")];

    await insertClickEvents(db, batch);

    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.map((row) => row.visitorHash)).toEqual(["a", "b", "c"]);
  });

  it("is a no-op on an empty batch", async () => {
    const { db, attempts } = fakeDb();
    await insertClickEvents(db, []);
    expect(attempts).toHaveLength(0);
  });

  it("retries once and succeeds when a concurrent ATTACH invalidates the route", async () => {
    /* **The #329 regression.** The row was routed to the DEFAULT partition, an
       ATTACH for its day committed, and the partition constraint was evaluated
       after that. Transient by nature: the failing statement had already pinned
       its partition descriptor, and a fresh statement builds a new one.

       Without the retry the click is lost outright on the Postgres sink — click
       writes are awaited, so the caller logs the failure and the count is short. */
    const { db, attempts } = fakeDb(PARTITION_RACE);

    await expect(insertClickEvents(db, [event])).resolves.toBeUndefined();

    expect(attempts).toHaveLength(2);
  });

  it("resends the whole batch on the retry, unchanged", async () => {
    // Safe only because the multi-row INSERT is one statement, so the rejected
    // attempt committed nothing. If that ever stops being true, these rows
    // duplicate — and `id` is a per-row server-side uuidv7, so nothing detects it.
    const { db, attempts } = fakeDb(PARTITION_RACE);
    const batch = [eventAt("a"), eventAt("b"), eventAt("c")];

    await insertClickEvents(db, batch);

    expect(attempts).toHaveLength(2);
    expect(attempts[1]!.map((row) => row.visitorHash)).toEqual(["a", "b", "c"]);
    expect(attempts[1]).toEqual(attempts[0]);
  });

  it("reports the retry so it is not invisible", async () => {
    /* The case for the retry is a rate, so there has to be something to count.
       Called before the second attempt and regardless of whether it succeeds:
       "how often is the default partition being raced" is the question, and a
       retry that then fails is still an answer to it. */
    const { db } = fakeDb(PARTITION_RACE);
    const seen: unknown[] = [];

    await insertClickEvents(db, [event], { onRetry: (err) => seen.push(err) });

    expect(seen).toHaveLength(1);
    expect((seen[0] as { cause?: { code?: string } }).cause?.code).toBe("23514");
  });

  it("does not report a retry when there was none", async () => {
    const { db } = fakeDb();
    let calls = 0;

    await insertClickEvents(db, [event], { onRetry: () => calls++ });

    expect(calls).toBe(0);
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
      driverError(
        "23514",
        'new row for relation "workspaces" violates check constraint "x"',
        "ExecConstraints",
      ),
    );

    await expect(insertClickEvents(db, [event])).rejects.toThrow(/Failed query/);
    expect(attempts).toHaveLength(1);
  });

  it("does not retry an unrelated failure", async () => {
    const { db, attempts } = fakeDb(() =>
      driverError("23503", "violates foreign key constraint", "ri_ReportViolation"),
    );

    await expect(insertClickEvents(db, [event])).rejects.toThrow(/Failed query/);
    expect(attempts).toHaveLength(1);
  });

  it("surfaces a driver error the caller can still read the SQLSTATE off", async () => {
    // The error that escapes must be a real driver error, so the log line
    // downstream still carries the code.
    const db = {
      insert: () => ({ values: () => Promise.reject(PARTITION_RACE()) }),
    } as unknown as Database;

    const err = await insertClickEvents(db, [event]).catch((e: unknown) => e);

    expect((err as { cause?: { code?: string } }).cause?.code).toBe("23514");
  });

  it("round-trips a click through the SQS wire shape unchanged", async () => {
    // The retry must not have changed what a serialised click looks like, since
    // the worker's consumer inserts the revived row into the same table.
    const revived = deserializeClickEvent(serializeClickEvent(event));
    expect(revived).toEqual(event);
    expect(revived.occurredAt).toBeInstanceOf(Date);
  });
});

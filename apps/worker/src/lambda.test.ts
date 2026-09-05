import { describe, expect, it, vi, beforeEach } from "vitest";
import { serializeClickEvent, type ClickEvent } from "@snapurl/database";

/* The worker's SQS event source mapping path (#288 3b).

   No live SQS or Postgres: initDb() is mocked to hand back a dummy db, and
   insertClickEvents is spied so the test asserts which ClickEvents were drained
   into click_events and can make a chosen record's insert throw. This is the
   concrete "clicks survive freeze/thaw, asserted not assumed" proof on the
   consumer side — the redirect awaits the SQS send (see sqs-click-sink.test.ts)
   and the worker drains the queue into click_events here, with one bad message
   isolated to batchItemFailures. */

const insertClickEvents = vi.fn(async () => {});

vi.mock("@snapurl/database", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@snapurl/database")>();
  return { ...actual, insertClickEvents: (...args: unknown[]) => insertClickEvents(...args) };
});

const fakeDb = { __fake: true };
const runFrequent = vi.fn(async () => ({ rolled: { events: 0 } }));
const runMaintenance = vi.fn(async () => ({ ok: true }));
vi.mock("./main.js", () => ({
  initDb: vi.fn(async () => ({ db: fakeDb, close: async () => {} })),
  runFrequent: (...args: unknown[]) => runFrequent(...args),
  runMaintenance: (...args: unknown[]) => runMaintenance(...args),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

/* The backfill task's routine lives in the jobs module, not main.js, so it is
   mocked here to assert the dispatcher wires it (with the db handle and the
   optional chunkSize) and shapes the result as { task: "backfill", ...result }
   (the #294 entrypoint the SELF-HOSTING runbook depends on). */
const backfillClickPartitions = vi.fn(async () => ({ provisioned: 0, chunks: 1 }));
vi.mock("./jobs/rollup.js", () => ({
  backfillClickPartitions: (...args: unknown[]) => backfillClickPartitions(...args),
}));

// Imported after the mocks so the handler closes over them.
const { handler } = await import("./lambda.js");

function clickEvent(overrides: Partial<ClickEvent> = {}): ClickEvent {
  return {
    linkId: "11111111-1111-1111-1111-111111111111",
    workspaceId: "22222222-2222-2222-2222-222222222222",
    occurredAt: new Date("2025-01-02T03:04:05.678Z"),
    visitorHash: "abcdef0123456789abcdef0123456789",
    country: "IN",
    city: "Pune",
    device: "android",
    browser: "Chrome",
    os: "Android",
    referrerHost: "example.com",
    isQr: false,
    isBot: false,
    blockedReason: null,
    matchedRuleId: null,
    variant: null,
    ...overrides,
  };
}

function record(messageId: string, event: ClickEvent) {
  return { messageId, body: serializeClickEvent(event) };
}

describe("worker SQS click consumer", () => {
  beforeEach(() => {
    insertClickEvents.mockReset();
    insertClickEvents.mockResolvedValue(undefined);
  });

  it("drains every record in the batch into click_events and reports no failures", async () => {
    const events = [
      clickEvent({ linkId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" }),
      clickEvent({ linkId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" }),
      clickEvent({ linkId: "cccccccc-cccc-cccc-cccc-cccccccccccc" }),
    ];
    const result = await handler({
      Records: [record("m1", events[0]), record("m2", events[1]), record("m3", events[2])],
    });

    expect(result).toEqual({ batchItemFailures: [] });
    expect(insertClickEvents).toHaveBeenCalledTimes(3);
    // Each ClickEvent was revived (occurredAt is a Date again) and inserted.
    const inserted = insertClickEvents.mock.calls.map((c: any[]) => c[1][0]);
    expect(inserted).toEqual(events);
    expect(inserted[0].occurredAt).toBeInstanceOf(Date);
  });

  it("isolates a single bad message: only its id is in batchItemFailures, the rest still insert", async () => {
    // The second record's insert throws (a row the database rejects); the other
    // two must still land and only m2 must be redriven.
    insertClickEvents.mockImplementation(async (_db: unknown, events: ClickEvent[]) => {
      if (events[0].linkId === "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb") {
        throw new Error("insert rejected");
      }
    });

    const result = await handler({
      Records: [
        record("m1", clickEvent({ linkId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" })),
        record("m2", clickEvent({ linkId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" })),
        record("m3", clickEvent({ linkId: "cccccccc-cccc-cccc-cccc-cccccccccccc" })),
      ],
    });

    expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "m2" }] });
    // All three were attempted — one bad message does not short-circuit the batch.
    expect(insertClickEvents).toHaveBeenCalledTimes(3);
  });

  it("reports an unparseable body as a failure without throwing", async () => {
    const result = await handler({
      Records: [{ messageId: "bad", body: "not json" }],
    });
    expect(result).toEqual({ batchItemFailures: [{ itemIdentifier: "bad" }] });
    expect(insertClickEvents).not.toHaveBeenCalled();
  });
});

/* The `task` discriminator dispatch, and specifically the #294 `backfill` task.

   The backfill routine is exercised for real against Postgres in
   partitions.test.ts; what is proved here is the wiring the review flagged as
   missing: that an operator-triggered `{ task: "backfill" }` invocation actually
   reaches backfillClickPartitions on the same db handle the scheduled jobs use,
   forwards an optional chunkSize, and returns the `{ task, ...result }` shape the
   runbook and the AWS-profile Lambda path depend on. Kept alongside a
   maintenance-task assertion so the dispatch table stays covered as a whole. */
describe("worker task dispatch", () => {
  beforeEach(() => {
    backfillClickPartitions.mockReset();
    backfillClickPartitions.mockResolvedValue({ provisioned: 0, chunks: 1 });
    runMaintenance.mockReset();
    runMaintenance.mockResolvedValue({ ok: true } as never);
    runFrequent.mockReset();
    runFrequent.mockResolvedValue({ rolled: { events: 0 } } as never);
  });

  it("dispatches the backfill task to backfillClickPartitions and returns its result", async () => {
    backfillClickPartitions.mockResolvedValue({ provisioned: 12, chunks: 3 });

    const result = await handler({ task: "backfill" });

    // Wired to the routine, on the warm db handle, with no chunkSize override so
    // the routine's CLICK_EVENTS_BACKFILL_CHUNK_DAYS default applies.
    expect(backfillClickPartitions).toHaveBeenCalledTimes(1);
    expect(backfillClickPartitions).toHaveBeenCalledWith(fakeDb, undefined);
    // The shape the runbook/AWS Lambda path reads back.
    expect(result).toEqual({ task: "backfill", provisioned: 12, chunks: 3 });
  });

  it("forwards an explicit chunkSize on the backfill event to the routine", async () => {
    await handler({ task: "backfill", chunkSize: 50 });
    expect(backfillClickPartitions).toHaveBeenCalledWith(fakeDb, 50);
  });

  it("dispatches the maintenance task to runMaintenance", async () => {
    runMaintenance.mockResolvedValue({ ok: true } as never);
    const result = await handler({ task: "maintenance" });
    expect(runMaintenance).toHaveBeenCalledWith(fakeDb);
    expect(result).toEqual({ task: "maintenance", maintenance: { ok: true } });
    // A task branch that returns before backfill must not touch the routine.
    expect(backfillClickPartitions).not.toHaveBeenCalled();
  });

  it("does not treat a frequent invocation as a backfill", async () => {
    runFrequent.mockResolvedValue({ rolled: { events: 0 } } as never);
    const result = await handler({ task: "frequent" });
    expect(result).toEqual({ task: "frequent", frequent: { rolled: { events: 0 } } });
    expect(backfillClickPartitions).not.toHaveBeenCalled();
  });
});

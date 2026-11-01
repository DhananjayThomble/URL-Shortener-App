import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDatabase, sql, type Database } from "@snapurl/database";
import { buildEmf, emitBacklogMetrics, readBacklogCounts, type BacklogCounts } from "./backlog-metrics.js";

/* ============================================================
   #996 — backlog metrics.

   Two layers of test:

   1. PURE (always runs): the EMF line shape CloudWatch extracts from, and the
      BACKLOG_METRICS_NAMESPACE guard that keeps every non-AWS worker silent.
      These carry the behaviour the alarms depend on — the metric names and the
      guard — and need no database.

   2. DB-gated (runs only with DATABASE_URL, like the sibling worker suites):
      readBacklogCounts reflects rows actually in the tables. Asserted as a
      DELTA around seeded rows so it is robust to anything a sibling file left
      behind (the counts are global, by design — they mirror
      AdminHealthService.backlogs()).
   ============================================================ */

describe("buildEmf — the CloudWatch EMF line shape", () => {
  const counts: BacklogCounts = { outboxPending: 3, outboxStuck: 1, webhookPending: 5, webhookFailed: 2 };

  it("declares all four metrics under the given namespace with Count unit", () => {
    const emf = buildEmf("SnapURL/Backlog", counts, 1_700_000_000_000) as {
      _aws: { Timestamp: number; CloudWatchMetrics: Array<{ Namespace: string; Metrics: Array<{ Name: string; Unit: string }> }> };
    };
    const block = emf._aws.CloudWatchMetrics[0]!;
    expect(emf._aws.Timestamp).toBe(1_700_000_000_000);
    expect(block.Namespace).toBe("SnapURL/Backlog");
    expect(block.Metrics.map((m) => m.Name).sort()).toEqual(
      ["OutboxPending", "OutboxStuck", "WebhookFailed", "WebhookPending"].sort(),
    );
    expect(block.Metrics.every((m) => m.Unit === "Count")).toBe(true);
  });

  it("puts each metric value at the TOP LEVEL (where the EMF extractor reads it)", () => {
    const emf = buildEmf("SnapURL/Backlog", counts) as Record<string, unknown>;
    expect(emf.OutboxPending).toBe(3);
    expect(emf.OutboxStuck).toBe(1);
    expect(emf.WebhookPending).toBe(5);
    expect(emf.WebhookFailed).toBe(2);
  });
});

describe("emitBacklogMetrics — the BACKLOG_METRICS_NAMESPACE guard", () => {
  const db = {
    // readBacklogCounts issues exactly one execute; return the shape it maps.
    execute: vi.fn(async () => [
      { outbox_pending: 2, outbox_stuck: 0, webhook_pending: 1, webhook_failed: 0 },
    ]),
  } as unknown as Database;

  it("emits nothing and returns null when the namespace env is unset", async () => {
    const prev = process.env.BACKLOG_METRICS_NAMESPACE;
    delete process.env.BACKLOG_METRICS_NAMESPACE;
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const result = await emitBacklogMetrics(db);
      expect(result).toBeNull();
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
      if (prev === undefined) delete process.env.BACKLOG_METRICS_NAMESPACE;
      else process.env.BACKLOG_METRICS_NAMESPACE = prev;
    }
  });

  it("emits exactly one top-level EMF JSON line when the namespace is set", async () => {
    const prev = process.env.BACKLOG_METRICS_NAMESPACE;
    process.env.BACKLOG_METRICS_NAMESPACE = "SnapURL/Backlog";
    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((line: string) => void lines.push(line));
    try {
      const result = await emitBacklogMetrics(db);
      expect(result).toEqual({ outboxPending: 2, outboxStuck: 0, webhookPending: 1, webhookFailed: 0 });
      expect(lines).toHaveLength(1);
      const parsed = JSON.parse(lines[0]!) as Record<string, unknown>;
      expect(parsed._aws).toBeDefined();
      expect(parsed.OutboxPending).toBe(2);
      expect(parsed.WebhookPending).toBe(1);
    } finally {
      spy.mockRestore();
      if (prev === undefined) delete process.env.BACKLOG_METRICS_NAMESPACE;
      else process.env.BACKLOG_METRICS_NAMESPACE = prev;
    }
  });
});

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

describeDb("readBacklogCounts — against a real Postgres", () => {
  let handle: { db: Database; close: () => Promise<void> };
  let db: Database;
  // A unique link id so cleanup only removes this test's own outbox rows.
  const linkId = "00000000-0000-7000-8000-000000000996";

  beforeAll(async () => {
    handle = createDatabase({ url: DATABASE_URL!, max: 1 });
    db = handle.db;
  });

  afterAll(async () => {
    await db.execute(sql`delete from projection_outbox where link_id = ${linkId}`);
    await handle.close();
  });

  it("counts seeded outbox rows as pending vs stuck by the attempt ceiling", async () => {
    const before = await readBacklogCounts(db);

    // Two pending (attempts below the ceiling of 8) and one dead-lettered.
    await db.execute(sql`
      insert into projection_outbox (link_id, operation, payload, attempts, processed_at)
      values
        (${linkId}, 'upsert', '{}'::jsonb, 0, null),
        (${linkId}, 'upsert', '{}'::jsonb, 3, null),
        (${linkId}, 'delete', '{}'::jsonb, 8, null)
    `);

    const after = await readBacklogCounts(db);
    expect(after.outboxPending - before.outboxPending).toBe(2);
    expect(after.outboxStuck - before.outboxStuck).toBe(1);
  });
});

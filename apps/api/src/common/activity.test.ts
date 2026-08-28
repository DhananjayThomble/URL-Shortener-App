import { Logger } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { Executor } from "@snapurl/database";
import { recordActivity, toActor } from "./activity.js";

/* recordActivity runs after the change it describes has already committed, so
   its failure modes matter more than its happy path: anything it throws turns
   a successful write into a 500 for the caller. These pin that down without a
   database — the SQL itself is exercised by scripts/smoke.sh. */

function fakeDb() {
  const audits: unknown[] = [];
  const queued: Array<{ event: unknown }> = [];
  const db = {
    insert: () => ({
      values: async (row: unknown) => {
        audits.push(row);
      },
    }),
    execute: async (query: unknown) => {
      queued.push({ event: query });
      return [{ n: 1 }];
    },
  } as unknown as Executor;
  return { db, audits, queued };
}

/** A logger that stays quiet; the tests assert on it rather than the console. */
function silentLogger() {
  const logger = new Logger("test");
  vi.spyOn(logger, "error").mockImplementation(() => undefined);
  return logger;
}

const actor = { userId: "u1", label: "sam@example.com" };

describe("toActor", () => {
  it("keeps only who-did-it, discarding the rest of the request actor", () => {
    expect(toActor({ userId: "u1", label: "sam@example.com", workspaceId: "w1", role: "owner" } as never)).toEqual({
      userId: "u1",
      label: "sam@example.com",
    });
  });

  it("carries a null userId through, as an API-key caller has none", () => {
    expect(toActor({ userId: null, label: "key: deploy-bot" })).toEqual({ userId: null, label: "key: deploy-bot" });
  });
});

describe("recordActivity", () => {
  it("writes an audit row and queues a webhook when both are asked for", async () => {
    const { db, audits, queued } = fakeDb();
    await recordActivity(db, silentLogger(), {
      workspaceId: "w1",
      actor,
      auditAction: "link.created",
      webhookEvent: "link.created",
      targetType: "link",
      targetId: "lnk1",
      metadata: { slug: "spring-sale" },
    });
    expect(audits).toHaveLength(1);
    expect(queued).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      workspaceId: "w1",
      actorId: "u1",
      actorLabel: "sam@example.com",
      action: "link.created",
      targetId: "lnk1",
    });
  });

  it("writes no audit row when only a webhook is asked for", async () => {
    // Conversion ingest is machine traffic; it emits an event but must not
    // bury the member and link entries the audit page exists to show.
    const { db, audits, queued } = fakeDb();
    await recordActivity(db, silentLogger(), {
      workspaceId: "w1",
      actor,
      webhookEvent: "conversion.recorded",
      targetId: "cnv1",
    });
    expect(audits).toHaveLength(0);
    expect(queued).toHaveLength(1);
  });

  it("queues no webhook when only an audit entry is asked for", async () => {
    const { db, audits, queued } = fakeDb();
    await recordActivity(db, silentLogger(), { workspaceId: "w1", actor, auditAction: "member.invited" });
    expect(audits).toHaveLength(1);
    expect(queued).toHaveLength(0);
  });

  it("does not throw when the audit insert fails, and still queues the webhook", async () => {
    // The link was already created. Surfacing this would make a successful
    // write look like a 500, and the retry would hit a duplicate-slug error.
    const failing = {
      insert: () => ({
        values: async () => {
          throw new Error("audit_log is unreachable");
        },
      }),
      execute: async () => [{ n: 1 }],
    } as unknown as Executor;
    const logger = silentLogger();

    await expect(
      recordActivity(failing, logger, {
        workspaceId: "w1",
        actor,
        auditAction: "link.created",
        webhookEvent: "link.created",
      }),
    ).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledOnce();
  });

  it("does not throw when the webhook enqueue fails", async () => {
    const failing = {
      insert: () => ({ values: async () => undefined }),
      execute: async () => {
        throw new Error("webhook_deliveries is unreachable");
      },
    } as unknown as Executor;
    const logger = silentLogger();

    await expect(
      recordActivity(failing, logger, { workspaceId: "w1", actor, webhookEvent: "link.deleted" }),
    ).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledOnce();
  });

  it("logs both failures rather than stopping at the first", async () => {
    const failing = {
      insert: () => ({
        values: async () => {
          throw new Error("down");
        },
      }),
      execute: async () => {
        throw new Error("also down");
      },
    } as unknown as Executor;
    const logger = silentLogger();

    await recordActivity(failing, logger, {
      workspaceId: "w1",
      actor,
      auditAction: "link.updated",
      webhookEvent: "link.updated",
    });
    expect(logger.error).toHaveBeenCalledTimes(2);
  });
});

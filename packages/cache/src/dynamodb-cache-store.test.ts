import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import {
  addHashed,
  createSketch,
  estimate,
  hashForTesting,
  serialize,
} from "@snapurl/domain";
import { DynamoDbCacheStore } from "./dynamodb-cache-store.js";

/* MOCK-based unit tests: no live DynamoDB is available in-sandbox or
   in CI, so a fake DynamoDBDocumentClient whose `send` is stubbed by
   command constructor name asserts the RIGHT commands are issued. A
   live-Dynamo integration test is deferred to the deploy phase. */

const TABLE = "snapurl-cache";

/** The command name AWS SDK v3 sets on each command instance. */
function commandName(command: unknown): string {
  return (command as { constructor: { name: string } }).constructor.name;
}

describe("DynamoDbCacheStore", () => {
  let send: ReturnType<typeof vi.fn>;
  let store: DynamoDbCacheStore;

  function makeStore(handlers: Record<string, (input: unknown) => unknown>) {
    send = vi.fn(async (command: unknown) => {
      const name = commandName(command);
      const handler = handlers[name];
      if (!handler) throw new Error(`unexpected command ${name}`);
      return handler((command as { input: unknown }).input);
    });
    const client = { send } as unknown as DynamoDBDocumentClient;
    return new DynamoDbCacheStore(client, TABLE);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T00:00:00.000Z"));
  });

  it("incr sends an UpdateCommand with ADD + if_not_exists and returns the new value", async () => {
    let captured: any;
    store = makeStore({
      UpdateCommand: (input) => {
        captured = input;
        return { Attributes: { value: 3 } };
      },
    });

    const n = await store.incr("c", 60);
    expect(n).toBe(3);
    expect(captured.UpdateExpression).toContain("ADD");
    expect(captured.UpdateExpression).toContain("if_not_exists");
    // TTL is unix epoch seconds computed from ttlSeconds.
    expect(captured.ExpressionAttributeValues[":exp"]).toBe(
      Math.floor(Date.parse("2025-01-01T00:00:00.000Z") / 1000) + 60,
    );
  });

  it("incr without ttl sends ADD only (no SET of expiresAt)", async () => {
    let captured: any;
    store = makeStore({
      UpdateCommand: (input) => {
        captured = input;
        return { Attributes: { value: 1 } };
      },
    });
    const n = await store.incr("c");
    expect(n).toBe(1);
    expect(captured.UpdateExpression).toContain("ADD");
    expect(captured.UpdateExpression).not.toContain("if_not_exists");
  });

  it("set sends a PutCommand with a numeric expiresAt", async () => {
    let captured: any;
    store = makeStore({
      PutCommand: (input) => {
        captured = input;
        return {};
      },
    });
    await store.set("k", "v", 30);
    expect(captured.Item.pk).toBe("k");
    expect(captured.Item.value).toBe("v");
    expect(typeof captured.Item.expiresAt).toBe("number");
  });

  it("get returns the value for a live item", async () => {
    store = makeStore({
      GetCommand: () => ({ Item: { pk: "k", value: "v" } }),
    });
    expect(await store.get("k")).toBe("v");
  });

  it("get treats an expired item as absent", async () => {
    store = makeStore({
      GetCommand: () => ({
        Item: {
          pk: "k",
          value: "v",
          // Expired one second ago.
          expiresAt: Math.floor(Date.now() / 1000) - 1,
        },
      }),
    });
    expect(await store.get("k")).toBeNull();
  });

  it("get returns null for an absent item", async () => {
    store = makeStore({ GetCommand: () => ({}) });
    expect(await store.get("k")).toBeNull();
  });

  it("del sends a DeleteCommand", async () => {
    let called = false;
    store = makeStore({
      DeleteCommand: () => {
        called = true;
        return {};
      },
    });
    await store.del("k");
    expect(called).toBe(true);
  });

  it("mergeSketch sends Get then a conditional Put and returns the estimate", async () => {
    const b = createSketch();
    for (let i = 0; i < 300; i++) addHashed(b, hashForTesting(`b-${i}`));

    let put: any;
    store = makeStore({
      GetCommand: () => ({}), // absent -> start from empty sketch
      PutCommand: (input) => {
        put = input;
        return {};
      },
    });

    const result = await store.mergeSketch("s", b, 120);
    expect(put.ConditionExpression).toContain("attribute_not_exists");
    expect(put.Item.value).toBeInstanceOf(Uint8Array);
    expect(Buffer.from(put.Item.value)).toEqual(serialize(b));
    expect(put.Item.ver).toBe(1);
    expect(result.estimate).toBe(estimate(b));
  });

  it("mergeSketch retries on a ConditionalCheckFailedException then succeeds", async () => {
    const b = createSketch();
    for (let i = 0; i < 100; i++) addHashed(b, hashForTesting(`b-${i}`));

    let putAttempts = 0;
    store = makeStore({
      GetCommand: () => ({ Item: { pk: "s", ver: 1, value: createSketch() } }),
      PutCommand: () => {
        putAttempts++;
        if (putAttempts === 1) {
          const err = new Error("conditional failed");
          err.name = "ConditionalCheckFailedException";
          throw err;
        }
        return {};
      },
    });

    const result = await store.mergeSketch("s", b);
    expect(putAttempts).toBe(2);
    expect(result.estimate).toBe(estimate(b));
  });
});

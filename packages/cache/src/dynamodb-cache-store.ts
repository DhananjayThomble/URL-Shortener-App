import {
  DeleteCommand,
  GetCommand,
  PutCommand,
  UpdateCommand,
  type DynamoDBDocumentClient,
} from "@aws-sdk/lib-dynamodb";
import {
  createSketch,
  deserialize,
  estimate,
  merge,
  serialize,
} from "@snapurl/domain";
import type { CacheStore } from "./cache-store.js";

/* ============================================================
   DynamoDbCacheStore — the AWS-serverless-profile adapter
   (@aws-sdk/lib-dynamodb 3.1121.0).

   This is the adapter the architecture epic keeps on DynamoDB:
   in the AWS profile the rate-limit counters, the click queue and
   caching are served by DynamoDB, SQS and CloudFront rather than a
   Redis container, at a lower cost. The DynamoDBDocumentClient and
   the table name are injected via the constructor so the command
   shapes can be unit-tested against a mocked client.

   Item shape (single-table, partition key `pk` = the cache key):
     - `value`  a String (get/set), a Number (incr counter) or
                Binary (sketch bytes), depending on the operation;
     - `expiresAt` a Number in unix EPOCH SECONDS — DynamoDB TTL
                semantics, which deletes items lazily after this
                time; and
     - `ver`    a Number version used by mergeSketch for optimistic
                concurrency.

   Two design choices mirror the other adapters:

     - incr is a single UpdateCommand: `ADD` is an atomic counter,
       and `if_not_exists` sets the ttl only on the first write, so
       a fixed window is set once and never reset — the same
       contract the port defines. This implies an invariant: `incr`
       stores a Number under `value` while `set` stores a String
       there, so a single key must never be used for both a counter
       and a string value — `ADD` against a stored String would
       fail with a type error. Nothing mixes them on one key today
       (counter keys and value/cache keys are disjoint), and callers
       must keep them so.

     - mergeSketch keeps OUR @snapurl/domain sketch bytes (stored
       as Binary), not any DynamoDB-native format, so the byte
       layout is identical across all three adapters. Because
       DynamoDB has no server-side merge, it is a read-merge-write
       guarded by a version condition: read the current bytes and
       version, merge in JS, and conditionally write back with an
       incremented version. A ConditionalCheckFailedException means
       a concurrent writer won the race, so we re-read and retry a
       bounded number of times.
   ============================================================ */

/** Bounded retries for the optimistic mergeSketch write. */
const MERGE_MAX_ATTEMPTS = 5;

/** DynamoDB TTL is expressed in whole seconds since the epoch. */
function epochSeconds(ttlSeconds: number): number {
  return Math.floor(Date.now() / 1000) + ttlSeconds;
}

/** Now, in unix epoch seconds, for comparing against a stored TTL. */
function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export class DynamoDbCacheStore implements CacheStore {
  constructor(
    private readonly client: DynamoDBDocumentClient,
    private readonly table: string,
  ) {}

  async get(key: string): Promise<string | null> {
    const result = await this.client.send(
      new GetCommand({ TableName: this.table, Key: { pk: key } }),
    );
    const item = result.Item;
    if (!item) return null;
    // DynamoDB TTL deletion is eventually consistent, so an item may
    // still be readable after its expiry; treat that as absent.
    if (typeof item.expiresAt === "number" && item.expiresAt <= nowSeconds()) {
      return null;
    }
    return typeof item.value === "string" ? item.value : null;
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    const item: Record<string, unknown> = { pk: key, value };
    if (ttlSeconds !== undefined) item.expiresAt = epochSeconds(ttlSeconds);
    await this.client.send(
      new PutCommand({ TableName: this.table, Item: item }),
    );
  }

  async incr(key: string, ttlSeconds?: number): Promise<number> {
    // ADD is an atomic counter; if_not_exists stamps the ttl only on
    // the first write so the fixed window is never reset by a later
    // increment. When no ttl is given we ADD to the counter only.
    const command =
      ttlSeconds === undefined
        ? new UpdateCommand({
            TableName: this.table,
            Key: { pk: key },
            UpdateExpression: "ADD #v :one",
            ExpressionAttributeNames: { "#v": "value" },
            ExpressionAttributeValues: { ":one": 1 },
            ReturnValues: "UPDATED_NEW",
          })
        : new UpdateCommand({
            TableName: this.table,
            Key: { pk: key },
            UpdateExpression:
              "ADD #v :one SET #e = if_not_exists(#e, :exp)",
            ExpressionAttributeNames: { "#v": "value", "#e": "expiresAt" },
            ExpressionAttributeValues: {
              ":one": 1,
              ":exp": epochSeconds(ttlSeconds),
            },
            ReturnValues: "UPDATED_NEW",
          });
    const result = await this.client.send(command);
    return Number(result.Attributes?.value ?? 0);
  }

  async expire(key: string, ttlSeconds: number): Promise<void> {
    await this.client.send(
      new UpdateCommand({
        TableName: this.table,
        Key: { pk: key },
        UpdateExpression: "SET #e = :exp",
        ExpressionAttributeNames: { "#e": "expiresAt" },
        ExpressionAttributeValues: { ":exp": epochSeconds(ttlSeconds) },
      }),
    );
  }

  async del(key: string): Promise<void> {
    await this.client.send(
      new DeleteCommand({ TableName: this.table, Key: { pk: key } }),
    );
  }

  async pttl(key: string): Promise<number> {
    // DynamoDB has no TTL-read command, so derive the remainder from the
    // stored expiresAt (unix epoch SECONDS). Returns Redis-style sentinels:
    // -2 when the item is absent or already past its expiry, -1 when it
    // exists with no expiry. TTL deletion is eventually consistent, so an
    // item read after its expiry reports absent, matching get().
    const result = await this.client.send(
      new GetCommand({ TableName: this.table, Key: { pk: key } }),
    );
    const item = result.Item;
    if (!item) return -2;
    if (typeof item.expiresAt !== "number") return -1;
    const remainingMs = item.expiresAt * 1000 - Date.now();
    return remainingMs <= 0 ? -2 : remainingMs;
  }

  async mergeSketch(
    key: string,
    sketch: Uint8Array,
    ttlSeconds?: number,
  ): Promise<{ estimate: number }> {
    let lastError: unknown;
    for (let attempt = 0; attempt < MERGE_MAX_ATTEMPTS; attempt++) {
      // Read the current bytes and version.
      const read = await this.client.send(
        new GetCommand({ TableName: this.table, Key: { pk: key } }),
      );
      const item = read.Item;
      const currentBytes = item?.value;
      const currentVersion =
        typeof item?.ver === "number" ? item.ver : 0;
      const current =
        currentBytes instanceof Uint8Array
          ? deserialize(currentBytes)
          : createSketch();
      const merged = merge(current, sketch);

      const putItem: Record<string, unknown> = {
        pk: key,
        value: serialize(merged),
        ver: currentVersion + 1,
      };
      if (ttlSeconds !== undefined && !item) {
        // First write stamps the ttl; later merges keep the original.
        putItem.expiresAt = epochSeconds(ttlSeconds);
      } else if (typeof item?.expiresAt === "number") {
        putItem.expiresAt = item.expiresAt;
      }

      try {
        // Conditionally write: succeed only if nobody else advanced the
        // version since our read. This closes the read-merge-write race.
        await this.client.send(
          new PutCommand({
            TableName: this.table,
            Item: putItem,
            ConditionExpression:
              "attribute_not_exists(#ver) OR #ver = :expectedVer",
            ExpressionAttributeNames: { "#ver": "ver" },
            ExpressionAttributeValues: { ":expectedVer": currentVersion },
          }),
        );
        return { estimate: estimate(merged) };
      } catch (error) {
        // A lost race re-reads and retries; anything else propagates.
        if (isConditionalCheckFailed(error)) {
          lastError = error;
          continue;
        }
        throw error;
      }
    }
    throw new Error(
      `dynamodb: mergeSketch for ${JSON.stringify(key)} failed after ${MERGE_MAX_ATTEMPTS} attempts under contention`,
      { cause: lastError },
    );
  }
}

/** DynamoDB signals a failed optimistic write with this error name. */
function isConditionalCheckFailed(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    (error as { name?: unknown }).name === "ConditionalCheckFailedException"
  );
}

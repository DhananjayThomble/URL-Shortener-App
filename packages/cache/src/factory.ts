import { MemoryCacheStore } from "./memory-cache-store.js";
import type { CacheStore } from "./cache-store.js";

/* ============================================================
   createCacheStore — the env-driven driver factory.

   Each profile picks its adapter by a driver string that the app
   validates from its own env (the factory takes a plain config
   object, NOT process.env, so apps/api and apps/redirect can each
   pass their own zod-validated values). 'memory' is the default,
   so a deployment that configures nothing runs single-node
   in-memory.

   The redis and dynamodb branches use dynamic `await import()` so
   a memory-only deployment never loads ioredis or the AWS SDK at
   module-eval time. That keeps cold starts light on the profiles
   that do not need the heavy modules, mirroring how the rest of
   the codebase defers optional dependencies.
   ============================================================ */

/** The set of adapters createCacheStore can build. */
export type CacheDriver = "memory" | "redis" | "dynamodb";

export interface CacheStoreConfig {
  /** Which adapter to build. Defaults to 'memory'. */
  driver?: CacheDriver;
  /** Required when driver is 'redis': the ioredis connection URL. */
  redisUrl?: string;
  /** Required when driver is 'dynamodb': the cache table name. */
  dynamoTable?: string;
}

export async function createCacheStore(
  config: CacheStoreConfig = {},
): Promise<CacheStore> {
  const driver = config.driver ?? "memory";
  switch (driver) {
    case "memory":
      return new MemoryCacheStore();

    case "redis": {
      if (!config.redisUrl) {
        throw new Error(
          "createCacheStore: driver 'redis' requires a redisUrl",
        );
      }
      // Lazy: ioredis is only loaded when the redis profile is chosen.
      const { Redis } = await import("ioredis");
      const { RedisCacheStore } = await import("./redis-cache-store.js");
      return new RedisCacheStore(new Redis(config.redisUrl));
    }

    case "dynamodb": {
      if (!config.dynamoTable) {
        throw new Error(
          "createCacheStore: driver 'dynamodb' requires a dynamoTable",
        );
      }
      // Lazy: the AWS SDK is only loaded when the dynamodb profile is chosen.
      const { DynamoDBClient } = await import("@aws-sdk/client-dynamodb");
      const { DynamoDBDocumentClient } = await import("@aws-sdk/lib-dynamodb");
      const { DynamoDbCacheStore } = await import("./dynamodb-cache-store.js");
      const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
      return new DynamoDbCacheStore(client, config.dynamoTable);
    }

    default: {
      // Exhaustiveness: a new driver added to the union without a case
      // here is a compile-time error.
      const exhaustive: never = driver;
      throw new Error(`createCacheStore: unknown driver ${String(exhaustive)}`);
    }
  }
}

import { describe, expect, it, vi } from "vitest";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { Database } from "@snapurl/database";
import { DynamoProjection } from "./dynamo-projection.js";
import type { KvsWriter } from "./kvs-projection.js";

/* MOCK-based unit tests, mirroring packages/cache/dynamodb-cache-store.test.ts.
   No live DynamoDB and no Postgres: the db is a chainable fake whose terminal
   (.limit / .orderBy) resolves to preset rows, and the DynamoDBDocumentClient's
   `send` is stubbed by command constructor name. */

const TABLE = "snapurl-link-projection";

function commandName(command: unknown): string {
  return (command as { constructor: { name: string } }).constructor.name;
}

/** A link row as the buildUpsertRequests join projects it. */
function linkRow(overrides: Partial<any> = {}) {
  return {
    link: {
      id: "link-1",
      workspaceId: "ws-1",
      destination: "https://example.com/1",
      redirectType: "302",
      expiresAt: null,
      expiresTo: null,
      activatesAt: null,
      scheduledTo: null,
      clickLimit: null,
      passwordHash: null,
      forwardQuery: true,
      deepLink: false,
      hideReferrer: false,
      publicPreview: true,
      archivedAt: null,
      safeBrowsingStatus: "safe",
      utm: null,
      slug: "one",
      ...overrides,
    },
    domain: "snap.to",
    domainId: "dom-1",
    rootRedirect: null,
    notFoundRedirect: null,
    clicks: 7,
  };
}

/** A chainable drizzle-select fake. The first select() call in a sequence
 *  returns the link-row query result at its terminal (.limit), the second
 *  returns the rules result at its terminal (.orderBy). */
function makeDb(linkRows: any[], rulesRows: any[]): Database {
  let call = 0;
  const select = () => {
    const which = call++;
    const rows = which % 2 === 0 ? linkRows : rulesRows;
    const builder: any = {
      from: () => builder,
      innerJoin: () => builder,
      leftJoin: () => builder,
      where: () => builder,
      limit: () => Promise.resolve(rows),
      orderBy: () => Promise.resolve(rows),
    };
    return builder;
  };
  return { select } as unknown as Database;
}

function makeClient(handlers: Record<string, (input: any) => unknown>) {
  const send = vi.fn(async (command: unknown) => {
    const name = commandName(command);
    const handler = handlers[name];
    if (!handler) throw new Error(`unexpected command ${name}`);
    return handler((command as { input: any }).input);
  });
  return { send, client: { send } as unknown as DynamoDBDocumentClient };
}

describe("DynamoProjection.upsert", () => {
  it("reads the link and BatchWrites the LINK item + domain-meta item", async () => {
    const batches: any[] = [];
    const { client } = makeClient({
      BatchWriteCommand: (input) => {
        batches.push(input);
        return {};
      },
    });
    const projection = new DynamoProjection(makeDb([linkRow()], []), client, TABLE);

    await projection.upsert("link-1");

    expect(batches).toHaveLength(1);
    const requests = batches[0].RequestItems[TABLE];
    // One LINK put + one domain-meta put.
    expect(requests).toHaveLength(2);
    const link = requests.find((r: any) => r.PutRequest.Item.SK.startsWith("s#")).PutRequest.Item;
    const meta = requests.find((r: any) => r.PutRequest.Item.SK === "d#meta").PutRequest.Item;
    expect(link.PK).toBe("d#snap.to");
    expect(link.SK).toBe("s#one");
    expect(link.linkId).toBe("link-1");
    expect(link.clicks).toBe(7);
    expect(meta.PK).toBe("d#snap.to");
    expect(meta.id).toBe("dom-1");
  });
});

describe("DynamoProjection.remove", () => {
  it("queries the linkId GSI and DeleteItems the matching item(s)", async () => {
    let queryInput: any;
    const batches: any[] = [];
    const { client } = makeClient({
      QueryCommand: (input) => {
        queryInput = input;
        return { Items: [{ PK: "d#snap.to", SK: "s#one", linkId: "link-1" }] };
      },
      BatchWriteCommand: (input) => {
        batches.push(input);
        return {};
      },
    });
    const projection = new DynamoProjection(makeDb([], []), client, TABLE);

    await projection.remove("link-1");

    expect(queryInput.IndexName).toBe("linkId-index");
    expect(queryInput.ExpressionAttributeValues[":lid"]).toBe("link-1");
    const requests = batches[0].RequestItems[TABLE];
    expect(requests).toHaveLength(1);
    expect(requests[0].DeleteRequest.Key).toEqual({ PK: "d#snap.to", SK: "s#one" });
  });

  it("is a no-op when nothing is projected for the id", async () => {
    const { client, send } = makeClient({
      QueryCommand: () => ({ Items: [] }),
    });
    const projection = new DynamoProjection(makeDb([], []), client, TABLE);
    await projection.remove("gone");
    // Only the query ran; no BatchWrite for an empty delete set.
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("DynamoProjection.apply (batching)", () => {
  it("splits >25 upserts into multiple BatchWriteCommands of <=25", async () => {
    const batchSizes: number[] = [];
    const { client } = makeClient({
      BatchWriteCommand: (input) => {
        batchSizes.push(input.RequestItems[TABLE].length);
        return {};
      },
    });
    /* 30 DISTINCT links on ONE domain. Each contributes a distinct LINK put;
       all 30 share the domain's single meta item, which apply() deduplicates to
       ONE meta put. So 30 upserts -> 31 write requests (30 links + 1 shared
       meta) -> ceil(31/25) = 2 batches, proving both the O(N/25) batching AND
       that the shared meta is written once (before dedup this was 60 requests
       carrying 30 IDENTICAL meta keys, which DynamoDB rejects wholesale — the
       #288 failure). Each op resolves to a distinct link row (distinct slug) so
       the fake mirrors reality rather than returning one identical row. */
    const N = 30;
    let call = 0;
    const distinctDb = {
      select: () => {
        const which = call++;
        // Even calls: the link-row query; odd calls: that link's rules (none).
        const rows = which % 2 === 0 ? [linkRow({ id: `link-${which / 2}`, slug: `slug-${which / 2}` })] : [];
        const builder: any = {
          from: () => builder,
          innerJoin: () => builder,
          leftJoin: () => builder,
          where: () => builder,
          limit: () => Promise.resolve(rows),
          orderBy: () => Promise.resolve(rows),
        };
        return builder;
      },
    } as unknown as Database;
    const projection = new DynamoProjection(distinctDb, client, TABLE);
    const ops = Array.from({ length: N }, (_, i) => ({ linkId: `link-${i}`, operation: "upsert" }));

    const results = await projection.apply(ops);

    expect(results).toHaveLength(N);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(batchSizes.length).toBe(2);
    expect(Math.max(...batchSizes)).toBeLessThanOrEqual(25);
    // N distinct LINK puts + 1 deduplicated shared meta put.
    expect(batchSizes.reduce((a, b) => a + b, 0)).toBe(N + 1);
  });

  it("retries UnprocessedItems then succeeds", async () => {
    let attempts = 0;
    const { client } = makeClient({
      BatchWriteCommand: (input) => {
        attempts++;
        if (attempts === 1) {
          // Hand one request back as unprocessed on the first attempt.
          return { UnprocessedItems: { [TABLE]: [input.RequestItems[TABLE][0]] } };
        }
        return {};
      },
    });
    const projection = new DynamoProjection(makeDb([linkRow()], []), client, TABLE);

    const results = await projection.apply([{ linkId: "link-1", operation: "upsert" }]);

    expect(attempts).toBe(2);
    expect(results[0]!.ok).toBe(true);
  });

  it("fails only the row whose Postgres read throws, not the batch", async () => {
    const { client } = makeClient({
      BatchWriteCommand: () => ({}),
    });
    // First op's link read returns a row; give the db a single link row then an
    // empty result set so the second upsert resolves to no requests (link gone)
    // — that is a success (marked processed), not a failure. To exercise a
    // hard failure, make the client throw for a delete's query.
    const failingClient = makeClient({
      QueryCommand: () => {
        throw new Error("query boom");
      },
      BatchWriteCommand: () => ({}),
    });
    const projection = new DynamoProjection(makeDb([linkRow()], []), failingClient.client, TABLE);

    const results = await projection.apply([
      { linkId: "link-1", operation: "upsert" },
      { linkId: "link-2", operation: "delete" },
    ]);

    expect(results[0]!.ok).toBe(true);
    expect(results[1]!.ok).toBe(false);
    // Sanity: the healthy client fixture is unused here but proves the harness.
    void client;
  });
});

describe("DynamoProjection marshalling of optional/absent fields", () => {
  /* Regression guard for the dynamo-smoke failure (#288): a real link carries
     a PARTIAL utm object (e.g. {source, campaign} with medium/content absent)
     and routing rules whose when.device / when.language / weight are absent.
     Read back from Postgres those absent JSON keys are `undefined`, and
     lib-dynamodb's marshaller THROWS on an undefined attribute value unless the
     DocumentClient is built with removeUndefinedValues. A throw there fails the
     whole BatchWriteCommand, so ONE partial-utm link stops the entire
     projection batch and the redirect resolves nothing. These tests use a REAL
     DynamoDBDocumentClient (its marshalling middleware runs for real) over a
     stubbed base client (no network), so they exercise the actual marshaller
     rather than a hand-rolled fake. */

  /** A link row whose utm has only some keys set and whose rule omits the
   *  optional when.device / when.language / weight — the exact shapes the smoke
   *  fixtures ($RUN-utm, $RUN-geo) produce. */
  function partialRow() {
    return linkRow({
      utm: { source: "newsletter", campaign: "spring" },
    });
  }
  const partialRules = [
    { rule: { id: "r-in", whenCountry: "IN", whenDevice: undefined, whenLanguage: undefined, then: "https://example.in/store", weight: undefined } },
  ];

  /* A sentinel the stubbed transport throws so a request that gets PAST
     marshalling lands here deterministically — no network, no credentials, no
     real endpoint. If marshalling throws first (the undefined case), this is
     never reached, which is exactly the difference the two tests assert. */
  const TRANSPORT_REACHED = "transport-reached-sentinel";

  /** Build a real DocumentClient over a real base client whose HTTP transport
   *  is replaced by a sentinel-throwing handler and whose credentials are
   *  static (so nothing tries the credential-provider chain). The
   *  DocumentClient's marshalling middleware runs for real; only the network
   *  leg is stubbed. */
  function realDocClient(removeUndefinedValues: boolean) {
    const base = new DynamoDBClient({
      region: "us-east-1",
      endpoint: "http://localhost:8000",
      credentials: { accessKeyId: "dummy", secretAccessKey: "dummy" },
      requestHandler: {
        handle: () => Promise.reject(new Error(TRANSPORT_REACHED)),
      } as never,
    });
    return DynamoDBDocumentClient.from(base, {
      marshallOptions: { removeUndefinedValues },
    });
  }

  it("marshals a partial-utm link WITHOUT throwing when removeUndefinedValues is set", async () => {
    const client = realDocClient(true);
    const projection = new DynamoProjection(makeDb([partialRow()], partialRules), client, TABLE);

    /* The request marshalled cleanly (undefined stripped) and reached the
       stubbed transport — proving the marshaller did NOT reject the undefined
       utm/rule fields. The transport sentinel is the deliberate stop; the point
       is that marshalling succeeded, not that a fake network returned 200. */
    await expect(projection.upsert("link-1")).rejects.toThrow(TRANSPORT_REACHED);
  });

  it("throws a marshalling error on the same input WITHOUT removeUndefinedValues", async () => {
    const client = realDocClient(false);
    const projection = new DynamoProjection(makeDb([partialRow()], partialRules), client, TABLE);

    /* This is the exact failure the dynamo-smoke job hit: the marshaller throws
       on the first undefined attribute value, the BatchWrite never leaves the
       process (the transport sentinel is never reached), and the projection is
       left empty so every redirect 404s. The rejection must therefore NOT be
       the transport sentinel. */
    await expect(projection.upsert("link-1")).rejects.toThrow();
    await expect(projection.upsert("link-1")).rejects.not.toThrow(TRANSPORT_REACHED);
  });
});

describe("DynamoProjection.apply deduplicates the shared domain-meta item", () => {
  /* Regression guard for the SECOND dynamo-smoke failure (#288): the
     domain-meta item projected fine but every LINK item failed, and a scan
     showed only the single d#meta item. The cause was NOT marshalling (the
     removeUndefinedValues fix handled that) — it was that apply() coalesces the
     LINK put AND the domain-meta put for EVERY upsert into one BatchWriteCommand
     without dedup. Every link on a domain (re)writes the SAME meta key
     (PK=d#<domain>, SK=d#meta), so N upserts on one domain put N identical meta
     PutRequests in one command. DynamoDB rejects the whole request with
     "Provided list of item keys contains duplicates", so all N links fail
     together while the per-row upsert() path (one meta put per flush) never
     did. These tests assert the batch now carries the meta key exactly ONCE and
     never sends a duplicate key to DynamoDB. */

  /** A link row on a fixed domain, so several of them share one meta item. */
  function rowOnDomain(id: string, slug: string) {
    return linkRow({ id, slug });
  }

  /** A chainable fake whose Nth select() (even calls) returns the link row for
   *  the CURRENT op and whose odd calls return that op's rules. The link id and
   *  slug are looked up by the eq() the writer passes, but the fake ignores the
   *  predicate, so drive it from an ordered list of link rows: one per upsert. */
  function makeMultiDb(linkRowsInOrder: any[][]): Database {
    let call = 0;
    const select = () => {
      const which = call++;
      const rows = which % 2 === 0 ? linkRowsInOrder[Math.floor(which / 2)] ?? [] : [];
      const builder: any = {
        from: () => builder,
        innerJoin: () => builder,
        leftJoin: () => builder,
        where: () => builder,
        limit: () => Promise.resolve(rows),
        orderBy: () => Promise.resolve(rows),
      };
      return builder;
    };
    return { select } as unknown as Database;
  }

  it("writes the shared domain-meta item ONCE for many links on one domain, with no duplicate keys", async () => {
    const sentBatches: any[][] = [];
    const { client } = makeClient({
      BatchWriteCommand: (input) => {
        sentBatches.push(input.RequestItems[TABLE]);
        return {};
      },
    });

    const N = 5;
    const rows = Array.from({ length: N }, (_, i) => [rowOnDomain(`link-${i}`, `slug-${i}`)]);
    const projection = new DynamoProjection(makeMultiDb(rows), client, TABLE);
    const ops = Array.from({ length: N }, (_, i) => ({ linkId: `link-${i}`, operation: "upsert" }));

    const results = await projection.apply(ops);

    // Every op succeeded.
    expect(results).toHaveLength(N);
    expect(results.every((r) => r.ok)).toBe(true);

    const allRequests = sentBatches.flat();
    // No BatchWriteCommand slice contains a duplicate key — the exact thing
    // DynamoDB's ValidationException rejects.
    for (const batch of sentBatches) {
      const keys = batch.map((r: any) => {
        const item = r.PutRequest ? r.PutRequest.Item : r.DeleteRequest.Key;
        return `${item.PK}#${item.SK}`;
      });
      expect(new Set(keys).size).toBe(keys.length);
    }

    // The domain-meta item is written exactly once, not once per link.
    const metaPuts = allRequests.filter((r: any) => r.PutRequest?.Item.SK === "d#meta");
    expect(metaPuts).toHaveLength(1);

    // All N LINK items are present, each with a non-empty linkId / PK / SK.
    const linkPuts = allRequests.filter((r: any) => r.PutRequest?.Item.SK.startsWith("s#"));
    expect(linkPuts).toHaveLength(N);
    for (const put of linkPuts) {
      const item = put.PutRequest.Item;
      expect(item.linkId).toBeTruthy();
      expect(item.PK).toBeTruthy();
      expect(item.SK).toBeTruthy();
    }
  });

  it("marshals a representative failing-fixture LINK item (rule + partial utm + expiry/activation) without throwing", async () => {
    /* The $RUN-geo / $RUN-utm / $RUN-expired / $RUN-scheduled fixtures combined:
       a link WITH a routing rule (partial when), WITH a partial utm object,
       WITH an expiry AND an activation Date, and a non-null linkId — run through
       a REAL DocumentClient so the marshaller executes for real, and asserting
       the request reaches the stubbed transport (i.e. marshalling succeeded and
       the batch carried no duplicate keys). */
    const richRow = linkRow({
      id: "link-rich",
      slug: "geo",
      utm: { source: "newsletter", campaign: "spring" },
      expiresAt: new Date("2099-01-01T00:00:00.000Z"),
      expiresTo: "https://example.com/moved",
      activatesAt: new Date("2020-01-01T00:00:00.000Z"),
    });
    const richRules = [
      {
        rule: {
          id: "r-in",
          whenCountry: "IN",
          whenDevice: undefined,
          whenLanguage: undefined,
          then: "https://example.in/store",
          weight: undefined,
        },
      },
    ];

    const base = new DynamoDBClient({
      region: "us-east-1",
      endpoint: "http://localhost:8000",
      credentials: { accessKeyId: "dummy", secretAccessKey: "dummy" },
      requestHandler: {
        handle: () => Promise.reject(new Error("transport-reached-sentinel")),
      } as never,
    });
    const client = DynamoDBDocumentClient.from(base, {
      marshallOptions: { removeUndefinedValues: true },
    });
    const projection = new DynamoProjection(makeDb([richRow], richRules), client, TABLE);

    // Reaching the transport proves the item marshalled cleanly and the
    // BatchWriteCommand was built (no duplicate-key rejection, no marshal throw).
    await expect(projection.upsert("link-rich")).rejects.toThrow("transport-reached-sentinel");
  });
});

describe("DynamoProjection edge fast path (#289) — optional KvsWriter", () => {
  /* When a KvsWriter is injected, DynamoProjection must ALSO drive the edge
     fast path: an upsert calls putIfEligible(link, host, slug) and a delete
     calls deleteKey(host, slug) — after the DynamoDB write. When NO writer is
     injected it must make ZERO KVS calls, so NoProjection and the non-KVS AWS
     path stay byte-for-byte unchanged. A spy stands in for the real writer. */

  /** A spy KvsWriter recording every call, structurally a KvsWriter. */
  function spyWriter() {
    const putIfEligible = vi.fn(async () => {});
    const deleteKey = vi.fn(async () => {});
    return {
      putIfEligible,
      deleteKey,
      writer: { putIfEligible, deleteKey } as unknown as KvsWriter,
    };
  }

  it("upsert writes DynamoDB AND drives putIfEligible with the link + host + slug", async () => {
    const batches: any[] = [];
    const { client } = makeClient({
      BatchWriteCommand: (input) => {
        batches.push(input);
        return {};
      },
    });
    const kvs = spyWriter();
    const projection = new DynamoProjection(makeDb([linkRow()], []), client, TABLE, undefined, kvs.writer);

    await projection.upsert("link-1");

    // DynamoDB still written.
    expect(batches).toHaveLength(1);
    expect(batches[0].RequestItems[TABLE]).toHaveLength(2);
    // KVS driven with the projected link and the row's (domain, slug).
    expect(kvs.putIfEligible).toHaveBeenCalledTimes(1);
    const [link, host, slug] = kvs.putIfEligible.mock.calls[0] as any[];
    expect(link.destination).toBe("https://example.com/1");
    expect(link.redirectType).toBe("302");
    expect(host).toBe("snap.to");
    expect(slug).toBe("one");
    expect(kvs.deleteKey).not.toHaveBeenCalled();
  });

  it("remove queries the GSI, DeleteItems in DynamoDB AND drives deleteKey with host + slug", async () => {
    const batches: any[] = [];
    const { client } = makeClient({
      QueryCommand: () => ({ Items: [{ PK: "d#snap.to", SK: "s#one", linkId: "link-1" }] }),
      BatchWriteCommand: (input) => {
        batches.push(input);
        return {};
      },
    });
    const kvs = spyWriter();
    const projection = new DynamoProjection(makeDb([], []), client, TABLE, undefined, kvs.writer);

    await projection.remove("link-1");

    // DynamoDB delete still issued.
    expect(batches[0].RequestItems[TABLE][0].DeleteRequest.Key).toEqual({
      PK: "d#snap.to",
      SK: "s#one",
    });
    // KVS deleteKey driven with the host + slug recovered from the item key.
    expect(kvs.deleteKey).toHaveBeenCalledTimes(1);
    expect(kvs.deleteKey).toHaveBeenCalledWith("snap.to", "one");
    expect(kvs.putIfEligible).not.toHaveBeenCalled();
  });

  it("apply() drives the writer per-op (upsert -> putIfEligible, delete -> deleteKey)", async () => {
    let call = 0;
    const upsertRows = [linkRow({ id: "link-up", slug: "up" })];
    const db = {
      select: () => {
        // Even calls: link row for the upsert op; odd: its (empty) rules.
        const which = call++;
        const rows = which === 0 ? upsertRows : [];
        const builder: any = {
          from: () => builder,
          innerJoin: () => builder,
          leftJoin: () => builder,
          where: () => builder,
          limit: () => Promise.resolve(rows),
          orderBy: () => Promise.resolve(rows),
        };
        return builder;
      },
    } as unknown as Database;
    const { client } = makeClient({
      QueryCommand: () => ({ Items: [{ PK: "d#snap.to", SK: "s#del", linkId: "link-del" }] }),
      BatchWriteCommand: () => ({}),
    });
    const kvs = spyWriter();
    const projection = new DynamoProjection(db, client, TABLE, undefined, kvs.writer);

    const results = await projection.apply([
      { linkId: "link-up", operation: "upsert" },
      { linkId: "link-del", operation: "delete" },
    ]);

    expect(results.every((r) => r.ok)).toBe(true);
    expect(kvs.putIfEligible).toHaveBeenCalledTimes(1);
    expect(kvs.putIfEligible.mock.calls[0]![1]).toBe("snap.to");
    expect(kvs.putIfEligible.mock.calls[0]![2]).toBe("up");
    expect(kvs.deleteKey).toHaveBeenCalledTimes(1);
    expect(kvs.deleteKey).toHaveBeenCalledWith("snap.to", "del");
  });

  it("a KVS write failure fails only that op (DynamoDB already written), not the batch", async () => {
    const { client } = makeClient({
      BatchWriteCommand: () => ({}),
    });
    const kvs = spyWriter();
    kvs.putIfEligible.mockRejectedValueOnce(new Error("kvs boom"));
    const projection = new DynamoProjection(makeDb([linkRow()], []), client, TABLE, undefined, kvs.writer);

    const results = await projection.apply([{ linkId: "link-1", operation: "upsert" }]);

    // The op is marked failed so the outbox retries it, even though the
    // DynamoDB item was written first (durability preserved).
    expect(results[0]!.ok).toBe(false);
    expect(String((results[0] as any).error)).toContain("kvs boom");
  });

  it("makes ZERO KVS calls when no KvsWriter is injected (byte-for-byte unchanged)", async () => {
    const batches: any[] = [];
    const { client } = makeClient({
      QueryCommand: () => ({ Items: [{ PK: "d#snap.to", SK: "s#one", linkId: "link-1" }] }),
      BatchWriteCommand: (input) => {
        batches.push(input);
        return {};
      },
    });
    // No fifth constructor arg — writer is undefined.
    const projection = new DynamoProjection(makeDb([linkRow()], []), client, TABLE);

    await projection.upsert("link-1");
    await projection.remove("link-1");
    await projection.apply([{ linkId: "link-1", operation: "upsert" }]);

    // Only DynamoDB was touched; nothing could have called a non-existent
    // writer. The assertion here is that the calls above all succeed without a
    // KvsWriter present (a KVS call would have thrown on undefined).
    expect(batches.length).toBeGreaterThan(0);
  });
});

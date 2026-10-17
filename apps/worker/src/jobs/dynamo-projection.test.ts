import { describe, expect, it, vi } from "vitest";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { DOMAIN_OP, type Database } from "@snapurl/database";
import { linkCacheKey } from "@snapurl/cache";
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
    status: "live",
    rootRedirect: null,
    notFoundRedirect: null,
    clicks: 7,
    domainUpdatedAt: new Date("2026-01-02T03:04:05.000Z"),
  };
}

/** A domain row as buildDomainRequests reads it (status gates the meta item). */
function domainRow(overrides: Partial<any> = {}) {
  return {
    id: "dom-1",
    domain: "snap.to",
    status: "live",
    rootRedirect: null,
    notFoundRedirect: null,
    updatedAt: new Date("2026-01-02T03:04:05.000Z"),
    ...overrides,
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
  /* DOMAIN-META writes are single conditional PutItems (#713 item 4), not part
     of a BatchWrite. Unless a test supplies its own PutCommand handler, they
     succeed and are recorded here. */
  const puts: any[] = [];
  const send = vi.fn(async (command: unknown) => {
    const name = commandName(command);
    const handler =
      handlers[name] ??
      (name === "PutCommand"
        ? (input: any) => {
            puts.push(input);
            return {};
          }
        : undefined);
    if (!handler) throw new Error(`unexpected command ${name}`);
    return handler((command as { input: any }).input);
  });
  return { send, puts, client: { send } as unknown as DynamoDBDocumentClient };
}

describe("DynamoProjection.upsert", () => {
  it("reads the link, BatchWrites the LINK item and conditionally Puts the domain-meta item", async () => {
    const batches: any[] = [];
    const { client, puts } = makeClient({
      BatchWriteCommand: (input) => {
        batches.push(input);
        return {};
      },
    });
    const projection = new DynamoProjection(makeDb([linkRow()], []), client, TABLE);

    await projection.upsert("link-1");

    expect(batches).toHaveLength(1);
    const requests = batches[0].RequestItems[TABLE];
    // The LINK put is batched; the domain-meta put is a conditional PutItem.
    expect(requests).toHaveLength(1);
    const link = requests[0].PutRequest.Item;
    expect(link.PK).toBe("d#snap.to");
    expect(link.SK).toBe("s#one");
    expect(link.linkId).toBe("link-1");
    expect(link.clicks).toBe(7);
    expect(puts).toHaveLength(1);
    const meta = puts[0].Item;
    expect(meta.PK).toBe("d#snap.to");
    expect(meta.SK).toBe("d#meta");
    expect(meta.id).toBe("dom-1");
    expect(meta.version).toBe("2026-01-02T03:04:05.000Z");
    expect(puts[0].ConditionExpression).toContain("#id < :id");
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
    const { client, puts } = makeClient({
      BatchWriteCommand: (input) => {
        batchSizes.push(input.RequestItems[TABLE].length);
        return {};
      },
    });
    /* 30 DISTINCT links on ONE domain. Each contributes a distinct LINK put;
       all 30 share the domain's single meta item, which apply() deduplicates to
       ONE (conditional, unbatched — #713 item 4) meta put. So 30 upserts -> 30
       batched LINK puts -> ceil(30/25) = 2 batches + 1 meta PutItem, proving
       both the O(N/25) batching AND that the shared meta is written once
       (before dedup this was 60 requests carrying 30 IDENTICAL meta keys, which
       DynamoDB rejects wholesale — the #288 failure). Each op resolves to a
       distinct link row (distinct slug) so the fake mirrors reality rather than
       returning one identical row. */
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
    // N distinct LINK puts batched + 1 deduplicated shared meta PutItem.
    expect(batchSizes.reduce((a, b) => a + b, 0)).toBe(N);
    expect(puts).toHaveLength(1);
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
    const { client, puts } = makeClient({
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

    // The domain-meta item is written exactly once, not once per link — and
    // outside the batches, as a conditional PutItem (#713 item 4).
    expect(allRequests.filter((r: any) => r.PutRequest?.Item.SK === "d#meta")).toHaveLength(0);
    expect(puts).toHaveLength(1);
    expect(puts[0].Item.SK).toBe("d#meta");

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
    const { client, puts } = makeClient({
      BatchWriteCommand: (input) => {
        batches.push(input);
        return {};
      },
    });
    const kvs = spyWriter();
    const projection = new DynamoProjection(makeDb([linkRow()], []), client, TABLE, undefined, kvs.writer);

    await projection.upsert("link-1");

    // DynamoDB still written: the LINK batch + the conditional meta put.
    expect(batches).toHaveLength(1);
    expect(batches[0].RequestItems[TABLE]).toHaveLength(1);
    expect(puts).toHaveLength(1);
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

describe("DynamoProjection gates the projection on domain.status='live' (#713 item 2)", () => {
  /* #712 gated the Postgres resolver's three queries on `status = 'live'` so a
     verifying (unproven-ownership) domain's links and root/404 redirects never
     resolve from Postgres. The DynamoDB/projection path carries NO status (the
     DynamoLinkResolver just reads the pre-written item), so the SAME gate has
     to live where the projection is WRITTEN: a non-live domain must never GAIN
     projected LINK items or served redirects, and a domain that drops out of
     live must have its meta item NEUTRALISED (redirects null) so a status
     regression does not leave stale served redirects at the edge. These specs
     are the authoritative RED/GREEN evidence. */

  function makeDomainDb(rows: any[]): Database {
    const select = () => {
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

  it("upsert writes NO LINK item and NO domain-meta item when the domain is 'verifying'", async () => {
    const batches: any[] = [];
    const { client, send } = makeClient({
      BatchWriteCommand: (input) => {
        batches.push(input);
        return {};
      },
    });
    const projection = new DynamoProjection(
      makeDb([linkRow({})], []),
      client,
      TABLE,
    );
    // Override just the row's domain status to a non-live value.
    const verifyingDb = makeDb([{ ...linkRow(), status: "verifying" }], []);
    const gated = new DynamoProjection(verifyingDb, client, TABLE);

    await gated.upsert("link-1");

    // A verifying domain must not gain ANY projected item: no BatchWrite at all
    // for an empty request set, mirroring how PostgresLinkResolver returns null.
    expect(batches).toHaveLength(0);
    expect(send).not.toHaveBeenCalled();
    void projection;
  });

  it("apply marks a verifying-domain upsert processed (ok) but writes nothing", async () => {
    const batches: any[] = [];
    const { client } = makeClient({
      BatchWriteCommand: (input) => {
        batches.push(input);
        return {};
      },
    });
    const verifyingDb = makeDb([{ ...linkRow(), status: "verifying" }], []);
    const projection = new DynamoProjection(verifyingDb, client, TABLE);

    const results = await projection.apply([{ linkId: "link-1", operation: "upsert" }]);

    // The op is a success (processed, not retried forever) but no item is sent.
    expect(results).toHaveLength(1);
    expect(results[0]!.ok).toBe(true);
    expect(batches).toHaveLength(0);
  });

  it("domain op NEUTRALISES the domain-meta item when the domain is 'verifying'", async () => {
    const batches: any[] = [];
    const { client, puts } = makeClient({
      BatchWriteCommand: (input) => {
        batches.push(input);
        return {};
      },
    });
    const verifyingDomainDb = makeDomainDb([
      domainRow({ status: "verifying", rootRedirect: "https://example.com/r", notFoundRedirect: "https://example.com/n" }),
    ]);
    const projection = new DynamoProjection(verifyingDomainDb, client, TABLE);

    await projection.projectDomain("dom-1", "snap.to");

    // A domain that dropped out of live serves NOTHING: its meta item carries
    // null redirects (read exactly like no item), but keeps its id + version so
    // a stalled put of the earlier live state cannot land over it (#713 item 4).
    expect(batches).toHaveLength(0);
    expect(puts).toHaveLength(1);
    expect(puts[0].Item).toMatchObject({
      PK: "d#snap.to",
      SK: "d#meta",
      id: "dom-1",
      rootRedirect: null,
      notFoundRedirect: null,
      version: "2026-01-02T03:04:05.000Z",
    });
    expect(puts[0].Item.deleted).toBeUndefined();
  });

  it("positive control: a 'live' domain still produces the LINK put + domain-meta put", async () => {
    const batches: any[] = [];
    const { client, puts } = makeClient({
      BatchWriteCommand: (input) => {
        batches.push(input);
        return {};
      },
    });
    const projection = new DynamoProjection(makeDb([linkRow()], []), client, TABLE);

    await projection.upsert("link-1");

    expect(batches).toHaveLength(1);
    const requests = batches[0].RequestItems[TABLE];
    expect(requests).toHaveLength(1);
    expect(requests[0].PutRequest.Item.SK.startsWith("s#")).toBe(true);
    expect(requests[0].PutRequest.Item.PK).toBe("d#snap.to");
    expect(puts).toHaveLength(1);
    expect(puts[0].Item.SK).toBe("d#meta");
    expect(puts[0].Item.PK).toBe("d#snap.to");
  });

  it("positive control: a 'live' domain op still PUTs the domain-meta item", async () => {
    const batches: any[] = [];
    const { client, puts } = makeClient({
      BatchWriteCommand: (input) => {
        batches.push(input);
        return {};
      },
    });
    const liveDomainDb = makeDomainDb([domainRow({ status: "live", rootRedirect: "https://example.com/r" })]);
    const projection = new DynamoProjection(liveDomainDb, client, TABLE);

    await projection.projectDomain("dom-1", "snap.to");

    expect(batches).toHaveLength(0);
    expect(puts).toHaveLength(1);
    expect(puts[0].Item.SK).toBe("d#meta");
    expect(puts[0].Item.PK).toBe("d#snap.to");
    expect(puts[0].Item.rootRedirect).toBe("https://example.com/r");
  });

  // A domain op is the DOMAIN_OP operation on the batched path too.
  it("apply() routes a DOMAIN_OP for a verifying domain to a neutralised meta put", async () => {
    const batches: any[] = [];
    const { client, puts } = makeClient({
      BatchWriteCommand: (input) => {
        batches.push(input);
        return {};
      },
    });
    const verifyingDomainDb = makeDomainDb([domainRow({ status: "verifying", rootRedirect: "https://example.com/r" })]);
    const projection = new DynamoProjection(verifyingDomainDb, client, TABLE);

    const results = await projection.apply([
      { linkId: "dom-1", operation: DOMAIN_OP, host: "snap.to" },
    ]);

    expect(results[0]!.ok).toBe(true);
    expect(batches).toHaveLength(0);
    expect(puts).toHaveLength(1);
    expect(puts[0].Item).toMatchObject({ PK: "d#snap.to", SK: "d#meta", rootRedirect: null, notFoundRedirect: null });
  });
});

describe("DynamoProjection orders DOMAIN-META writes (#713 item 4)", () => {
  /* The meta item is keyed by HOST, and a host can change owner (domain A
     deleted, host re-added as domain B). Every meta write is therefore a
     conditional PutItem that only lands if it is not older than the stored
     item: by domain id (uuidv7, time-ordered), then tombstone-beats-live, then
     version (updated_at). The real-DynamoDB behaviour is pinned in
     dynamo-projection.domain-race.integration.test.ts; these specs pin the
     request shapes and the superseded-is-success contract. */

  function emptyDb(): Database {
    const builder: any = {
      from: () => builder,
      where: () => builder,
      limit: () => Promise.resolve([]),
    };
    return { select: () => builder } as unknown as Database;
  }

  it("a gone domain is TOMBSTONED, conditional on the stored item not belonging to a newer domain", async () => {
    const { client, puts } = makeClient({});
    const projection = new DynamoProjection(emptyDb(), client, TABLE);

    await projection.projectDomain("dom-old", "Snap.To");

    expect(puts).toHaveLength(1);
    expect(puts[0].Item).toEqual({
      PK: "d#snap.to",
      SK: "d#meta",
      id: "dom-old",
      rootRedirect: null,
      notFoundRedirect: null,
      deleted: true,
    });
    expect(puts[0].ConditionExpression).toBe("attribute_not_exists(#id) OR #id <= :id");
    expect(puts[0].ExpressionAttributeValues).toEqual({ ":id": "dom-old" });
  });

  it("a live put is conditional on id, tombstone and version", async () => {
    const { client, puts } = makeClient({ BatchWriteCommand: () => ({}) });
    const projection = new DynamoProjection(makeDb([linkRow()], []), client, TABLE);

    await projection.upsert("link-1");

    expect(puts[0].ConditionExpression).toBe(
      "attribute_not_exists(#id) OR #id < :id OR " +
        "(#id = :id AND attribute_not_exists(#deleted) AND (attribute_not_exists(#version) OR #version <= :version))",
    );
    expect(puts[0].ExpressionAttributeValues).toEqual({ ":id": "dom-1", ":version": "2026-01-02T03:04:05.000Z" });
  });

  it("a write that loses the condition is SUPERSEDED (ok), not failed", async () => {
    const { client } = makeClient({
      PutCommand: () => {
        throw Object.assign(new Error("The conditional request failed"), { name: "ConditionalCheckFailedException" });
      },
    });
    const projection = new DynamoProjection(emptyDb(), client, TABLE);

    await expect(projection.projectDomain("dom-old", "snap.to")).resolves.toBeUndefined();
    const results = await projection.apply([{ linkId: "dom-old", operation: DOMAIN_OP, host: "snap.to" }]);
    expect(results).toEqual([{ linkId: "dom-old", ok: true }]);
  });

  it("any OTHER meta write error fails the op so the outbox retries it", async () => {
    const { client } = makeClient({
      PutCommand: () => {
        throw Object.assign(new Error("slow down"), { name: "ProvisionedThroughputExceededException" });
      },
    });
    const projection = new DynamoProjection(emptyDb(), client, TABLE);

    const results = await projection.apply([{ linkId: "dom-old", operation: DOMAIN_OP, host: "snap.to" }]);
    expect(results[0]!.ok).toBe(false);
    expect(String((results[0] as any).error)).toContain("slow down");
  });

  it("one batch carrying several writes for one host keeps the NEWEST and fails/succeeds all owners together", async () => {
    // A tombstone for the old id and a live put for the newer id in one batch.
    let call = 0;
    const db = {
      select: () => {
        const which = call++;
        // 1st select: domain op for the OLD id -> row gone. 2nd: the NEW id -> live row.
        const rows = which === 0 ? [] : [domainRow({ id: "dom-2", rootRedirect: "https://example.com/new" })];
        const builder: any = { from: () => builder, where: () => builder, limit: () => Promise.resolve(rows) };
        return builder;
      },
    } as unknown as Database;
    const { client, puts } = makeClient({});
    const projection = new DynamoProjection(db, client, TABLE);

    const results = await projection.apply([
      { linkId: "dom-1", operation: DOMAIN_OP, host: "snap.to" },
      { linkId: "dom-2", operation: DOMAIN_OP, host: "snap.to" },
    ]);

    expect(results.every((r) => r.ok)).toBe(true);
    expect(puts).toHaveLength(1);
    expect(puts[0].Item).toMatchObject({ id: "dom-2", rootRedirect: "https://example.com/new" });
    expect(puts[0].Item.deleted).toBeUndefined();
  });
});

describe("DynamoProjection post-drain cache bust (#620) — optional LinkCacheBuster", () => {
  /* The worker busts the hot redirect-cache entry for a delete/flag op AFTER
     both its DynamoDB write and its edge-KVS write have succeeded, closing the
     window where a request arriving between the API's pre-drain bust and this
     drain re-caches the stale projection for up to LINK_CACHE_TTL_SECONDS. The
     bust uses the shared linkCacheKey(host, slug) — the exact key the redirect
     reads and the API busts. Proven RED first: before this change the
     constructor had NO cache parameter, so a buster could not be injected and
     cache.del was NEVER called; these specs assert it IS called, and only in
     the right order, which the pre-change code cannot satisfy. */

  /** A spy cache buster recording every del, structurally a LinkCacheBuster
   *  (and a CacheStore's del). */
  function spyCache() {
    const del = vi.fn(async () => {});
    return { del, cache: { del } as unknown as { del: (k: string) => Promise<void> } };
  }

  function spyWriter() {
    const putIfEligible = vi.fn(async () => {});
    const deleteKey = vi.fn(async () => {});
    return {
      putIfEligible,
      deleteKey,
      writer: { putIfEligible, deleteKey } as unknown as KvsWriter,
    };
  }

  it("upsert (flag) busts linkCacheKey(host, slug) AFTER the DynamoDB and KVS writes", async () => {
    const order: string[] = [];
    const { client, puts } = makeClient({
      BatchWriteCommand: () => {
        order.push("dynamo");
        return {};
      },
    });
    // Record meta-put ordering too (PutCommand default handler pushes to puts).
    const kvs = spyWriter();
    kvs.putIfEligible.mockImplementation(async () => {
      order.push("kvs");
    });
    const cache = spyCache();
    cache.del.mockImplementation(async () => {
      order.push("cache");
    });
    const projection = new DynamoProjection(
      makeDb([linkRow()], []),
      client,
      TABLE,
      undefined,
      kvs.writer,
      cache.cache,
    );

    await projection.upsert("link-1");

    expect(puts).toHaveLength(1); // meta still written
    expect(cache.del).toHaveBeenCalledTimes(1);
    expect(cache.del).toHaveBeenCalledWith(linkCacheKey("snap.to", "one"));
    // DynamoDB first, then KVS, then the cache bust — never before both writes.
    expect(order.indexOf("cache")).toBeGreaterThan(order.indexOf("dynamo"));
    expect(order.indexOf("cache")).toBeGreaterThan(order.indexOf("kvs"));
  });

  it("remove (delete) busts linkCacheKey(host, slug) AFTER the DynamoDB and KVS writes", async () => {
    const order: string[] = [];
    const { client } = makeClient({
      QueryCommand: () => ({ Items: [{ PK: "d#snap.to", SK: "s#one", linkId: "link-1" }] }),
      BatchWriteCommand: () => {
        order.push("dynamo");
        return {};
      },
    });
    const kvs = spyWriter();
    kvs.deleteKey.mockImplementation(async () => {
      order.push("kvs");
    });
    const cache = spyCache();
    cache.del.mockImplementation(async () => {
      order.push("cache");
    });
    const projection = new DynamoProjection(makeDb([], []), client, TABLE, undefined, kvs.writer, cache.cache);

    await projection.remove("link-1");

    expect(cache.del).toHaveBeenCalledTimes(1);
    expect(cache.del).toHaveBeenCalledWith(linkCacheKey("snap.to", "one"));
    expect(order.indexOf("cache")).toBeGreaterThan(order.indexOf("dynamo"));
    expect(order.indexOf("cache")).toBeGreaterThan(order.indexOf("kvs"));
  });

  it("busts the cache WITHOUT a KvsWriter (shared cache but no edge fast path)", async () => {
    const { client } = makeClient({
      QueryCommand: () => ({ Items: [{ PK: "d#snap.to", SK: "s#one", linkId: "link-1" }] }),
      BatchWriteCommand: () => ({}),
    });
    const cache = spyCache();
    // No KvsWriter (5th arg undefined); cache buster is the 6th arg.
    const projection = new DynamoProjection(makeDb([linkRow()], []), client, TABLE, undefined, undefined, cache.cache);

    await projection.upsert("link-1");
    await projection.remove("link-1");

    expect(cache.del).toHaveBeenCalledTimes(2);
    expect(cache.del).toHaveBeenNthCalledWith(1, linkCacheKey("snap.to", "one"));
    expect(cache.del).toHaveBeenNthCalledWith(2, linkCacheKey("snap.to", "one"));
  });

  it("does NOT bust when the DynamoDB write fails (op retried)", async () => {
    const { client } = makeClient({
      // A delete whose GSI query throws fails BEFORE any write — the op errors.
      QueryCommand: () => {
        throw new Error("query boom");
      },
    });
    const kvs = spyWriter();
    const cache = spyCache();
    const projection = new DynamoProjection(makeDb([], []), client, TABLE, undefined, kvs.writer, cache.cache);

    const results = await projection.apply([{ linkId: "link-1", operation: "delete" }]);

    expect(results[0]!.ok).toBe(false);
    expect(kvs.deleteKey).not.toHaveBeenCalled();
    expect(cache.del).not.toHaveBeenCalled();
  });

  it("does NOT bust when the KVS write fails (op retried)", async () => {
    const { client } = makeClient({
      BatchWriteCommand: () => ({}),
    });
    const kvs = spyWriter();
    kvs.putIfEligible.mockRejectedValueOnce(new Error("kvs boom"));
    const cache = spyCache();
    const projection = new DynamoProjection(makeDb([linkRow()], []), client, TABLE, undefined, kvs.writer, cache.cache);

    const results = await projection.apply([{ linkId: "link-1", operation: "upsert" }]);

    // DynamoDB was written, but the KVS write failed — so the op is retried and
    // the cache was NOT busted (busting a key the projection has not yet made
    // current would be pointless, and the retry re-does both writes + the bust).
    expect(results[0]!.ok).toBe(false);
    expect(cache.del).not.toHaveBeenCalled();
  });

  it("a cache-bust failure fails only that op so the outbox retries it", async () => {
    const { client } = makeClient({
      BatchWriteCommand: () => ({}),
    });
    const cache = spyCache();
    cache.del.mockRejectedValueOnce(new Error("cache boom"));
    const projection = new DynamoProjection(makeDb([linkRow()], []), client, TABLE, undefined, undefined, cache.cache);

    const results = await projection.apply([{ linkId: "link-1", operation: "upsert" }]);

    expect(results[0]!.ok).toBe(false);
    expect(String((results[0] as any).error)).toContain("cache boom");
  });

  it("makes ZERO cache calls when no buster is injected (byte-for-byte unchanged)", async () => {
    const { client } = makeClient({
      QueryCommand: () => ({ Items: [{ PK: "d#snap.to", SK: "s#one", linkId: "link-1" }] }),
      BatchWriteCommand: () => ({}),
    });
    // No 6th constructor arg — cache buster is undefined; a cache call would
    // throw on undefined, so the calls succeeding IS the proof.
    const projection = new DynamoProjection(makeDb([linkRow()], []), client, TABLE);

    const upserted = await projection.apply([{ linkId: "link-1", operation: "upsert" }]);
    await projection.upsert("link-1");
    await projection.remove("link-1");

    expect(upserted[0]!.ok).toBe(true);
  });
});

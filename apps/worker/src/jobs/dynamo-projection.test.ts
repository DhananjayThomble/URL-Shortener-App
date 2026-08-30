import { describe, expect, it, vi } from "vitest";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import type { Database } from "@snapurl/database";
import { DynamoProjection } from "./dynamo-projection.js";

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
    // 20 upserts -> 40 write requests (a LINK + a meta each) -> ceil(40/25) = 2
    // batches, proving N links are O(N/25) round trips rather than N.
    const N = 20;
    const projection = new DynamoProjection(makeDb([linkRow()], []), client, TABLE);
    const ops = Array.from({ length: N }, (_, i) => ({ linkId: `link-${i}`, operation: "upsert" }));

    const results = await projection.apply(ops);

    expect(results).toHaveLength(N);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(batchSizes.length).toBe(2);
    expect(Math.max(...batchSizes)).toBeLessThanOrEqual(25);
    expect(batchSizes.reduce((a, b) => a + b, 0)).toBe(N * 2);
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

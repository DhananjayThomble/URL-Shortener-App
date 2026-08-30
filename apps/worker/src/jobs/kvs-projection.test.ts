import { describe, expect, it, vi } from "vitest";
import type { CloudFrontKeyValueStoreClient } from "@aws-sdk/client-cloudfront-keyvaluestore";
import { kvsKey, type ProjectedLink } from "@snapurl/database";
import { KvsWriter } from "./kvs-projection.js";

/* MOCK-based unit tests, mirroring dynamo-projection.test.ts: the SDK client's
   send() is stubbed and routed by command constructor name. No live CloudFront
   KeyValueStore, no network. */

const KVS_ARN = "arn:aws:cloudfront::123456789012:key-value-store/test-store";
const HOST = "snap.to";
const SLUG = "foo";
const ETAG = "ETagVersion1";

function commandName(command: unknown): string {
  return (command as { constructor: { name: string } }).constructor.name;
}

/** A plain, edge-eligible link: no password, no rules, no click limit, no time
 *  gate, not archived, safe-browsing clean, AND no transform the edge cannot
 *  reproduce (no forwardQuery, no utm, no deepLink, no hideReferrer) and a plain
 *  302 (301's permanence and 307's exact status the edge would not honour). */
function eligibleLink(overrides: Partial<ProjectedLink> = {}): ProjectedLink {
  return {
    id: "link-1",
    workspaceId: "ws-1",
    destination: "https://example.com/dest",
    redirectType: "302",
    rules: [],
    expiresAt: null,
    expiresTo: null,
    activatesAt: null,
    scheduledTo: null,
    clickLimit: null,
    clicks: 0,
    hasPassword: false,
    forwardQuery: false,
    deepLink: false,
    hideReferrer: false,
    publicPreview: true,
    archived: false,
    safeBrowsingStatus: "clean",
    utm: null,
    ...overrides,
  };
}

/** A ConflictException-shaped error (optimistic-concurrency conflict). */
function conflictError(): Error {
  const err = new Error("ETag mismatch");
  err.name = "ConflictException";
  return err;
}

function makeClient(handlers: Record<string, (input: any) => unknown>) {
  const send = vi.fn(async (command: unknown) => {
    const name = commandName(command);
    const handler = handlers[name];
    if (!handler) throw new Error(`unexpected command ${name}`);
    return handler((command as { input: any }).input);
  });
  return { send, client: { send } as unknown as CloudFrontKeyValueStoreClient };
}

describe("KvsWriter.putIfEligible", () => {
  it("Describes for the ETag then PutKeys an eligible link with the right Key/Value/IfMatch", async () => {
    const puts: any[] = [];
    const { client, send } = makeClient({
      DescribeKeyValueStoreCommand: () => ({ ETag: ETAG }),
      PutKeyCommand: (input) => {
        puts.push(input);
        return {};
      },
    });
    const writer = new KvsWriter(client, KVS_ARN);

    await writer.putIfEligible(eligibleLink(), HOST, SLUG);

    // Describe (read ETag) then Put, in that order.
    expect(send.mock.calls.map((c) => commandName(c[0]))).toEqual([
      "DescribeKeyValueStoreCommand",
      "PutKeyCommand",
    ]);
    expect(puts).toHaveLength(1);
    expect(puts[0].KvsARN).toBe(KVS_ARN);
    expect(puts[0].Key).toBe(kvsKey(HOST, SLUG));
    expect(puts[0].IfMatch).toBe(ETAG);
    expect(JSON.parse(puts[0].Value)).toEqual({
      destination: "https://example.com/dest",
      redirectType: "302",
    });
  });

  /* Every ineligibility axis: an ineligible link must DeleteKey (drop it from
     the edge), never PutKey — so a link that gains a gate stops being edge
     served and falls through to the authoritative Lambda. */
  const ineligible: Array<[string, Partial<ProjectedLink>]> = [
    ["password", { hasPassword: true }],
    ["routing rule", { rules: [{ id: "r", when: {}, then: "https://x", weight: 1 } as any] }],
    ["click limit", { clickLimit: 100 }],
    ["expiresAt", { expiresAt: new Date("2099-01-01T00:00:00.000Z") }],
    ["activatesAt", { activatesAt: new Date("2099-01-01T00:00:00.000Z") }],
    ["archived", { archived: true }],
    ["unsafe", { safeBrowsingStatus: "malware" }],
    /* Transform behaviours the edge cannot reproduce (each independently makes a
       link ineligible so it stays on the authoritative Lambda). */
    ["forwardQuery", { forwardQuery: true }],
    ["utm", { utm: { source: "print", medium: "qr", campaign: null, content: null } }],
    ["deepLink", { deepLink: true }],
    ["hideReferrer", { hideReferrer: true }],
    /* Only a plain 302 is edge-served: a 301's permanence would not be honoured
       at the edge, and the edge Function cannot emit a 307 exactly (it collapses
       every non-301 hit to 302), so both fall through to the Lambda. */
    ["301", { redirectType: "301" }],
    ["307", { redirectType: "307" }],
  ];

  for (const [label, overrides] of ineligible) {
    it(`DeleteKeys (not PutKey) an ineligible link: ${label}`, async () => {
      const deletes: any[] = [];
      const { client, send } = makeClient({
        DescribeKeyValueStoreCommand: () => ({ ETag: ETAG }),
        DeleteKeyCommand: (input) => {
          deletes.push(input);
          return {};
        },
      });
      const writer = new KvsWriter(client, KVS_ARN);

      await writer.putIfEligible(eligibleLink(overrides), HOST, SLUG);

      // No PutKeyCommand was ever issued.
      expect(send.mock.calls.map((c) => commandName(c[0]))).not.toContain("PutKeyCommand");
      expect(deletes).toHaveLength(1);
      expect(deletes[0].KvsARN).toBe(KVS_ARN);
      expect(deletes[0].Key).toBe(kvsKey(HOST, SLUG));
      expect(deletes[0].IfMatch).toBe(ETAG);
    });
  }
});

describe("KvsWriter.deleteKey", () => {
  it("Describes for the ETag then DeleteKeys the derived key", async () => {
    const deletes: any[] = [];
    const { client, send } = makeClient({
      DescribeKeyValueStoreCommand: () => ({ ETag: ETAG }),
      DeleteKeyCommand: (input) => {
        deletes.push(input);
        return {};
      },
    });
    const writer = new KvsWriter(client, KVS_ARN);

    await writer.deleteKey(HOST, SLUG);

    expect(send.mock.calls.map((c) => commandName(c[0]))).toEqual([
      "DescribeKeyValueStoreCommand",
      "DeleteKeyCommand",
    ]);
    expect(deletes[0].Key).toBe(kvsKey(HOST, SLUG));
    expect(deletes[0].IfMatch).toBe(ETAG);
  });
});

describe("KvsWriter ETag optimistic-concurrency conflict", () => {
  it("re-reads the ETag and retries on a ConflictException, then succeeds", async () => {
    let describeCalls = 0;
    let putAttempts = 0;
    const { client, send } = makeClient({
      DescribeKeyValueStoreCommand: () => {
        describeCalls++;
        // A fresh ETag on the second read, proving it re-read.
        return { ETag: describeCalls === 1 ? "stale" : "fresh" };
      },
      PutKeyCommand: (input) => {
        putAttempts++;
        if (putAttempts === 1) throw conflictError();
        return { _ifMatch: input.IfMatch };
      },
    });
    const writer = new KvsWriter(client, KVS_ARN);

    await writer.putIfEligible(eligibleLink(), HOST, SLUG);

    // Two Describes (initial + re-read) and two Put attempts.
    expect(describeCalls).toBe(2);
    expect(putAttempts).toBe(2);
    // The second Put used the freshly re-read ETag.
    const lastPut = send.mock.calls
      .filter((c) => commandName(c[0]) === "PutKeyCommand")
      .map((c) => (c[0] as any).input)
      .at(-1);
    expect(lastPut.IfMatch).toBe("fresh");
  });

  it("gives up after the bounded attempts and rethrows the conflict", async () => {
    let putAttempts = 0;
    const { client } = makeClient({
      DescribeKeyValueStoreCommand: () => ({ ETag: ETAG }),
      PutKeyCommand: () => {
        putAttempts++;
        throw conflictError();
      },
    });
    const writer = new KvsWriter(client, KVS_ARN);

    await expect(writer.putIfEligible(eligibleLink(), HOST, SLUG)).rejects.toThrow("ETag mismatch");
    // Bounded: exactly MAX_ATTEMPTS (3) tries, not an infinite loop.
    expect(putAttempts).toBe(3);
  });

  it("does NOT retry a non-conflict error (rethrows immediately)", async () => {
    let putAttempts = 0;
    const { client } = makeClient({
      DescribeKeyValueStoreCommand: () => ({ ETag: ETAG }),
      PutKeyCommand: () => {
        putAttempts++;
        throw new Error("AccessDeniedException");
      },
    });
    const writer = new KvsWriter(client, KVS_ARN);

    await expect(writer.putIfEligible(eligibleLink(), HOST, SLUG)).rejects.toThrow(
      "AccessDeniedException",
    );
    expect(putAttempts).toBe(1);
  });
});

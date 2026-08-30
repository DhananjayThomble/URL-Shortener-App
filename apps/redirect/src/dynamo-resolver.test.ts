import { describe, expect, it, vi } from "vitest";
import type { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { toLinkItem, toDomainItem, type ProjectedLink, type ProjectedDomain } from "@snapurl/database";
import { DynamoLinkResolver } from "./resolver.js";

/* MOCK-based unit tests, mirroring packages/cache/dynamodb-cache-store.test.ts:
   no live DynamoDB in-sandbox or in CI, so a fake DynamoDBDocumentClient whose
   `send` is stubbed by command constructor name asserts the RIGHT command and
   Key are issued and that the stored item maps back to a ResolvedLink. */

const TABLE = "snapurl-link-projection";

function commandName(command: unknown): string {
  return (command as { constructor: { name: string } }).constructor.name;
}

function makeResolver(handlers: Record<string, (input: any) => unknown>) {
  const send = vi.fn(async (command: unknown) => {
    const name = commandName(command);
    const handler = handlers[name];
    if (!handler) throw new Error(`unexpected command ${name}`);
    return handler((command as { input: any }).input);
  });
  const client = { send } as unknown as DynamoDBDocumentClient;
  return { resolver: new DynamoLinkResolver(client, TABLE), send };
}

const storedLink: ProjectedLink = {
  id: "11111111-1111-1111-1111-111111111111",
  workspaceId: "22222222-2222-2222-2222-222222222222",
  destination: "https://example.com/dest",
  redirectType: "307",
  rules: [],
  expiresAt: new Date("2030-01-02T03:04:05.000Z"),
  expiresTo: null,
  activatesAt: null,
  scheduledTo: null,
  clickLimit: 5,
  clicks: 1,
  hasPassword: false,
  forwardQuery: true,
  deepLink: false,
  hideReferrer: false,
  publicPreview: true,
  archived: false,
  safeBrowsingStatus: "safe",
  utm: null,
};

describe("DynamoLinkResolver.resolve", () => {
  it("issues a GetCommand with the normalised (host, slug) key and maps the item back", async () => {
    let captured: any;
    const { resolver } = makeResolver({
      GetCommand: (input) => {
        captured = input;
        return { Item: toLinkItem(storedLink, "snap.to", "foo") };
      },
    });

    // A printed SNAP.TO/Foo must resolve — the key is normalised the same way
    // the Postgres lookup normalises.
    const link = await resolver.resolve("SNAP.TO", "Foo");

    expect(captured.TableName).toBe(TABLE);
    expect(captured.Key).toEqual({ PK: "d#snap.to", SK: "s#foo" });
    expect(link).toEqual(storedLink);
    // Dates are revived, not left as ISO strings.
    expect(link!.expiresAt).toBeInstanceOf(Date);
  });

  it("round-trips a populated rules[] and a non-null utm verbatim", async () => {
    /* storedLink above uses rules: [] and utm: null, so it never exercises the
       mapper's copy of a populated routing chain or a UTM object. A projected
       link that carries both must map back field-for-field identical, or the
       DynamoDB-resolved link would hit evaluateRouting / buildDestination
       differently from the Postgres-resolved one. */
    const withRulesAndUtm: ProjectedLink = {
      ...storedLink,
      rules: [
        {
          id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
          when: { device: "mobile", country: null, language: null },
          then: "https://example.com/mobile",
          weight: null,
        },
        {
          id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
          when: { country: "US", device: null, language: null },
          then: "https://example.com/us",
          weight: 30,
        },
      ],
      utm: { source: "newsletter", medium: "email", campaign: "launch", content: "cta" },
    };

    const { resolver } = makeResolver({
      GetCommand: () => ({ Item: toLinkItem(withRulesAndUtm, "snap.to", "foo") }),
    });

    const link = await resolver.resolve("snap.to", "foo");

    expect(link).toEqual(withRulesAndUtm);
    // The rule order and every field survive the item round-trip.
    expect(link!.rules).toHaveLength(2);
    expect(link!.rules.map((r) => r.then)).toEqual([
      "https://example.com/mobile",
      "https://example.com/us",
    ]);
    expect(link!.rules[1]!.weight).toBe(30);
    // The UTM object is non-null and copied verbatim.
    expect(link!.utm).toEqual({ source: "newsletter", medium: "email", campaign: "launch", content: "cta" });
  });

  it("returns null when the item is absent", async () => {
    const { resolver } = makeResolver({ GetCommand: () => ({}) });
    expect(await resolver.resolve("snap.to", "missing")).toBeNull();
  });
});

describe("DynamoLinkResolver.resolveDomain", () => {
  it("issues a GetCommand with the domain-meta key and maps it back", async () => {
    const domain: ProjectedDomain = {
      id: "44444444-4444-4444-4444-444444444444",
      rootRedirect: "https://example.com/root",
      notFoundRedirect: "https://example.com/404",
    };
    let captured: any;
    const { resolver } = makeResolver({
      GetCommand: (input) => {
        captured = input;
        return { Item: toDomainItem("snap.to", domain) };
      },
    });

    const resolved = await resolver.resolveDomain("SNAP.TO");
    expect(captured.Key).toEqual({ PK: "d#snap.to", SK: "d#meta" });
    expect(resolved).toEqual(domain);
  });

  it("returns null when the domain-meta item is absent", async () => {
    const { resolver } = makeResolver({ GetCommand: () => ({}) });
    expect(await resolver.resolveDomain("snap.to")).toBeNull();
  });
});

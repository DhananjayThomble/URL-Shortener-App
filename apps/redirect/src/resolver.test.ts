import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createDatabase,
  domains,
  eq,
  links,
  routingRules,
  workspaces,
  type Database,
} from "@snapurl/database";
import { PostgresLinkResolver, normaliseHost } from "./resolver.js";

describe("normaliseHost", () => {
  it("lowercases the host so a printed QR read as SNAP.TO still resolves", () => {
    expect(normaliseHost("SNAP.TO")).toBe("snap.to");
  });

  it("trims stray whitespace from a proxy header", () => {
    expect(normaliseHost("  snap.to  ")).toBe("snap.to");
  });

  it("keeps the port, because links are created against host:port in dev", () => {
    expect(normaliseHost("localhost:3002")).toBe("localhost:3002");
  });
});

/* ============================================================
   PostgresLinkResolver against a real Postgres.

   The rest of resolve() is exercised by the redirect integration
   tests; what this file pins is the property the parallelisation
   change turned on — the routing rules are fetched by (host, slug)
   rather than by the resolved link id, so they must still come back
   in position order and be empty when a link has none.

   Runs only when DATABASE_URL is set, matching partitions.test.ts.
   ============================================================ */

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

describeDb("PostgresLinkResolver.resolve", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;
  let resolver: PostgresLinkResolver;
  let workspaceId: string;
  let host: string;

  beforeAll(async () => {
    handle = createDatabase({ url: DATABASE_URL!, max: 1 });
    db = handle.db;
    resolver = new PostgresLinkResolver(db);

    const stamp = Date.now();
    host = `resolver-${stamp}.test`;

    const [ws] = await db
      .insert(workspaces)
      .values({ name: "resolver test", slug: `resolver-${stamp}` })
      .returning({ id: workspaces.id });
    workspaceId = ws!.id;

    const [dom] = await db
      .insert(domains)
      .values({ workspaceId, domain: host })
      .returning({ id: domains.id });

    /* A link with two routing rules, inserted position 1 before position 0 so
       the ordering asserted below can only come from the query's ORDER BY, not
       from insertion order. */
    const [withRules] = await db
      .insert(links)
      .values({ workspaceId, domainId: dom!.id, slug: "ruled", destination: "https://example.com/default" })
      .returning({ id: links.id });
    await db.insert(routingRules).values([
      { linkId: withRules!.id, position: 1, whenCountry: "US", then: "https://example.com/us", weight: null },
      { linkId: withRules!.id, position: 0, whenDevice: "mobile", then: "https://example.com/mobile", weight: null },
    ]);

    // A second link on the same (host) with no rules at all.
    await db
      .insert(links)
      .values({ workspaceId, domainId: dom!.id, slug: "plain", destination: "https://example.com/plain" });
  });

  afterAll(async () => {
    if (workspaceId) await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await handle?.close();
  });

  it("returns the routing rules in position order with the resolved link", async () => {
    const resolved = await resolver.resolve(host, "ruled");

    expect(resolved).not.toBeNull();
    expect(resolved!.destination).toBe("https://example.com/default");
    // Position 0 (mobile) before position 1 (US), regardless of insert order.
    expect(resolved!.rules.map((r) => r.then)).toEqual([
      "https://example.com/mobile",
      "https://example.com/us",
    ]);
    expect(resolved!.rules[0]!.when.device).toBe("mobile");
    expect(resolved!.rules[1]!.when.country).toBe("US");
  });

  it("returns an empty rules array for a link with no routing rules", async () => {
    const resolved = await resolver.resolve(host, "plain");

    expect(resolved).not.toBeNull();
    expect(resolved!.destination).toBe("https://example.com/plain");
    expect(resolved!.rules).toEqual([]);
  });

  it("resolves a slug case-insensitively and does not leak another link's rules", async () => {
    // "PLAIN" resolves to the ruleless link and must not pick up "ruled"'s
    // rules — the (host, slug) predicate is what keeps them apart now that the
    // rules query no longer keys off the resolved link id.
    const resolved = await resolver.resolve(host, "PLAIN");

    expect(resolved).not.toBeNull();
    expect(resolved!.rules).toEqual([]);
  });
});

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { createDatabase, domains, workspaces, type Database } from "@snapurl/database";
import type { CreateLinkInput } from "@snapurl/contract";
import { toActor } from "./activity.js";

/* ============================================================
   Issue #534 — the SSRF guard's DNS-resolving half, exercised through
   LinksService against a real Postgres, with only dns.lookup mocked.

   The oracle: security-and-context.md requires "URL input passes the
   contract-layer SSRF guard (rejects dangerous schemes and internal hosts)"
   for every URL-accepting endpoint. HttpUrl (packages/contract) already
   proves the literal case; this proves the DNS-resolving case the issue
   reports — a name that is not a denied literal but resolves to one — is
   caught for the two fields the maintainer's #534 decision named:
   `destination` and `social.image`.

   dns.lookup is mocked because there is no real DNS name this repo controls
   that is guaranteed to keep resolving to a link-local address; the fake
   resolver stands in for "an attacker's name resolves to 169.254.169.254" as
   the maintainer's own comment on #534 describes (a nip.io-style name).
   ============================================================ */

const lookupMock = vi.fn();
vi.mock("node:dns/promises", () => ({
  lookup: (...args: unknown[]) => lookupMock(...args),
  resolveTxt: vi.fn(),
}));

const { LinksService } = await import("../links/links.service.js");

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

const safeBrowsingStub = {
  check: async () => ({ status: "clean" as const, checkedAt: new Date() }),
} as any;
const projectionNudgeStub = { nudge: () => {} } as any;

const actor = toActor({ userId: null, label: "test" });

describeDb("SSRF DNS guard — LinksService.create/.update (#534)", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;
  let workspaceId: string;
  let domainName: string;

  const stamp = Date.now();

  beforeAll(async () => {
    handle = createDatabase({ url: DATABASE_URL!, max: 1 });
    db = handle.db;

    const [ws] = await db
      .insert(workspaces)
      .values({ name: "ssrf test", slug: `ssrf-${stamp}` })
      .returning({ id: workspaces.id });
    workspaceId = ws!.id;

    domainName = `ssrf-${stamp}.test`;
    await db.insert(domains).values({ workspaceId, domain: domainName, isSystem: true, status: "live" });
  });

  afterAll(async () => {
    await handle.sql.end();
  });

  beforeEach(() => {
    lookupMock.mockReset();
  });

  /* A name that is not a denied literal (passes HttpUrl) but resolves to the
     cloud metadata address — exactly the bypass the issue reports. */
  const rebindingUrl = "http://169.254.169.254.nip.io.example/latest/meta-data/";
  const denyLookup = () => lookupMock.mockResolvedValue([{ address: "169.254.169.254", family: 4 }]);
  const allowLookup = () => lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);

  it("LinksService.create rejects a destination that resolves to a denied address", async () => {
    denyLookup();
    const service = new LinksService(db, db, safeBrowsingStub, projectionNudgeStub);
    const input = {
      destination: rebindingUrl,
      domain: domainName,
      tags: [],
      rules: [],
      redirectType: "302" as const,
      forwardQuery: true,
      deepLink: false,
      hideReferrer: false,
      publicPreview: true,
    } as unknown as CreateLinkInput;

    await expect(service.create(workspaceId, actor, input)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("LinksService.create accepts a destination that only resolves to public addresses", async () => {
    allowLookup();
    const service = new LinksService(db, db, safeBrowsingStub, projectionNudgeStub);
    const input = {
      destination: `https://example.com/ok-${stamp}`,
      domain: domainName,
      tags: [],
      rules: [],
      redirectType: "302" as const,
      forwardQuery: true,
      deepLink: false,
      hideReferrer: false,
      publicPreview: true,
    } as unknown as CreateLinkInput;

    const link = await service.create(workspaceId, actor, input);
    expect(link.destination).toBe(`https://example.com/ok-${stamp}`);
  });

  it("LinksService.create rejects a social.image that resolves to a denied address", async () => {
    /* Must discriminate by hostname: denying every hostname unconditionally
       would make this pass for the wrong reason (the destination itself
       getting rejected) even if social.image were never checked at all. Only
       the social.image host must resolve to a denied address; the
       destination must resolve to a public one, so the only way this test
       can fail-shut is if assertNoSsrfDnsTarget actually looks at
       social.image. */
    lookupMock.mockImplementation(async (host: string) =>
      host.includes("169-254") || host.includes("169.254")
        ? [{ address: "169.254.169.254", family: 4 }]
        : [{ address: "93.184.216.34", family: 4 }],
    );
    const service = new LinksService(db, db, safeBrowsingStub, projectionNudgeStub);
    const input = {
      destination: `https://example.com/social-${stamp}`,
      domain: domainName,
      tags: [],
      rules: [],
      redirectType: "302" as const,
      forwardQuery: true,
      deepLink: false,
      hideReferrer: false,
      publicPreview: true,
      social: { image: rebindingUrl },
    } as unknown as CreateLinkInput;

    await expect(service.create(workspaceId, actor, input)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("LinksService.update rejects a destination patch that resolves to a denied address", async () => {
    allowLookup();
    const service = new LinksService(db, db, safeBrowsingStub, projectionNudgeStub);
    const created = await service.create(workspaceId, actor, {
      destination: `https://example.com/before-update-${stamp}`,
      domain: domainName,
      tags: [],
      rules: [],
      redirectType: "302" as const,
      forwardQuery: true,
      deepLink: false,
      hideReferrer: false,
      publicPreview: true,
    } as unknown as CreateLinkInput);

    denyLookup();
    await expect(
      service.update(workspaceId, created.id, actor, { destination: rebindingUrl } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

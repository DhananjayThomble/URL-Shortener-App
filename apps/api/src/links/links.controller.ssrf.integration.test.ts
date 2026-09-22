import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { createDatabase, domains, workspaces, type Database } from "@snapurl/database";
import { CreateLinkInput } from "@snapurl/contract";
import { zodBody } from "../common/zod.pipe.js";
import type { RequestActor } from "../auth/auth.guard.js";
import { LinksController } from "./links.controller.js";
import { LinksService } from "./links.service.js";

/* ============================================================
   Issue #534, request-level regression.

   The declared contract (packages/contract's CreateLinkInput) is, by design,
   NOT where the DNS-resolving half of the SSRF guard lives — see the header
   comment on ssrf-guard.ts for why (an async dns.lookup cannot run inside a
   synchronous zod parse, and packages/contract is imported by the browser
   bundle, which cannot resolve node:dns). So `CreateLinkInput.safeParse(...)`
   correctly returns `success: true` for a metadata-resolving hostname; that
   is not the bug.

   This test drives the actual request path a caller hits: the same
   `zodBody(CreateLinkInput)` pipe the controller's `@Body()` decorator uses,
   feeding straight into `LinksController.create`. It fails if either half of
   that path stops rejecting the payload: a widened contract schema that
   started rejecting it here for the wrong reason would be caught by
   http-url.test.ts instead; this test's job is the DNS-resolving step that
   runs after the pipe, at the controller/service boundary.
   ============================================================ */

const lookupMock = vi.fn();
vi.mock("node:dns/promises", () => ({
  lookup: (...args: unknown[]) => lookupMock(...args),
  resolveTxt: vi.fn(),
}));

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

const safeBrowsingStub = {
  check: async () => ({ status: "clean" as const, checkedAt: new Date() }),
} as any;
const projectionNudgeStub = { nudge: () => {} } as any;

describeDb("LinksController.create — request-level SSRF DNS regression (#534)", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;
  let controller: LinksController;
  let actor: RequestActor;
  let domainName: string;

  const stamp = Date.now();
  const pipe = zodBody(CreateLinkInput);

  /* Not a denied literal — HttpUrl accepts it — but resolves to the cloud
     metadata address once dns.lookup actually runs. */
  const rebindingUrl = "http://169.254.169.254.nip.io.example/latest/meta-data/";

  beforeAll(async () => {
    handle = createDatabase({ url: DATABASE_URL!, max: 1 });
    db = handle.db;
    controller = new LinksController(new LinksService(db, db, safeBrowsingStub, projectionNudgeStub));

    const [ws] = await db
      .insert(workspaces)
      .values({ name: "ssrf controller test", slug: `ssrf-ctrl-${stamp}` })
      .returning({ id: workspaces.id });

    actor = {
      userId: null,
      workspaceId: ws!.id,
      role: "editor",
      email: "actor@example.com",
      label: "actor@example.com",
    };

    domainName = `ssrf-ctrl-${stamp}.test`;
    await db.insert(domains).values({ workspaceId: ws!.id, domain: domainName, isSystem: true, status: "live" });
  });

  afterAll(async () => {
    await handle.sql.end();
  });

  beforeEach(() => {
    lookupMock.mockReset();
  });

  it("CreateLinkInput.safeParse accepts a metadata-resolving destination (by design — see header comment)", () => {
    const raw = {
      destination: rebindingUrl,
      domain: domainName,
      rules: [],
      redirectType: "302",
      forwardQuery: true,
      deepLink: false,
      hideReferrer: false,
      publicPreview: true,
    };
    expect(CreateLinkInput.safeParse(raw).success).toBe(true);
  });

  it("rejects a request whose destination resolves to a denied address, through the pipe and the controller", async () => {
    lookupMock.mockResolvedValue([{ address: "169.254.169.254", family: 4 }]);

    const raw = {
      destination: rebindingUrl,
      domain: domainName,
      rules: [],
      redirectType: "302",
      forwardQuery: true,
      deepLink: false,
      hideReferrer: false,
      publicPreview: true,
    };
    const parsed = pipe.transform(raw); // the same pipe @Body(zodBody(CreateLinkInput)) runs

    await expect(controller.create(actor, parsed)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects a request whose social.image resolves to a denied address, through the pipe and the controller", async () => {
    lookupMock.mockImplementation(async (host: string) =>
      host.includes("169-254") || host.includes("169.254")
        ? [{ address: "169.254.169.254", family: 4 }]
        : [{ address: "93.184.216.34", family: 4 }],
    );

    const raw = {
      destination: `https://example.com/social-ctrl-${stamp}`,
      domain: domainName,
      rules: [],
      redirectType: "302",
      forwardQuery: true,
      deepLink: false,
      hideReferrer: false,
      publicPreview: true,
      social: { image: rebindingUrl },
    };
    const parsed = pipe.transform(raw);

    await expect(controller.create(actor, parsed)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("accepts a request whose destination and social.image both resolve to public addresses", async () => {
    lookupMock.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);

    const raw = {
      destination: `https://example.com/ok-ctrl-${stamp}`,
      domain: domainName,
      rules: [],
      redirectType: "302",
      forwardQuery: true,
      deepLink: false,
      hideReferrer: false,
      publicPreview: true,
      social: { image: "https://example.com/preview.png" },
    };
    const parsed = pipe.transform(raw);

    const link = await controller.create(actor, parsed);
    expect(link.destination).toBe(`https://example.com/ok-ctrl-${stamp}`);
  });
});

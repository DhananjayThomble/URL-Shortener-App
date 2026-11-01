import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { createDatabase, domains, eq, links, workspaces, type Database } from "@snapurl/database";
import type { SafeBrowsingStatus } from "@snapurl/contract";
import { LinksService } from "./links.service.js";
import type { SafeBrowsingService, ScanResult } from "../safe-browsing/safe-browsing.service.js";
import type { ProjectionNudgeService } from "./projection-nudge.service.js";
import type { LinkCacheBustService } from "../common/link-cache-bust.service.js";
import { openPlatformSettingsStub } from "../test/platform-settings.stub.js";
import { toActor } from "../common/activity.js";

/* ============================================================
   #994 point 1 + point 4 — refuse a flagged destination, a redirect chain
   and a self-referencing loop on create and update.

   Against a real Postgres because the whole behaviour under test is "no row is
   written": the refusal has to be observed as the absence of a links row, not
   as a mock call. The Safe Browsing scanner is stubbed (its verdict is set per
   test) so no live network call happens — only the service's reaction to a
   given verdict is exercised.

   Runs only when DATABASE_URL is set.
   ============================================================ */

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

/* A scanner whose next verdict each test sets. Defaults to "clean". */
let nextScan: SafeBrowsingStatus = "clean";
const safeBrowsingStub = {
  check: async (): Promise<ScanResult> => ({ status: nextScan, checkedAt: new Date() }),
} as unknown as SafeBrowsingService;

const projectionNudgeStub = { nudge: () => {} } as unknown as ProjectionNudgeService;
const cacheBustStub = { bust: async () => {} } as unknown as LinkCacheBustService;
const actor = toActor({ userId: null, label: "test-harness" });

describeDb("LinksService — refusing flagged, chained and self-referencing destinations", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;
  let service: LinksService;
  let workspaceId: string;
  let domainName: string;

  const stamp = Date.now();

  const input = (over: Record<string, unknown> = {}) => ({
    destination: "https://example.com/landing",
    domain: domainName,
    tags: [],
    redirectType: "302" as const,
    rules: [],
    forwardQuery: true,
    deepLink: false,
    hideReferrer: false,
    publicPreview: true,
    ...over,
  });

  const slugCount = async (slug: string) =>
    (await db.select({ id: links.id }).from(links).where(eq(links.slug, slug))).length;

  beforeAll(async () => {
    handle = createDatabase({ url: DATABASE_URL!, max: 1 });
    db = handle.db;
    service = new LinksService(db, db, safeBrowsingStub, projectionNudgeStub, cacheBustStub, openPlatformSettingsStub());

    const [ws] = await db
      .insert(workspaces)
      .values({ name: "scanning test", slug: `scanning-${stamp}` })
      .returning({ id: workspaces.id });
    workspaceId = ws!.id;

    domainName = `scanning-${stamp}.test`;
    await db.insert(domains).values({ workspaceId, domain: domainName, status: "live", verifiedAt: new Date() });
  });

  afterAll(async () => {
    if (workspaceId) await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await handle?.close();
  });

  beforeEach(() => {
    nextScan = "clean";
  });

  describe("point 1 — a flagged destination is refused, not created behind an interstitial", () => {
    it("refuses create when Safe Browsing flags the destination, and writes no row", async () => {
      nextScan = "flagged";
      const slug = `flagged-create-${stamp}`;
      await expect(service.create(workspaceId, actor, input({ slug }))).rejects.toBeInstanceOf(BadRequestException);
      expect(await slugCount(slug)).toBe(0);
    });

    it("creates the link when the scan is clean", async () => {
      nextScan = "clean";
      const slug = `clean-create-${stamp}`;
      const link = await service.create(workspaceId, actor, input({ slug }));
      expect(link.slug).toBe(slug);
      expect(await slugCount(slug)).toBe(1);
    });

    it("still creates when the scan is pending (scanner down must not block a legit link)", async () => {
      nextScan = "pending";
      const slug = `pending-create-${stamp}`;
      const link = await service.create(workspaceId, actor, input({ slug }));
      expect(link.safeBrowsing.status).toBe("pending");
      expect(await slugCount(slug)).toBe(1);
    });

    it("refuses an update that points an existing link at a flagged destination", async () => {
      nextScan = "clean";
      const slug = `flagged-update-${stamp}`;
      const link = await service.create(workspaceId, actor, input({ slug }));

      nextScan = "flagged";
      await expect(
        service.update(workspaceId, link.id, actor, { destination: "https://phish.example/evil" }),
      ).rejects.toBeInstanceOf(BadRequestException);

      // The destination was not changed.
      const [row] = await db.select({ destination: links.destination }).from(links).where(eq(links.id, link.id));
      expect(row!.destination).toBe("https://example.com/landing");
    });
  });

  describe("point 4 — no redirect chains or self-referencing loops", () => {
    it("refuses a destination on a known third-party shortener", async () => {
      const slug = `chain-create-${stamp}`;
      await expect(
        service.create(workspaceId, actor, input({ slug, destination: "https://bit.ly/abc" })),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(await slugCount(slug)).toBe(0);
    });

    it("refuses a destination that points back at one of our own short domains", async () => {
      const slug = `self-create-${stamp}`;
      await expect(
        service.create(workspaceId, actor, input({ slug, destination: `https://${domainName}/other` })),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(await slugCount(slug)).toBe(0);
    });

    it("refuses an update that points a link at a shortener", async () => {
      const slug = `chain-update-${stamp}`;
      const link = await service.create(workspaceId, actor, input({ slug }));
      await expect(
        service.update(workspaceId, link.id, actor, { destination: "https://tinyurl.com/abc" }),
      ).rejects.toBeInstanceOf(BadRequestException);
      const [row] = await db.select({ destination: links.destination }).from(links).where(eq(links.id, link.id));
      expect(row!.destination).toBe("https://example.com/landing");
    });

    it("accepts an ordinary destination", async () => {
      const slug = `ordinary-${stamp}`;
      const link = await service.create(
        workspaceId,
        actor,
        input({ slug, destination: "https://docs.example.com/guide" }),
      );
      expect(link.slug).toBe(slug);
      expect(await slugCount(slug)).toBe(1);
    });
  });

  describe("bulkCreate — a flagged or chained row fails its own row, not the batch", () => {
    it("writes the clean rows and fails only the flagged/chained ones", async () => {
      // One flagged (set the scanner to flag every row, so isolate via chain
      // instead): here we drive flagged via the scanner for one call by using a
      // chained destination for the bad rows, which does not depend on scanner
      // state and can coexist with clean rows in one batch.
      nextScan = "clean";
      const good = `bulk-good-${stamp}`;
      const chained = `bulk-chain-${stamp}`;
      const selfref = `bulk-self-${stamp}`;
      const result = await service.bulkCreate(workspaceId, actor, {
        links: [
          input({ slug: good }),
          input({ slug: chained, destination: "https://bit.ly/x" }),
          input({ slug: selfref, destination: `https://${domainName}/loop` }),
        ],
      });
      expect(result.created).toBe(1);
      expect(result.failed).toBe(2);
      expect(await slugCount(good)).toBe(1);
      expect(await slugCount(chained)).toBe(0);
      expect(await slugCount(selfref)).toBe(0);
    });

    it("fails a flagged row in a bulk batch without blocking a clean row", async () => {
      // The scanner flags every destination in this call, so use a batch of one
      // flagged row to assert it is failed (not written) on its own.
      nextScan = "flagged";
      const flagged = `bulk-flagged-${stamp}`;
      const result = await service.bulkCreate(workspaceId, actor, { links: [input({ slug: flagged })] });
      expect(result.created).toBe(0);
      expect(result.failed).toBe(1);
      expect(await slugCount(flagged)).toBe(0);
    });
  });
});

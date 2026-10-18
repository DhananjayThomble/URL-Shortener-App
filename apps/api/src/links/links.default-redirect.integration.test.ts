import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { createDatabase, domains, eq, links, workspaces, type Database } from "@snapurl/database";
import { BulkCreateLinksInput, CreateLinkInput, type RedirectType } from "@snapurl/contract";
import { zodBody } from "../common/zod.pipe.js";
import type { RequestActor } from "../auth/auth.guard.js";
import { LinksController } from "./links.controller.js";
import { LinksService } from "./links.service.js";
import { toActor } from "../common/activity.js";
import type { SafeBrowsingService } from "../safe-browsing/safe-browsing.service.js";
import type { ProjectionNudgeService } from "./projection-nudge.service.js";
import type { LinkCacheBustService } from "../common/link-cache-bust.service.js";

/* ============================================================
   Issue #753 — the workspace "Default redirect type" setting ("Applies to new
   links") was ignored: every create that omitted `redirectType` stored 302.

   The cause was in the contract, not the service: CreateLinkInput declared
   `redirectType: RedirectType.default("302")`, so the validation pipe had
   already filled in 302 before LinksService could tell "the caller chose
   302" from "the caller said nothing". This suite therefore drives the real
   request path — the same `zodBody(...)` pipes the controller's @Body()
   decorators run, into LinksController — against a real Postgres, and reads
   the stored row back rather than trusting the DTO.
   ============================================================ */

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

const safeBrowsingStub = {
  check: async () => ({ status: "clean" as const, checkedAt: new Date() }),
} as unknown as SafeBrowsingService;
const projectionNudgeStub = { nudge: () => {} } as unknown as ProjectionNudgeService;
const cacheBustStub = { bust: async () => {} } as unknown as LinkCacheBustService;

const TYPES: RedirectType[] = ["301", "302", "307"];

describeDb("POST /links and /links/bulk fall back to the workspace's defaultRedirect (#753)", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;
  let controller: LinksController;
  const stamp = Date.now();
  const createPipe = zodBody(CreateLinkInput);
  const bulkPipe = zodBody(BulkCreateLinksInput);

  /* Two workspaces so a leak is observable: B's setting must never decide A's
     links, or the other way round. */
  const ws = {
    a: { id: "", domain: `dr-a-${stamp}.test`, actor: undefined as unknown as RequestActor },
    b: { id: "", domain: `dr-b-${stamp}.test`, actor: undefined as unknown as RequestActor },
  };

  const setDefault = (id: string, value: RedirectType) =>
    db.update(workspaces).set({ defaultRedirect: value }).where(eq(workspaces.id, id));

  const storedType = async (linkId: string) =>
    (await db.select({ t: links.redirectType }).from(links).where(eq(links.id, linkId)))[0]!.t;

  let n = 0;
  const body = (domain: string, extra: Record<string, unknown> = {}) => ({
    destination: `https://example.com/dr/${stamp}/${n++}`,
    domain,
    ...extra,
  });

  const create = (w: typeof ws.a, extra: Record<string, unknown> = {}) =>
    controller.create(w.actor, createPipe.transform(body(w.domain, extra)) as CreateLinkInput);

  beforeAll(async () => {
    handle = createDatabase({ url: DATABASE_URL!, max: 1 });
    db = handle.db;
    controller = new LinksController(new LinksService(db, db, safeBrowsingStub, projectionNudgeStub, cacheBustStub));

    for (const [key, w] of Object.entries(ws)) {
      const [row] = await db
        .insert(workspaces)
        .values({ name: `default redirect ${key}`, slug: `dr-${key}-${stamp}` })
        .returning({ id: workspaces.id });
      w.id = row!.id;
      w.actor = { userId: null, workspaceId: w.id, role: "editor", email: "actor@example.com", label: "actor@example.com" };
      await db.insert(domains).values({ workspaceId: w.id, domain: w.domain, status: "live", verifiedAt: new Date() });
    }
  });

  afterAll(async () => {
    for (const w of Object.values(ws)) if (w.id) await db.delete(workspaces).where(eq(workspaces.id, w.id));
    await handle?.close();
  });

  it("the contract no longer invents a redirect type: an omitted one parses as absent", () => {
    const parsed = createPipe.transform({ destination: "https://example.com/x", domain: "d.test" }) as CreateLinkInput;
    expect(parsed.redirectType).toBeUndefined();
  });

  for (const def of TYPES) {
    it(`single create, workspace default ${def}: an omitted redirectType stores ${def}`, async () => {
      await setDefault(ws.a.id, def);
      const link = await create(ws.a);
      expect(link.redirectType).toBe(def);
      expect(await storedType(link.id)).toBe(def);
    });

    it(`single create, workspace default ${def}: an explicit redirectType always wins`, async () => {
      await setDefault(ws.a.id, def);
      for (const explicit of TYPES) {
        const link = await create(ws.a, { redirectType: explicit });
        expect(await storedType(link.id)).toBe(explicit);
      }
    });

    it(`bulk create, workspace default ${def}: omitted rows get ${def}, explicit rows keep theirs`, async () => {
      await setDefault(ws.a.id, def);
      const rows = [body(ws.a.domain), ...TYPES.map((t) => body(ws.a.domain, { redirectType: t })), body(ws.a.domain)];
      const result = await controller.bulkCreate(ws.a.actor, bulkPipe.transform({ links: rows }) as BulkCreateLinksInput);
      expect(result.created).toBe(rows.length);
      const expected = [def, ...TYPES, def];
      for (const [i, outcome] of result.results.entries()) {
        expect(outcome.ok).toBe(true);
        if (!outcome.ok) continue;
        expect(outcome.link.redirectType).toBe(expected[i]);
        expect(await storedType(outcome.link.id)).toBe(expected[i]);
      }
    });
  }

  it("another workspace's setting never leaks into this one (single and bulk)", async () => {
    await setDefault(ws.a.id, "301");
    await setDefault(ws.b.id, "307");

    expect(await storedType((await create(ws.a)).id)).toBe("301");
    expect(await storedType((await create(ws.b)).id)).toBe("307");

    const bulkA = await controller.bulkCreate(ws.a.actor, bulkPipe.transform({ links: [body(ws.a.domain)] }) as BulkCreateLinksInput);
    const bulkB = await controller.bulkCreate(ws.b.actor, bulkPipe.transform({ links: [body(ws.b.domain)] }) as BulkCreateLinksInput);
    const [ra] = bulkA.results;
    const [rb] = bulkB.results;
    expect(ra!.ok && ra!.link.redirectType).toBe("301");
    expect(rb!.ok && rb!.link.redirectType).toBe("307");
  });

  it("a workspace created by the schema default (302) still yields 302 for an omitted type", async () => {
    await setDefault(ws.a.id, "302");
    expect(await storedType((await create(ws.a)).id)).toBe("302");
  });

  it("an invalid redirectType is still a 400 (single) and a per-row error (bulk), never a silent default", async () => {
    for (const bad of ["308", "", "abc", null, 301]) {
      expect(() => createPipe.transform(body(ws.a.domain, { redirectType: bad }))).toThrow(BadRequestException);
    }
    const result = await controller.bulkCreate(
      ws.a.actor,
      bulkPipe.transform({ links: [body(ws.a.domain, { redirectType: "308" }), body(ws.a.domain)] }) as BulkCreateLinksInput,
    );
    expect(result.created).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.results[0]).toMatchObject({ ok: false, index: 0 });
    expect(result.results[1]).toMatchObject({ ok: true, index: 1 });
  });

  it("clone keeps the source's redirect type, not the workspace default", async () => {
    await setDefault(ws.a.id, "302");
    const source = await create(ws.a, { redirectType: "307" });
    await setDefault(ws.a.id, "301");
    const service = new LinksService(db, db, safeBrowsingStub, projectionNudgeStub, cacheBustStub);
    const copy = await service.clone(ws.a.id, source.id, toActor({ userId: null, label: "test" }), {});
    expect(await storedType(copy.id)).toBe("307");
  });
});

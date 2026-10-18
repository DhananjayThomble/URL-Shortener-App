import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { createDatabase, domains, eq, links, sql, workspaces, type Database } from "@snapurl/database";
import { BulkCreateLinksInput, CreateLinkInput, UpdateLinkInput } from "@snapurl/contract";
import { EXPIRY_IN_PAST_MESSAGE } from "@snapurl/domain";
import { zodBody } from "../common/zod.pipe.js";
import type { RequestActor } from "../auth/auth.guard.js";
import { LinksController } from "./links.controller.js";
import { LinksService } from "./links.service.js";
import type { SafeBrowsingService } from "../safe-browsing/safe-browsing.service.js";
import type { ProjectionNudgeService } from "./projection-nudge.service.js";
import type { LinkCacheBustService } from "../common/link-cache-bust.service.js";

/* ============================================================
   Issue #754 — a link could be created with an expiry date in the past: POST
   /links answered 201 with status "expired" and the short URL 410'd from its
   first click. PATCH and POST /links/bulk had the same hole, and an
   unparseable date was a 500.

   Drives the real request path — the controller's own zodBody(...) pipes into
   LinksController — against a real Postgres, and reads stored rows back
   rather than trusting the DTO.

   Edit semantics under test: a NEW past expiry is refused, but a link that has
   since expired can still be edited (its unchanged expiry rides along in the
   drawer's PATCH), extended, or have its expiry cleared.
   ============================================================ */

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

const safeBrowsingStub = {
  check: async () => ({ status: "clean" as const, checkedAt: new Date() }),
} as unknown as SafeBrowsingService;
const projectionNudgeStub = { nudge: () => {} } as unknown as ProjectionNudgeService;
const cacheBustStub = { bust: async () => {} } as unknown as LinkCacheBustService;

const DAY = 86_400_000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

/** The 400 body a BadRequestException carries, as the client sees it. */
async function badRequest(p: Promise<unknown>): Promise<{ message: string[] | string }> {
  const err = await p.then(
    () => {
      throw new Error("expected a 400, got success");
    },
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(BadRequestException);
  return (err as BadRequestException).getResponse() as { message: string[] | string };
}

describeDb("past expiry dates are refused on create, bulk create and edit (#754)", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;
  let controller: LinksController;
  const stamp = Date.now();
  const createPipe = zodBody(CreateLinkInput);
  const bulkPipe = zodBody(BulkCreateLinksInput);
  const updatePipe = zodBody(UpdateLinkInput);
  const ws = { id: "", domain: `px-${stamp}.test`, actor: undefined as unknown as RequestActor };
  const other = { id: "", domain: `px-o-${stamp}.test`, actor: undefined as unknown as RequestActor };

  let n = 0;
  const body = (extra: Record<string, unknown> = {}, domain = ws.domain) => ({
    destination: `https://example.com/px/${stamp}/${n}`,
    domain,
    slug: `px-${stamp}-${n++}`,
    ...extra,
  });
  const create = (extra: Record<string, unknown> = {}) =>
    controller.create(ws.actor, createPipe.transform(body(extra)) as CreateLinkInput);
  const update = (id: string, patch: Record<string, unknown>, actor = ws.actor) =>
    controller.update(actor, id, updatePipe.transform(patch) as UpdateLinkInput);
  const stored = async (id: string) =>
    (await db.select({ expiresAt: links.expiresAt, comment: links.comment }).from(links).where(eq(links.id, id)))[0]!;
  const countSlug = async (slug: string) =>
    (await db.select({ id: links.id }).from(links).where(eq(links.slug, slug))).length;
  /** Time passing: move a stored expiry into the past without going through the API. */
  const expireInDb = (id: string, agoMs: number) =>
    db.update(links).set({ expiresAt: sql`now() - make_interval(secs => ${agoMs / 1000})` }).where(eq(links.id, id));

  beforeAll(async () => {
    handle = createDatabase({ url: DATABASE_URL!, max: 1 });
    db = handle.db;
    controller = new LinksController(new LinksService(db, db, safeBrowsingStub, projectionNudgeStub, cacheBustStub));
    for (const w of [ws, other]) {
      const [row] = await db.insert(workspaces).values({ name: `past expiry ${w.domain}`, slug: `px-${w === ws ? "a" : "b"}-${stamp}` }).returning({ id: workspaces.id });
      w.id = row!.id;
      w.actor = { userId: null, workspaceId: w.id, role: "editor", email: "actor@example.com", label: "actor@example.com" };
      await db.insert(domains).values({ workspaceId: w.id, domain: w.domain, status: "live", verifiedAt: new Date() });
    }
  });

  afterAll(async () => {
    for (const w of [ws, other]) if (w.id) await db.delete(workspaces).where(eq(workspaces.id, w.id));
    await handle?.close();
  });

  describe("POST /links", () => {
    it("a past expiresAt is a 400 with a human message, and nothing is stored", async () => {
      const input = body({ expiresAt: "2026-01-01T00:00:00.000Z" });
      const res = await badRequest(controller.create(ws.actor, createPipe.transform(input) as CreateLinkInput));
      expect(res.message).toEqual([EXPIRY_IN_PAST_MESSAGE]);
      expect(await countSlug(input.slug)).toBe(0);
    });

    it("one second ago is refused too (create has no tolerance: it would be born expired)", async () => {
      const res = await badRequest(create({ expiresAt: iso(-1_000) }));
      expect(res.message).toEqual([EXPIRY_IN_PAST_MESSAGE]);
    });

    it("a future expiresAt still creates an active / expiring link and stores the instant", async () => {
      const inAMonth = iso(30 * DAY);
      const link = await create({ expiresAt: inAMonth });
      expect(link.status).toBe("active");
      expect((await stored(link.id)).expiresAt?.toISOString()).toBe(inAMonth);
      const soon = await create({ expiresAt: iso(2 * DAY) });
      expect(soon.status).toBe("expiring");
    });

    it("the same instant written with an offset is judged by the instant", async () => {
      const future = new Date(Date.now() + DAY);
      // Same instant, spelled in +05:30.
      const local = new Date(future.getTime() + 5.5 * 3_600_000).toISOString().replace("Z", "+05:30");
      const link = await create({ expiresAt: local });
      expect((await stored(link.id)).expiresAt?.getTime()).toBe(Math.floor(future.getTime()));
    });

    it("no expiry (omitted, null, empty string) is unaffected", async () => {
      for (const extra of [{}, { expiresAt: null }, { expiresAt: "" }]) {
        const link = await create(extra);
        expect(link.expiresAt ?? null).toBeNull();
        expect(link.status).toBe("active");
      }
    });

    it("an unparseable date is a 400 naming the field, not a 500", async () => {
      expect(() => createPipe.transform(body({ expiresAt: "not-a-date" }))).toThrow(BadRequestException);
      try {
        createPipe.transform(body({ activatesAt: "not-a-date" }));
      } catch (e) {
        expect(((e as BadRequestException).getResponse() as { message: string[] }).message[0]).toMatch(/^activatesAt: .*valid date/i);
      }
    });

    it("a past expiry with a later go-live date reports both problems in one 400", async () => {
      const res = await badRequest(create({ activatesAt: iso(10 * DAY), expiresAt: iso(-DAY) }));
      expect(res.message).toEqual(["A link cannot be scheduled to start after it expires.", EXPIRY_IN_PAST_MESSAGE]);
    });

    it("a past go-live date with a future expiry is still allowed (it reads as 'went live then')", async () => {
      const link = await create({ activatesAt: iso(-10 * DAY), expiresAt: iso(10 * DAY) });
      expect(link.status).toBe("active");
    });
  });

  describe("POST /links/bulk", () => {
    it("a past-expiry row fails on its own with the message; the other rows are written", async () => {
      const rows = [body({ expiresAt: iso(-DAY) }), body({ expiresAt: iso(DAY * 20) }), body()];
      const result = await controller.bulkCreate(ws.actor, bulkPipe.transform({ links: rows }) as BulkCreateLinksInput);
      expect(result.created).toBe(2);
      const [bad, good, plain] = result.results;
      expect(bad!.ok).toBe(false);
      if (!bad!.ok) expect(bad!.error).toContain(EXPIRY_IN_PAST_MESSAGE);
      expect(good!.ok && good!.link.status).toBe("active");
      expect(plain!.ok).toBe(true);
      expect(await countSlug(rows[0]!.slug)).toBe(0);
    });

    it("an unparseable date fails only its own row (it used to fail the whole batch with a 500)", async () => {
      const rows = [body({ expiresAt: "not-a-date" }), body()];
      const result = await controller.bulkCreate(ws.actor, bulkPipe.transform({ links: rows }) as BulkCreateLinksInput);
      expect(result.created).toBe(1);
      expect(result.results[0]!.ok).toBe(false);
      if (!result.results[0]!.ok) expect(result.results[0]!.error).toMatch(/expiresAt: .*valid date/i);
      expect(result.results[1]!.ok).toBe(true);
    });
  });

  describe("PATCH /links/:id", () => {
    it("setting a past expiry on a live link is a 400 and the stored expiry is untouched", async () => {
      const keep = iso(30 * DAY);
      const link = await create({ expiresAt: keep });
      const res = await badRequest(update(link.id, { expiresAt: "2026-01-01T00:00:00.000Z" }));
      expect(res.message).toEqual([EXPIRY_IN_PAST_MESSAGE]);
      expect((await stored(link.id)).expiresAt?.toISOString()).toBe(keep);
      // A link with no expiry at all: same.
      const open = await create();
      await badRequest(update(open.id, { expiresAt: iso(-DAY) }));
      expect((await stored(open.id)).expiresAt).toBeNull();
    });

    it("a link that has since expired can still be edited when its expiry is resent unchanged (the edit drawer sends every field)", async () => {
      const link = await create({ expiresAt: iso(30 * DAY) });
      await expireInDb(link.id, 3_600_000);
      const expired = await controller.get(ws.actor, link.id);
      expect(expired.status).toBe("expired");

      const edited = await update(link.id, { comment: "still editable", expiresAt: expired.expiresAt, activatesAt: null });
      expect(edited.comment).toBe("still editable");
      expect(edited.status).toBe("expired");
      expect(edited.expiresAt).toBe(expired.expiresAt);
    });

    it("…and when the expiry is omitted from the patch altogether", async () => {
      const link = await create({ expiresAt: iso(30 * DAY) });
      await expireInDb(link.id, DAY);
      const edited = await update(link.id, { comment: "omitted expiry" });
      expect(edited.comment).toBe("omitted expiry");
    });

    it("an expired link cannot be moved to a DIFFERENT past date", async () => {
      const link = await create({ expiresAt: iso(30 * DAY) });
      await expireInDb(link.id, DAY);
      const before = (await stored(link.id)).expiresAt;
      const res = await badRequest(update(link.id, { expiresAt: iso(-2 * DAY) }));
      expect(res.message).toEqual([EXPIRY_IN_PAST_MESSAGE]);
      expect((await stored(link.id)).expiresAt?.getTime()).toBe(before?.getTime());
    });

    it("an expired link can be revived with a future expiry, or have its expiry cleared", async () => {
      const link = await create({ expiresAt: iso(30 * DAY) });
      await expireInDb(link.id, DAY);
      const revived = await update(link.id, { expiresAt: iso(30 * DAY) });
      expect(revived.status).toBe("active");

      await expireInDb(link.id, DAY);
      const cleared = await update(link.id, { expiresAt: null });
      expect(cleared.status).toBe("active");
      expect(cleared.expiresAt ?? null).toBeNull();
    });

    it("'expire it now' (the current time, arriving a few seconds late) is accepted on edit within the one-minute skew tolerance", async () => {
      const link = await create({ expiresAt: iso(30 * DAY) });
      const edited = await update(link.id, { expiresAt: iso(-5_000) });
      expect(edited.status).toBe("expired");
      // Beyond the tolerance it is a past date again.
      await badRequest(update(link.id, { expiresAt: iso(-2 * 60_000) }));
    });

    it("another workspace's link is still a 404, never a validation answer about it", async () => {
      const theirs = await controller.create(other.actor, createPipe.transform(body({}, other.domain)) as CreateLinkInput);
      await expect(update(theirs.id, { expiresAt: iso(-DAY) })).rejects.toMatchObject({ status: 404 });
    });
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { createDatabase, domains, eq, links, sql, workspaces, type Database } from "@snapurl/database";
import { CloneLinkInput, CreateLinkInput } from "@snapurl/contract";
import { EXPIRY_IN_PAST_MESSAGE } from "@snapurl/domain";
import { zodBody } from "../common/zod.pipe.js";
import type { RequestActor } from "../auth/auth.guard.js";
import { LinksController } from "./links.controller.js";
import { LinksService } from "./links.service.js";
import type { SafeBrowsingService } from "../safe-browsing/safe-browsing.service.js";
import type { ProjectionNudgeService } from "./projection-nudge.service.js";
import type { LinkCacheBustService } from "../common/link-cache-bust.service.js";

/* ============================================================
   Issue #812 — cloning an EXPIRED link produced a born-expired copy.

   clone() copied the source's whole schedule window including expiresAt, and
   CloneLinkInput had no field to override it. #754 refuses a past expiry on
   create/bulk/edit, but the clone path deliberately skipped validateExpiry
   (insert()'s `clonedFrom ? [] : validateExpiry(...)` gate), so cloning an
   expired link answered 201 with a copy that was already expired on its first
   click.

   Fix (option 2): CloneLinkInput gains an optional expiresAt override, clone()
   resolves it (override value / explicit null / inherited source window), and
   insert() validates that RESOLVED expiry on the clone path too. A clone can no
   longer be born expired — the caller supplies a future (or null) expiry, or
   gets a 400.

   Drives the real controller path (controller's zodBody pipe → LinksController)
   against a real Postgres, and reads stored rows back rather than trusting the
   DTO, matching links.past-expiry.integration.test.ts.
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

describeDb("cloning an expired link cannot produce a born-expired copy (#812)", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;
  let controller: LinksController;
  const stamp = Date.now();
  const createPipe = zodBody(CreateLinkInput);
  const clonePipe = zodBody(CloneLinkInput);
  const ws = { id: "", domain: `cx-${stamp}.test`, actor: undefined as unknown as RequestActor };

  let n = 0;
  const body = (extra: Record<string, unknown> = {}) => ({
    destination: `https://example.com/cx/${stamp}/${n}`,
    domain: ws.domain,
    slug: `cx-${stamp}-${n++}`,
    ...extra,
  });
  const create = (extra: Record<string, unknown> = {}) =>
    controller.create(ws.actor, createPipe.transform(body(extra)) as CreateLinkInput);
  const clone = (id: string, input: Record<string, unknown> = {}) =>
    controller.clone(ws.actor, id, clonePipe.transform(input) as CloneLinkInput);
  const stored = async (id: string) =>
    (await db.select({ expiresAt: links.expiresAt }).from(links).where(eq(links.id, id)))[0]!;
  /** Time passing: move a stored expiry into the past without going through the API. */
  const expireInDb = (id: string, agoMs: number) =>
    db.update(links).set({ expiresAt: sql`now() - make_interval(secs => ${agoMs / 1000})` }).where(eq(links.id, id));

  /** Create a link with a future expiry, then age it out so it is genuinely expired. */
  async function makeExpiredLink(): Promise<string> {
    const link = await create({ expiresAt: iso(30 * DAY) });
    await expireInDb(link.id, DAY);
    const after = await controller.get(ws.actor, link.id);
    expect(after.status).toBe("expired");
    return link.id;
  }

  beforeAll(async () => {
    handle = createDatabase({ url: DATABASE_URL!, max: 1 });
    db = handle.db;
    controller = new LinksController(new LinksService(db, db, safeBrowsingStub, projectionNudgeStub, cacheBustStub));
    const [row] = await db
      .insert(workspaces)
      .values({ name: `clone expiry ${ws.domain}`, slug: `cx-${stamp}` })
      .returning({ id: workspaces.id });
    ws.id = row!.id;
    ws.actor = { userId: null, workspaceId: ws.id, role: "editor", email: "actor@example.com", label: "actor@example.com" };
    await db.insert(domains).values({ workspaceId: ws.id, domain: ws.domain, status: "live", verifiedAt: new Date() });
  });

  afterAll(async () => {
    if (ws.id) await db.delete(workspaces).where(eq(workspaces.id, ws.id));
    await handle?.close();
  });

  // (a) The bug: cloning an expired link with NO override is now a 400 with the
  //     human message. On the old code this answered 201 with a born-expired copy.
  it("cloning an expired link with no expiresAt override is a 400 with the human message", async () => {
    const sourceId = await makeExpiredLink();
    const res = await badRequest(clone(sourceId));
    expect(res.message).toEqual([EXPIRY_IN_PAST_MESSAGE]);
  });

  // (b) A future override clones successfully and the clone carries the new expiry.
  it("cloning an expired link with a future expiresAt override succeeds and carries the new expiry", async () => {
    const sourceId = await makeExpiredLink();
    const future = iso(30 * DAY);
    const cloned = await clone(sourceId, { expiresAt: future });
    expect(cloned.status).toBe("active");
    expect((await stored(cloned.id)).expiresAt?.toISOString()).toBe(future);
    // A genuinely new link, not the source.
    expect(cloned.id).not.toBe(sourceId);
  });

  // (c) An explicit null override clones successfully with no expiry at all.
  it("cloning an expired link with expiresAt: null succeeds and the clone has no expiry", async () => {
    const sourceId = await makeExpiredLink();
    const cloned = await clone(sourceId, { expiresAt: null });
    expect(cloned.status).toBe("active");
    expect(cloned.expiresAt ?? null).toBeNull();
    expect((await stored(cloned.id)).expiresAt).toBeNull();
  });

  // (d) Regression: cloning a NON-expired link still works unchanged, inheriting
  //     the source's future expiry when no override is given.
  it("cloning a link with a future expiry still inherits that expiry (regression)", async () => {
    const future = iso(30 * DAY);
    const source = await create({ expiresAt: future });
    expect(source.status).toBe("active");
    const cloned = await clone(source.id);
    expect(cloned.status).toBe("active");
    expect((await stored(cloned.id)).expiresAt?.toISOString()).toBe(future);
  });

  it("cloning a link with NO expiry still produces a clone with no expiry (regression)", async () => {
    const source = await create();
    expect(source.expiresAt ?? null).toBeNull();
    const cloned = await clone(source.id);
    expect(cloned.status).toBe("active");
    expect(cloned.expiresAt ?? null).toBeNull();
  });

  it("a past expiresAt override is refused too — the override is validated, not trusted", async () => {
    const source = await create({ expiresAt: iso(30 * DAY) });
    const res = await badRequest(clone(source.id, { expiresAt: iso(-2 * DAY) }));
    expect(res.message).toEqual([EXPIRY_IN_PAST_MESSAGE]);
  });
});

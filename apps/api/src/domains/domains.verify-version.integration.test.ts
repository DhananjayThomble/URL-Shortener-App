import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  createDatabase,
  DOMAIN_OP,
  domains,
  eq,
  projectionOutbox,
  sql,
  workspaces,
  type Database,
} from "@snapurl/database";
import type { Actor } from "../common/activity.js";
import { DomainsService } from "./domains.service.js";

/* ============================================================
   #729 items 1 + 4 — domain-meta version-under-lock, and verify() enqueue.

   Item 1: domains.service.update() must derive the meta version (updated_at)
   in SQL under the row lock the UPDATE takes, as
   greatest(clock_timestamp(), updated_at + interval '1 millisecond'), NOT as a
   `new Date()` captured in app code before the transaction begins. Two
   properties follow and are asserted here against a real Postgres:
     - updated_at is monotonically INCREASING across successive edits of one
       domain (strictly greater each time), so the projection's version guard
       never treats a later-committed edit as superseded; and
     - the stored updated_at is the DATABASE's clock at commit, not a value the
       caller could have stamped before the row lock — proven by the floor:
       even two edits in the same wall-clock millisecond differ.

   Item 4: domains.service.verify() moves a domain to 'live' and must enqueue a
   DOMAIN projection op in the same transaction (so the now-live meta item is
   projected for a domain with redirects but no links), then nudge the drain —
   exactly how add()/update()/remove() do.

   resolveTxt is mocked so verify() sees the matching ownership token without
   real DNS. Runs only when DATABASE_URL is set.
   ============================================================ */

const resolveTxtMock = vi.fn();
vi.mock("node:dns/promises", () => ({
  resolveTxt: (...args: unknown[]) => resolveTxtMock(...args),
  lookup: vi.fn().mockResolvedValue([{ address: "93.184.215.14", family: 4 }]),
}));

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

describeDb("DomainsService version-under-lock + verify() enqueue (#729 items 1, 4)", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;
  let service: DomainsService;
  const nudge = vi.fn();
  const stamp = `${Date.now().toString(36)}${Math.random().toString(16).slice(2, 6)}`;
  const workspaceId = randomUUID();

  const admin: Actor = {
    userId: null,
    workspaceId,
    role: "admin",
    email: "admin@example.com",
    label: "admin@example.com",
  } as Actor;

  beforeAll(async () => {
    handle = createDatabase({ url: DATABASE_URL!, max: 1 });
    db = handle.db;
    service = new DomainsService(db, { nudge } as never, { DEFAULT_DOMAIN: "snap.example.com" } as never);
    await db.insert(workspaces).values({ id: workspaceId, name: "v729", slug: `v729-${stamp}` });
  });

  afterAll(async () => {
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await handle?.close();
  });

  const read = async (id: string) => {
    const [row] = await db.select().from(domains).where(eq(domains.id, id)).limit(1);
    return row!;
  };
  const outboxFor = (domainId: string) =>
    db.select().from(projectionOutbox).where(eq(projectionOutbox.linkId, domainId)).orderBy(projectionOutbox.id);

  it("item 1: successive update()s advance updated_at strictly even when the app clock does NOT (derived under the row lock)", async () => {
    const [d] = await db
      .insert(domains)
      .values({ workspaceId, domain: `v1-${stamp}.test`, status: "live" })
      .returning({ id: domains.id });
    const id = d!.id;

    /* FREEZE the application clock at a single instant for the whole test.
       This is the deterministic discriminator between the two implementations:
         - OLD code stamps updated_at = `new Date()` in app code, so with the
           clock frozen every edit would write the SAME timestamp and the
           sequence is NOT strictly increasing — the exact race (a later commit
           carrying an equal-or-earlier version) the fix removes.
         - NEW code derives it in SQL as
           greatest(clock_timestamp(), updated_at + interval '1 millisecond'),
           independent of the app clock, so each edit is strictly greater than
           the stored value regardless of what Date reports.
       Mocking Date (not the DB clock) is what lets this assert the version is
       the DATABASE's, not a value the caller stamped. */
    const frozen = new Date("2026-03-03T03:03:03.000Z").getTime();
    const RealDate = Date;
    // vitest 4 invokes a mock implementation with the caller's `new`, and the
    // app code does `new Date()`. An arrow function has no [[Construct]], so it
    // threw "is not a constructor" under vitest 4; a regular function constructs
    // fine. (vitest 3 tolerated the arrow.)
    const dateSpy = vi.spyOn(globalThis, "Date").mockImplementation(function (...args: unknown[]) {
      return args.length ? new (RealDate as any)(...args) : new (RealDate as any)(frozen);
    } as never);
    (globalThis.Date as any).now = () => frozen;

    try {
      const stamps: number[] = [];
      for (let i = 0; i < 6; i++) {
        await service.update(workspaceId, id, { rootRedirect: `https://example.org/r${i}` }, admin);
        stamps.push((await read(id)).updatedAt.getTime());
      }

      // Strictly increasing despite the frozen app clock — the SQL floor
      // (+1ms) guarantees it, so a later-committed edit can never be treated
      // as superseded by the projection's version guard.
      for (let i = 1; i < stamps.length; i++) {
        expect(stamps[i]!).toBeGreaterThan(stamps[i - 1]!);
      }
    } finally {
      dateSpy.mockRestore();
    }
  });

  it("item 1: a cleared-only edit (no redirect change) STILL advances updated_at", async () => {
    const [d] = await db
      .insert(domains)
      .values({
        workspaceId,
        domain: `v1b-${stamp}.test`,
        status: "live",
        rootRedirect: "https://example.org/keep",
      })
      .returning({ id: domains.id });
    const id = d!.id;
    const before = (await read(id)).updatedAt.getTime();

    // notFoundRedirect: null is a real patch; updated_at must move forward so
    // the projection re-settles on this state.
    await service.update(workspaceId, id, { notFoundRedirect: null }, admin);
    expect((await read(id)).updatedAt.getTime()).toBeGreaterThan(before);
  });

  it("item 4: verify() moves the domain to live AND enqueues a domain op + nudges", async () => {
    const token = `snapurl-verify-${stamp}`;
    const [d] = await db
      .insert(domains)
      .values({
        workspaceId,
        domain: `v4-${stamp}.test`,
        status: "verifying",
        verificationToken: token,
        rootRedirect: "https://example.org/root",
      })
      .returning({ id: domains.id });
    const id = d!.id;

    resolveTxtMock.mockReset();
    resolveTxtMock.mockResolvedValue([[token]]);
    nudge.mockReset();

    const before = await outboxFor(id);
    const dto = await service.verify(workspaceId, id, admin);

    expect(dto.status).toBe("live");
    expect((await read(id)).status).toBe("live");

    // Exactly one new DOMAIN op, keyed on the domain id, carrying the host.
    const after = await outboxFor(id);
    expect(after.length - before.length).toBe(1);
    expect(after.at(-1)!.operation).toBe(DOMAIN_OP);
    expect(after.at(-1)!.payload).toMatchObject({ domainId: id, host: `v4-${stamp}.test` });
    // The drain is nudged so the projection settles promptly.
    expect(nudge).toHaveBeenCalledTimes(1);
  });

  it("item 4: verify() does NOT enqueue when the TXT token does not match (no state change)", async () => {
    const [d] = await db
      .insert(domains)
      .values({
        workspaceId,
        domain: `v4b-${stamp}.test`,
        status: "verifying",
        verificationToken: `snapurl-verify-other-${stamp}`,
      })
      .returning({ id: domains.id });
    const id = d!.id;

    resolveTxtMock.mockReset();
    resolveTxtMock.mockResolvedValue([["something-else"]]);
    nudge.mockReset();

    const before = await outboxFor(id);
    await expect(service.verify(workspaceId, id, admin)).rejects.toBeTruthy();

    expect((await read(id)).status).toBe("verifying");
    expect((await outboxFor(id)).length).toBe(before.length);
    expect(nudge).not.toHaveBeenCalled();
  });

  it("BLOCKER regression: an update() then verify() on one domain strictly advances updated_at even with the app clock FROZEN", async () => {
    /* The review BLOCKER: verify() stamped `new Date()`, so a verify() racing
       an update() on the same row could carry an EARLIER instant yet commit
       last — the worker then projects that row while the conditional meta write
       is swallowed as superseded, leaving DynamoDB stale. Both paths must now
       derive updated_at in SQL under the row lock (shared nextVersionSql). With
       the app clock frozen, update() and verify() share no advancing Date, so
       the SQL +1ms floor is the ONLY thing that can keep updated_at strictly
       increasing across the two calls — which is exactly what the fix adds.
       RED on the pre-fix verify() (new Date() == frozen, so verify ties or
       regresses update's version). */
    const token = `snapurl-verify-seq-${stamp}`;
    const [d] = await db
      .insert(domains)
      .values({
        workspaceId,
        domain: `vseq-${stamp}.test`,
        status: "verifying",
        verificationToken: token,
        rootRedirect: "https://example.org/root",
      })
      .returning({ id: domains.id });
    const id = d!.id;

    resolveTxtMock.mockReset();
    resolveTxtMock.mockResolvedValue([[token]]);

    const frozen = new Date("2026-04-04T04:04:04.000Z").getTime();
    const RealDate = Date;
    // vitest 4 invokes a mock implementation with the caller's `new`, and the
    // app code does `new Date()`. An arrow function has no [[Construct]], so it
    // threw "is not a constructor" under vitest 4; a regular function constructs
    // fine. (vitest 3 tolerated the arrow.)
    const dateSpy = vi.spyOn(globalThis, "Date").mockImplementation(function (...args: unknown[]) {
      return args.length ? new (RealDate as any)(...args) : new (RealDate as any)(frozen);
    } as never);
    (globalThis.Date as any).now = () => frozen;

    try {
      // A verifying-domain update() stamps the first version under the row lock.
      await service.update(workspaceId, id, { rootRedirect: "https://example.org/pre" }, admin);
      const afterUpdate = (await read(id)).updatedAt.getTime();

      // verify() flips to live; its updated_at must be STRICTLY greater than the
      // update()'s, despite both seeing the same frozen `new Date()`.
      await service.verify(workspaceId, id, admin);
      const afterVerify = (await read(id)).updatedAt.getTime();

      expect(afterVerify).toBeGreaterThan(afterUpdate);
    } finally {
      dateSpy.mockRestore();
    }
  });

  it("SHOULD-FIX regression: repeated verify() on a live domain produces exactly ONE outbox op, one nudge, no second activity", async () => {
    /* verify() used to redo DNS, rewrite the timestamp, enqueue another outbox
       row, nudge and record a second activity event every time it was called on
       an already-live domain. It must now be idempotent: the first call does the
       work, every subsequent call is a no-op returning the unchanged domain.
       RED on the pre-fix verify() (each call enqueued another op + nudge). */
    const token = `snapurl-verify-idem-${stamp}`;
    const [d] = await db
      .insert(domains)
      .values({
        workspaceId,
        domain: `videm-${stamp}.test`,
        status: "verifying",
        verificationToken: token,
        rootRedirect: "https://example.org/root",
      })
      .returning({ id: domains.id });
    const id = d!.id;

    resolveTxtMock.mockReset();
    resolveTxtMock.mockResolvedValue([[token]]);
    nudge.mockReset();

    const before = await outboxFor(id);
    // Three verify() calls; only the first transitions the domain.
    const first = await service.verify(workspaceId, id, admin);
    const second = await service.verify(workspaceId, id, admin);
    const third = await service.verify(workspaceId, id, admin);

    expect(first.status).toBe("live");
    expect(second.status).toBe("live");
    expect(third.status).toBe("live");

    // Exactly one DOMAIN op was enqueued across all three calls.
    const after = await outboxFor(id);
    expect(after.length - before.length).toBe(1);
    expect(after.at(-1)!.operation).toBe(DOMAIN_OP);
    // Only the first call nudged the drain; the no-op calls did nothing.
    expect(nudge).toHaveBeenCalledTimes(1);
    // Only the first call wrote a domain.verified activity entry.
    const [{ n }] = (await db.execute(sql`
      select count(*)::int as n from audit_log
      where target_id = ${id}::uuid and action = 'domain.verified'
    `)) as unknown as [{ n: number }];
    expect(n).toBe(1);
  });
});

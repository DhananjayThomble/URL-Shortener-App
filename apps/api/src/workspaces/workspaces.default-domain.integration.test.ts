import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BadRequestException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { createDatabase, domains, eq, workspaces, type Database } from "@snapurl/database";
import { UpdateWorkspaceInput } from "@snapurl/contract";
import { zodBody } from "../common/zod.pipe.js";
import { REQUIRED_ROLES, satisfiesRole } from "../auth/auth.guard.js";
import { WorkspacesController } from "./workspaces.controller.js";
import { WorkspacesService } from "./workspaces.service.js";

/* ============================================================
   #779 — PATCH /workspaces/current {defaultDomain}.

   Before the fix an unknown domain was silently ignored: the request answered
   200, the OTHER fields in the same PATCH were saved, and GET still returned
   the old default. The settings screen then showed no message and kept its
   Save/Discard bar up as if the change were pending.

   Oracles (not this file's implementation):
     - the issue's acceptance criteria: an unknown or foreign domain is a 400
       and the WHOLE PATCH is rejected (nothing else is saved either);
     - the rule every other "pick a domain" path already follows
       (links.service resolveDomain): only a domain the workspace owns, or the
       shared system domain, and only one that is live, can carry links;
     - the role gate: PATCH /workspaces/current is @Roles("admin").

   Runs only when DATABASE_URL is set.
   ============================================================ */

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

describeDb("WorkspacesService.update — defaultDomain validation (#779)", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;
  let service: WorkspacesService;
  let controller: WorkspacesController;

  const stamp = `${Date.now().toString(36)}${Math.random().toString(16).slice(2, 6)}`;
  const own = randomUUID();
  const other = randomUUID();
  const ownLive = `Own-Live-${stamp}.test`; // stored mixed-case on purpose
  const ownPending = `own-pending-${stamp}.test`;
  const ownFailed = `own-failed-${stamp}.test`;
  const otherLive = `other-live-${stamp}.test`;
  const shared = `shared-${stamp}.test`;
  let sharedId: string;
  let ownLiveId: string;

  const pipe = zodBody(UpdateWorkspaceInput);
  const actor = { userId: null, workspaceId: own, role: "owner", email: "o@example.com", label: "o@example.com" } as const;

  beforeAll(async () => {
    handle = createDatabase({ url: DATABASE_URL!, max: 1 });
    db = handle.db;
    service = new WorkspacesService(db);
    controller = new WorkspacesController(service);

    await db.insert(workspaces).values({ id: own, name: "own", slug: `dd-own-${stamp}` });
    await db.insert(workspaces).values({ id: other, name: "other", slug: `dd-other-${stamp}` });

    const [s] = await db
      .insert(domains)
      .values({ workspaceId: null, domain: shared, isSystem: true, status: "live" })
      .returning({ id: domains.id });
    sharedId = s!.id;
    const [l] = await db
      .insert(domains)
      .values({ workspaceId: own, domain: ownLive, status: "live", ssl: "active" })
      .returning({ id: domains.id });
    ownLiveId = l!.id;
    await db.insert(domains).values({ workspaceId: own, domain: ownPending, status: "verifying" });
    await db.insert(domains).values({ workspaceId: own, domain: ownFailed, status: "failed" });
    await db.insert(domains).values({ workspaceId: other, domain: otherLive, status: "live", ssl: "active" });

    await db.update(workspaces).set({ defaultDomainId: sharedId }).where(eq(workspaces.id, own));
  });

  afterAll(async () => {
    await db.update(workspaces).set({ defaultDomainId: null }).where(eq(workspaces.id, own));
    await db.delete(domains).where(eq(domains.workspaceId, own));
    await db.delete(domains).where(eq(domains.workspaceId, other));
    await db.delete(domains).where(eq(domains.id, sharedId));
    await db.delete(workspaces).where(eq(workspaces.id, own));
    await db.delete(workspaces).where(eq(workspaces.id, other));
    await handle?.close();
  });

  const reset = () => db.update(workspaces).set({ defaultDomainId: sharedId, currency: "INR" }).where(eq(workspaces.id, own));
  const stored = async () => {
    const [row] = await db.select().from(workspaces).where(eq(workspaces.id, own)).limit(1);
    return row!;
  };
  const patch = (body: unknown) => controller.update(actor, pipe.transform(body));

  it("an unknown domain is a 400 with a readable message, and nothing is saved", async () => {
    await reset();
    const err = await patch({ defaultDomain: "not-mine.example" }).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as BadRequestException).message).toBe("not-mine.example isn't a domain in this workspace.");
    expect((await stored()).defaultDomainId).toBe(sharedId);
  });

  it("rejects the WHOLE patch: other fields in the same request are not saved either", async () => {
    await reset();
    await expect(patch({ defaultDomain: "not-mine.example", currency: "USD", name: "renamed" })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    const row = await stored();
    expect(row.currency).toBe("INR");
    expect(row.name).toBe("own");
    expect(row.defaultDomainId).toBe(sharedId);
  });

  it("another workspace's domain is refused exactly like an unknown one (no leak that it exists)", async () => {
    await reset();
    const foreign = await patch({ defaultDomain: otherLive }).catch((e) => e);
    const unknown = await patch({ defaultDomain: `nope-${stamp}.test` }).catch((e) => e);
    expect(foreign).toBeInstanceOf(BadRequestException);
    expect((foreign as Error).message).toBe(`${otherLive} isn't a domain in this workspace.`);
    expect((unknown as Error).message).toBe(`nope-${stamp}.test isn't a domain in this workspace.`);
    expect((await stored()).defaultDomainId).toBe(sharedId);
  });

  it.each([
    ["pending", ownPending],
    ["failed", ownFailed],
  ])("a %s (unverified) own domain is a 400: it can't carry links yet", async (_s, name) => {
    await reset();
    const err = await patch({ defaultDomain: name }).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as Error).message).toBe(`${name} isn't verified yet, so links on it wouldn't resolve.`);
    expect((await stored()).defaultDomainId).toBe(sharedId);
  });

  it.each([
    ["empty", ""],
    ["whitespace only", "   \t "],
    ["a lone dot", "."],
  ])("%s is a 400, not a silent no-op", async (_s, value) => {
    await reset();
    const err = await patch({ defaultDomain: value }).catch((e) => e);
    expect(err).toBeInstanceOf(BadRequestException);
    expect((err as Error).message).toBe("Choose a default domain.");
    expect((await stored()).defaultDomainId).toBe(sharedId);
  });

  it.each([
    ["exact", ownLive],
    ["lower-cased", ownLive.toLowerCase()],
    ["upper-cased", ownLive.toUpperCase()],
    ["surrounded by whitespace", `  ${ownLive}\n`],
    ["with a trailing dot", `${ownLive}.`],
  ])("accepts the workspace's own live domain %s (normalised) and saves it", async (_s, value) => {
    await reset();
    const ws = await patch({ defaultDomain: value });
    expect(ws.defaultDomain).toBe(ownLive);
    expect((await stored()).defaultDomainId).toBe(ownLiveId);
  });

  it("accepts the shared system domain", async () => {
    await db.update(workspaces).set({ defaultDomainId: ownLiveId }).where(eq(workspaces.id, own));
    const ws = await patch({ defaultDomain: shared.toUpperCase() });
    expect(ws.defaultDomain).toBe(shared);
    expect((await stored()).defaultDomainId).toBe(sharedId);
  });

  it("re-sending the CURRENT default is a no-op even if it is no longer live (old web clients send the whole form)", async () => {
    await db.update(workspaces).set({ defaultDomainId: sharedId }).where(eq(workspaces.id, own));
    await db.update(domains).set({ status: "failed" }).where(eq(domains.id, ownLiveId));
    try {
      await db.update(workspaces).set({ defaultDomainId: ownLiveId }).where(eq(workspaces.id, own));
      const ws = await patch({ defaultDomain: ownLive, currency: "USD" });
      expect(ws.currency).toBe("USD");
      expect(ws.defaultDomain).toBe(ownLive);
    } finally {
      await db.update(domains).set({ status: "live" }).where(eq(domains.id, ownLiveId));
    }
  });

  it("a workspace with no default yet: re-sending '' is a no-op, choosing a live domain sets it", async () => {
    await db.update(workspaces).set({ defaultDomainId: null }).where(eq(workspaces.id, own));
    const unchanged = await patch({ defaultDomain: "", currency: "USD" });
    expect(unchanged.defaultDomain).toBe("");
    expect(unchanged.currency).toBe("USD");
    const set = await patch({ defaultDomain: shared });
    expect(set.defaultDomain).toBe(shared);
  });

  it("a PATCH with no defaultDomain still saves the other fields", async () => {
    await reset();
    const ws = await patch({ currency: "usd" });
    expect(ws.currency).toBe("USD");
    expect(ws.defaultDomain).toBe(shared);
  });

  it("is admin-or-owner only: editor and viewer are below the gate", () => {
    const roles = new Reflector().get<string[]>(REQUIRED_ROLES, WorkspacesController.prototype.update);
    expect(satisfiesRole("viewer", roles)).toBe(false);
    expect(satisfiesRole("editor", roles)).toBe(false);
    expect(satisfiesRole("admin", roles)).toBe(true);
    expect(satisfiesRole("owner", roles)).toBe(true);
  });
});

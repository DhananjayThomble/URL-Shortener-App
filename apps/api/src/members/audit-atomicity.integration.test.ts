import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  and,
  apiKeys,
  auditLog,
  bioPages,
  createDatabase,
  domains,
  eq,
  inArray,
  memberships,
  sql,
  webhooks,
  workspaces,
  type Database,
} from "@snapurl/database";
import { UpsertBioPageInput } from "@snapurl/contract";
import type { Actor } from "../common/activity.js";
import { MembersService } from "./members.service.js";
import { DomainsService } from "../domains/domains.service.js";
import { DevelopersService } from "../developers/developers.service.js";
import { makeBioService } from "../bio-pages/bio-pages.test-harness.js";

/* ============================================================
   #783 review, blocking 1 — an audited action and its audit row are atomic.

   If the audit insert fails, the action must not be left applied with no
   record of it (the review found changeRole committing the new role and THEN
   throwing on the audit insert: the caller saw a 500 for a change that had
   happened). Every audited mutation this PR touches now writes its row in the
   mutation's own transaction, so a failed insert rolls the mutation back and
   the caller's error describes a change that did not happen.

   Failure injection is real, not mocked: a BEFORE INSERT trigger on audit_log
   raises for rows whose actor_label is this run's poison label, and only
   those, so concurrent suites on the shared database are unaffected.

   Runs only when DATABASE_URL is set.
   ============================================================ */

vi.mock("node:dns/promises", () => ({
  lookup: async () => [{ address: "93.184.216.34", family: 4 }],
  resolveTxt: vi.fn(),
}));

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

describeDb("an audit insert that fails rolls its action back (#783)", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;
  let members: MembersService;
  let domainsService: DomainsService;
  let developers: DevelopersService;
  let bio: ReturnType<typeof makeBioService>;

  const stamp = `${Date.now().toString(36)}${Math.random().toString(16).slice(2, 6)}`;
  const fn = `audit_poison_${stamp}`;
  const ws = randomUUID();
  const good: Actor = { userId: null, label: `good-${stamp}@example.com` };
  const poison: Actor = { userId: null, label: `poison-${stamp}@example.com` };
  let liveDomain: string;

  const auditRowsBy = async (label: string) =>
    db.select().from(auditLog).where(and(eq(auditLog.workspaceId, ws), eq(auditLog.actorLabel, label)));

  beforeAll(async () => {
    handle = createDatabase({ url: DATABASE_URL!, max: 1 });
    db = handle.db;
    members = new MembersService(db, db, { sendInvite: async () => undefined } as never);
    domainsService = new DomainsService(db, { nudge: () => undefined } as never, { DEFAULT_DOMAIN: "snap.example.com" } as never);
    developers = new DevelopersService(db);
    bio = makeBioService(db);

    await db.insert(workspaces).values({ id: ws, name: "atomic", slug: `aud-atomic-${stamp}` });
    liveDomain = `atomic-${stamp}.example.com`;
    await db.insert(domains).values({ workspaceId: ws, domain: liveDomain, status: "live" });

    // Identifiers are derived from a [a-z0-9] stamp, so interpolating them is safe.
    await db.execute(
      sql.raw(`create function ${fn}() returns trigger language plpgsql as $$
        begin raise exception 'audit insert poisoned for this test'; end $$`),
    );
    await db.execute(
      sql.raw(`create trigger ${fn} before insert on audit_log for each row
        when (new.actor_label = '${poison.label}') execute function ${fn}()`),
    );
  });

  afterAll(async () => {
    await db.execute(sql.raw(`drop trigger if exists ${fn} on audit_log`));
    await db.execute(sql.raw(`drop function if exists ${fn}()`));
    for (const p of await db.select({ id: bioPages.id }).from(bioPages).where(eq(bioPages.workspaceId, ws))) {
      await bio.service.remove(ws, p.id, good);
    }
    await db.delete(apiKeys).where(eq(apiKeys.workspaceId, ws));
    await db.delete(webhooks).where(eq(webhooks.workspaceId, ws));
    await db.delete(domains).where(eq(domains.workspaceId, ws));
    await db.delete(memberships).where(eq(memberships.workspaceId, ws));
    await db.delete(auditLog).where(inArray(auditLog.workspaceId, [ws]));
    await db.delete(workspaces).where(eq(workspaces.id, ws));
    await handle.close();
  });

  it("the injected failure is real: a poisoned insert is refused, a normal one is not", async () => {
    await expect(
      db.insert(auditLog).values({ workspaceId: ws, actorLabel: poison.label, action: "member.removed" }),
    ).rejects.toThrow();
    await db.insert(auditLog).values({ workspaceId: ws, actorLabel: good.label, action: "member.removed" });
    expect(await auditRowsBy(good.label)).toHaveLength(1);
    await db.delete(auditLog).where(and(eq(auditLog.workspaceId, ws), eq(auditLog.actorLabel, good.label)));
  });

  describe("members", () => {
    const addMember = async (role: "viewer" | "editor" | "owner", status: "active" | "invited" = "active") => {
      const [row] = await db
        .insert(memberships)
        .values({
          workspaceId: ws,
          email: `m-${randomUUID().slice(0, 8)}-${stamp}@example.com`,
          role,
          status,
          inviteTokenHash: status === "invited" ? createHash("sha256").update(randomUUID()).digest("hex") : null,
          invitedAt: status === "invited" ? new Date() : null,
        })
        .returning();
      return row!;
    };

    it("changeRole: the role stays as it was", async () => {
      const m = await addMember("viewer");
      await expect(members.changeRole(ws, m.id, "editor", poison.label, "owner")).rejects.toThrow();
      const [after] = await db.select().from(memberships).where(eq(memberships.id, m.id));
      expect(after!.role).toBe("viewer");
    });

    it("remove: the member stays on the team", async () => {
      const m = await addMember("editor");
      await expect(members.remove(ws, m.id, poison.label)).rejects.toThrow();
      expect(await db.select().from(memberships).where(eq(memberships.id, m.id))).toHaveLength(1);
    });

    it("invite: no invitation is created (and no email is sent)", async () => {
      const sent: string[] = [];
      const svc = new MembersService(db, db, { sendInvite: async ({ to }: { to: string }) => void sent.push(to) } as never);
      const email = `inv-${stamp}@example.com`;
      await expect(svc.invite(ws, poison.label, { email, role: "viewer" })).rejects.toThrow();
      expect(await db.select().from(memberships).where(and(eq(memberships.workspaceId, ws), eq(memberships.email, email)))).toHaveLength(0);
      expect(sent).toEqual([]);
    });

    it("resend: the old invitation token is kept", async () => {
      const m = await addMember("viewer", "invited");
      await expect(members.resend(ws, m.id, poison.label)).rejects.toThrow();
      const [after] = await db.select().from(memberships).where(eq(memberships.id, m.id));
      expect(after!.inviteTokenHash).toBe(m.inviteTokenHash);
    });
  });

  describe("domains", () => {
    it("add: the domain is not connected", async () => {
      const host = `p-add-${stamp}.example.com`;
      await expect(domainsService.add(ws, { domain: host }, poison)).rejects.toThrow();
      expect(await db.select().from(domains).where(eq(domains.domain, host))).toHaveLength(0);
    });

    it("remove: the domain stays connected", async () => {
      const host = `p-rm-${stamp}.example.com`;
      const added = await domainsService.add(ws, { domain: host }, good);
      await expect(domainsService.remove(ws, added.id, poison)).rejects.toThrow();
      expect(await db.select().from(domains).where(eq(domains.id, added.id))).toHaveLength(1);
    });
  });

  describe("bio pages", () => {
    const input = (slug: string, status: "draft" | "live", id?: string) =>
      UpsertBioPageInput.parse({ id, domain: liveDomain, slug, status, profile: { name: "M", bio: "" }, blocks: [] });

    it("create: no page is saved", async () => {
      const slug = `p-new-${stamp}`;
      await expect(bio.service.upsert(ws, input(slug, "live"), poison)).rejects.toThrow();
      expect(await db.select().from(bioPages).where(and(eq(bioPages.workspaceId, ws), eq(bioPages.slug, slug)))).toHaveLength(0);
    });

    it("publish: the page stays a draft", async () => {
      const slug = `p-pub-${stamp}`;
      const draft = await bio.service.upsert(ws, input(slug, "draft"), good);
      await expect(bio.service.upsert(ws, input(slug, "live", draft.id), poison)).rejects.toThrow();
      const [after] = await db.select().from(bioPages).where(eq(bioPages.id, draft.id));
      expect(after!.status).toBe("draft");
    });

    it("delete: the page is still there", async () => {
      const slug = `p-del-${stamp}`;
      const page = await bio.service.upsert(ws, input(slug, "live"), good);
      await expect(bio.service.remove(ws, page.id, poison)).rejects.toThrow();
      expect(await db.select().from(bioPages).where(eq(bioPages.id, page.id))).toHaveLength(1);
    });
  });

  describe("developers", () => {
    it("createKey: no key is issued", async () => {
      const name = `p-key-${stamp}`;
      await expect(developers.createKey(ws, poison, { name, scopes: ["links:read"] })).rejects.toThrow();
      expect(await db.select().from(apiKeys).where(and(eq(apiKeys.workspaceId, ws), eq(apiKeys.name, name)))).toHaveLength(0);
    });

    it("revokeKey: the key keeps working", async () => {
      const key = await developers.createKey(ws, good, { name: `p-rev-${stamp}`, scopes: ["links:read"] });
      await expect(developers.revokeKey(ws, key.id, poison)).rejects.toThrow();
      const [after] = await db.select().from(apiKeys).where(eq(apiKeys.id, key.id));
      expect(after!.revokedAt).toBeNull();
    });

    it("createWebhook: no webhook is registered", async () => {
      const endpoint = `https://example.com/p-${stamp}`;
      await expect(developers.createWebhook(ws, { endpoint, events: ["link.created"] }, poison)).rejects.toThrow();
      expect(await db.select().from(webhooks).where(and(eq(webhooks.workspaceId, ws), eq(webhooks.endpoint, endpoint)))).toHaveLength(0);
    });

    it("removeWebhook: the webhook stays registered", async () => {
      const hook = await developers.createWebhook(ws, { endpoint: `https://example.com/q-${stamp}`, events: ["link.created"] }, good);
      await expect(developers.removeWebhook(ws, hook.id, poison)).rejects.toThrow();
      expect(await db.select().from(webhooks).where(eq(webhooks.id, hook.id))).toHaveLength(1);
    });
  });

  it("no poisoned row ever landed, and every rolled-back action left nothing half-applied", async () => {
    expect(await auditRowsBy(poison.label)).toEqual([]);
  });
});

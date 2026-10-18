import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { NotFoundException } from "@nestjs/common";
import { and, auditLog, createDatabase, domains, eq, inArray, memberships, workspaces, type Database } from "@snapurl/database";
import { AUDIT_ACTIONS } from "@snapurl/domain";
import { UpsertBioPageInput } from "@snapurl/contract";
import type { Actor } from "../common/activity.js";
import { MembersService } from "./members.service.js";
import { DomainsService } from "../domains/domains.service.js";
import { DevelopersService } from "../developers/developers.service.js";
import { makeBioService } from "../bio-pages/bio-pages.test-harness.js";

/* ============================================================
   #783 — the team page's "Recent activity" list.

   QA saw three things on /team:
     1. a raw "form.created" next to the human entries,
     2. "Changed a role from viewer to editor" without saying whose,
     3. connecting a domain and creating a bio page never appeared at all.

   Oracles: the acceptance criteria on the issue, and the multi-tenancy
   invariant (steering): GET /audit shows one workspace's trail and nothing
   from any other.

   Runs only when DATABASE_URL is set.
   ============================================================ */

vi.mock("node:dns/promises", () => ({
  // Example hosts resolve to a public address, so the SSRF DNS step passes.
  lookup: async () => [{ address: "93.184.216.34", family: 4 }],
  resolveTxt: vi.fn(),
}));

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

const RAW_KEY = /^[a-z][a-z_]*\.[a-z][a-z_]*$/;

describeDb("audit trail on the team page (#783)", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;
  let members: MembersService;
  let domainsService: DomainsService;
  let developers: DevelopersService;
  let bio: ReturnType<typeof makeBioService>;

  const stamp = `${Date.now().toString(36)}${Math.random().toString(16).slice(2, 6)}`;
  const own = randomUUID();
  const other = randomUUID();
  const actor: Actor = { userId: null, label: `owner-${stamp}@example.com` };
  const intruder: Actor = { userId: null, label: `intruder-${stamp}@example.com` };
  let liveDomain: string;

  const actionsIn = async (workspaceId: string) =>
    (await db.select({ action: auditLog.action }).from(auditLog).where(eq(auditLog.workspaceId, workspaceId))).map(
      (r) => r.action,
    );

  beforeAll(async () => {
    handle = createDatabase({ url: DATABASE_URL!, max: 1 });
    db = handle.db;
    members = new MembersService(db, db, { sendInvite: async () => undefined } as never);
    domainsService = new DomainsService(db, { nudge: () => undefined } as never, { DEFAULT_DOMAIN: "snap.example.com" } as never);
    developers = new DevelopersService(db);
    bio = makeBioService(db);

    await db.insert(workspaces).values([
      { id: own, name: "own", slug: `aud-own-${stamp}` },
      { id: other, name: "other", slug: `aud-other-${stamp}` },
    ]);
    liveDomain = `bio-${stamp}.example.com`;
    await db.insert(domains).values({ workspaceId: own, domain: liveDomain, status: "live" });
  });

  afterAll(async () => {
    const ids = [own, other];
    await db.delete(auditLog).where(inArray(auditLog.workspaceId, ids));
    await db.delete(workspaces).where(inArray(workspaces.id, ids));
    await handle.close();
  });

  it("renders every stored action as a sentence — none reaches the page as its key", async () => {
    const ws = randomUUID();
    await db.insert(workspaces).values({ id: ws, name: "copy", slug: `aud-copy-${stamp}` });
    try {
      // form.created is the one QA saw; the rest are every other key the API writes.
      await db.insert(auditLog).values(
        AUDIT_ACTIONS.map((action) => ({
          workspaceId: ws,
          actorLabel: "a@example.com",
          action,
          metadata: { slug: "s", domain: "d.example.com", email: "b@example.com", from: "viewer", to: "editor" },
        })),
      );
      const entries = await members.audit(ws, 100);
      expect(entries).toHaveLength(AUDIT_ACTIONS.length);
      for (const entry of entries) {
        expect(entry.action).not.toMatch(RAW_KEY);
      }
      expect(entries.map((e) => e.action)).toContain("Created the form /f/s");
    } finally {
      await db.delete(auditLog).where(eq(auditLog.workspaceId, ws));
      await db.delete(workspaces).where(eq(workspaces.id, ws));
    }
  });

  it("names the member whose role changed", async () => {
    const email = `maya-${stamp}@example.com`;
    const invited = await members.invite(own, actor.label, { email, role: "viewer" });
    await members.changeRole(own, invited.id, "editor", actor.label, "owner");

    const entries = await members.audit(own);
    expect(entries.map((e) => e.action)).toContain(`Changed ${email}'s role from viewer to editor`);
    expect(entries.map((e) => e.action)).toContain(`Invited ${email} as viewer`);
    await db.delete(memberships).where(eq(memberships.id, invited.id));
  });

  it("logs connecting and disconnecting a domain", async () => {
    const host = `add-${stamp}.example.com`;
    const added = await domainsService.add(own, { domain: host }, actor);
    await domainsService.remove(own, added.id, actor);

    const sentences = (await members.audit(own)).filter((e) => e.actor === actor.label).map((e) => e.action);
    expect(sentences).toContain(`Connected ${host}`);
    expect(sentences).toContain(`Disconnected ${host}`);
  });

  it("logs creating, publishing, unpublishing and deleting a bio page", async () => {
    const slug = `me-${stamp}`;
    const base = { domain: liveDomain, slug, profile: { name: "Maya", bio: "" }, blocks: [] };
    const draft = await bio.service.upsert(own, UpsertBioPageInput.parse({ ...base, status: "draft" }), actor);
    await bio.service.upsert(own, UpsertBioPageInput.parse({ ...base, id: draft.id, status: "live" }), actor);
    await bio.service.upsert(own, UpsertBioPageInput.parse({ ...base, id: draft.id, status: "live" }), actor);
    await bio.service.upsert(own, UpsertBioPageInput.parse({ ...base, id: draft.id, status: "draft" }), actor);
    await bio.service.remove(own, draft.id, actor);

    const page = `the bio page ${liveDomain}/${slug}`;
    const sentences = (await members.audit(own)).map((e) => e.action);
    expect(sentences).toContain(`Created ${page} as a draft`);
    expect(sentences).toContain(`Published ${page}`);
    expect(sentences).toContain(`Edited ${page}`);
    expect(sentences).toContain(`Unpublished ${page}`);
    expect(sentences).toContain(`Deleted ${page}`);
  });

  it("logs creating a page straight to live as created-and-published, once", async () => {
    const slug = `live-${stamp}`;
    const page = await bio.service.upsert(
      own,
      UpsertBioPageInput.parse({ domain: liveDomain, slug, status: "live", profile: { name: "M", bio: "" }, blocks: [] }),
      actor,
    );
    const rows = await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(and(eq(auditLog.workspaceId, own), eq(auditLog.targetId, page.id)));
    expect(rows.map((r) => r.action)).toEqual(["bio_page.created"]);
    expect((await members.audit(own)).map((e) => e.action)).toContain(
      `Created and published the bio page ${liveDomain}/${slug}`,
    );
    await bio.service.remove(own, page.id, actor);
  });

  it("logs API keys and webhooks being created and revoked", async () => {
    const key = await developers.createKey(own, actor, { name: "ci", scopes: ["links:read"] });
    await developers.revokeKey(own, key.id, actor);
    const hook = await developers.createWebhook(own, { endpoint: "https://example.com/hook", events: ["link.created"] }, actor);
    await developers.removeWebhook(own, hook.id, actor);

    const actions = await actionsIn(own);
    for (const a of ["apikey.created", "apikey.revoked", "webhook.created", "webhook.removed"]) {
      expect(actions).toContain(a);
    }
    // The key's value and the webhook's endpoint (which can carry a token in
    // its query) never go into a trail every viewer can read.
    const rows = await db.select().from(auditLog).where(eq(auditLog.workspaceId, own));
    const dump = JSON.stringify(rows);
    expect(dump).not.toContain(key.key);
    expect(dump).not.toContain("example.com/hook");
  });

  describe("workspace isolation", () => {
    it("GET /audit for one workspace shows nothing written in another", async () => {
      const host = `other-${stamp}.example.com`;
      const added = await domainsService.add(other, { domain: host }, intruder);
      try {
        const ownEntries = await members.audit(own, 500);
        expect(ownEntries.some((e) => e.actor === intruder.label)).toBe(false);
        expect(ownEntries.some((e) => e.action.includes(host))).toBe(false);

        const otherEntries = await members.audit(other, 500);
        expect(otherEntries.map((e) => e.action)).toEqual([`Connected ${host}`]);
        expect(otherEntries.some((e) => e.actor === actor.label)).toBe(false);
      } finally {
        await domainsService.remove(other, added.id, intruder);
      }
    });

    it("a refused cross-workspace delete writes no audit row anywhere", async () => {
      const host = `victim-${stamp}.example.com`;
      const victim = await domainsService.add(other, { domain: host }, intruder);
      const ownBefore = (await actionsIn(own)).length;
      const otherBefore = (await actionsIn(other)).length;

      await expect(domainsService.remove(own, victim.id, actor)).rejects.toBeInstanceOf(NotFoundException);
      const [stillThere] = await db.select().from(domains).where(eq(domains.id, victim.id));
      expect(stillThere).toBeTruthy();

      const hook = await developers.createWebhook(other, { endpoint: "https://example.com/h2", events: ["link.created"] }, intruder);
      await expect(developers.removeWebhook(own, hook.id, actor)).rejects.toBeInstanceOf(NotFoundException);

      // A draft may sit on a still-verifying domain the workspace owns.
      const page = await bio.service.upsert(
        other,
        UpsertBioPageInput.parse({ domain: host, slug: `x-${stamp}`, status: "draft", profile: { name: "M", bio: "" }, blocks: [] }),
        intruder,
      );
      await expect(bio.service.remove(own, page.id, actor)).rejects.toBeInstanceOf(NotFoundException);

      expect((await actionsIn(own)).length).toBe(ownBefore);
      // Only the intruder's own webhook and page were added on their side.
      expect((await actionsIn(other)).length).toBe(otherBefore + 2);

      await developers.removeWebhook(other, hook.id, intruder);
      await bio.service.remove(other, page.id, intruder);
      await domainsService.remove(other, victim.id, intruder);
    });
  });
});

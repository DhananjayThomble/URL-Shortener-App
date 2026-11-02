import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import {
  adminAuditLog,
  and,
  blockedDomains,
  createDatabase,
  desc,
  domains,
  eq,
  links,
  projectionOutbox,
  sql,
  users,
  workspaces,
  type Database,
} from "@snapurl/database";
import { PostgresLinkResolver } from "../../../redirect/src/resolver.js";
import { effectiveGate } from "@snapurl/domain";
import { LinksService } from "../links/links.service.js";
import { openPlatformSettingsStub } from "../test/platform-settings.stub.js";
import { signupRefusalStub } from "../test/signup-controls.stub.js";
import { AdminModerationService } from "./admin.moderation.service.js";
import type { AdminIdentity } from "./admin.service.js";
import type { SafeBrowsingService } from "../safe-browsing/safe-browsing.service.js";
import type { ProjectionNudgeService } from "../links/projection-nudge.service.js";
import type { LinkCacheBustService } from "../common/link-cache-bust.service.js";
import { toActor } from "../common/activity.js";

/* ============================================================
   #971 — admin moderation against a real Postgres.

   These are the issue's acceptance tests, each asserting on rows THIS suite
   seeds (never on global totals — other suites share the database):

     • a disabled link stops redirecting at the edge, and re-enabling it
       restores the redirect — proven through the SAME gate the redirect uses
       (effectiveGate over the PostgresLinkResolver's ResolvedLink) plus the
       projection outbox row that carries the change to the edge;
     • a blocklisted destination is refused on create AND update;
     • a report with no workspace appears in the global admin queue (and is
       hidden from the workspace-scoped list it would otherwise leak into);
     • every moderation action writes an admin_audit_log row.

   Runs only when DATABASE_URL is set (mirrors the other integration suites).
   ============================================================ */

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

const nudgeStub = { nudge: () => {} } as unknown as ProjectionNudgeService;
const cacheBustStub = { bust: async () => {} } as unknown as LinkCacheBustService;
const safeBrowsingStub = {
  check: async () => ({ status: "clean" as const, checkedAt: new Date() }),
} as unknown as SafeBrowsingService;

describeDb("AdminModerationService (#971)", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;
  let moderation: AdminModerationService;
  let linksService: LinksService;
  let resolver: PostgresLinkResolver;

  let workspaceId: string;
  let domainId: string;
  let host: string;
  const stamp = Date.now();
  const admin: AdminIdentity = { id: "", name: "Platform Admin", email: `admin-${stamp}@snapurl.test` };
  const actor = () => toActor({ userId: adminUserId, label: admin.email });
  let adminUserId: string;

  beforeAll(async () => {
    handle = createDatabase({ url: DATABASE_URL!, max: 1 });
    db = handle.db;
    moderation = new AdminModerationService(db, db, nudgeStub, cacheBustStub);
    linksService = new LinksService(db, db, safeBrowsingStub, nudgeStub, cacheBustStub, openPlatformSettingsStub(), signupRefusalStub());
    resolver = new PostgresLinkResolver(db);

    const [u] = await db
      .insert(users)
      .values({ name: "Admin", email: admin.email, passwordHash: "x" })
      .returning({ id: users.id });
    adminUserId = u!.id;
    admin.id = u!.id;

    const [ws] = await db
      .insert(workspaces)
      .values({ name: "mod test", slug: `mod-${stamp}` })
      .returning({ id: workspaces.id });
    workspaceId = ws!.id;

    host = `mod-${stamp}.test`;
    const [dom] = await db
      // status 'live' so the redirect resolver will serve links on it.
      .insert(domains)
      .values({ workspaceId, domain: host, status: "live" })
      .returning({ id: domains.id });
    domainId = dom!.id;
  });

  afterAll(async () => {
    // Clean the blocklist rows this run added (keyed by the stamped hosts, so
    // a shared DB is left as we found it even though addedBy nulls on delete).
    await db.delete(blockedDomains).where(sql`${blockedDomains.domain} like ${`%${stamp}.example`}`);
    if (workspaceId) await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    if (adminUserId) await db.delete(users).where(eq(users.id, adminUserId));
    await handle?.close();
  });

  async function seedLink(slug: string, destination = `https://dest.example/${slug}`): Promise<string> {
    const [row] = await db
      .insert(links)
      .values({ workspaceId, domainId, slug, destination, safeBrowsingStatus: "clean" })
      .returning({ id: links.id });
    return row!.id;
  }

  async function auditRowsFor(targetId: string) {
    return db
      .select()
      .from(adminAuditLog)
      .where(eq(adminAuditLog.targetId, targetId))
      .orderBy(desc(adminAuditLog.at));
  }

  describe("disable / enable stops and restores the edge redirect", () => {
    it("a live link resolves and is not gated", async () => {
      const slug = `live-${stamp}`;
      await seedLink(slug);
      const resolved = await resolver.resolve(host, slug);
      expect(resolved).not.toBeNull();
      expect(resolved!.disabled).toBe(false);
      // The gate the redirect applies: a clean live link is not blocked.
      expect(effectiveGate(resolved!)).toBeNull();
    });

    it("disabling sets disabled_at, enqueues a projection upsert, gates the redirect, and audits", async () => {
      const slug = `disable-${stamp}`;
      const linkId = await seedLink(slug);

      await moderation.disableLink(linkId, { disabled: true, reason: "abuse" }, admin, "203.0.113.9");

      // disabled_at is set.
      const [after] = await db.select({ disabledAt: links.disabledAt }).from(links).where(eq(links.id, linkId));
      expect(after!.disabledAt).not.toBeNull();

      // The redirect, reading its own resolver, now gets a disabled link whose
      // gate is "disabled" — i.e. it stops redirecting at the edge.
      const resolved = await resolver.resolve(host, slug);
      expect(resolved!.disabled).toBe(true);
      expect(effectiveGate(resolved!)).toBe("disabled");

      // A projection upsert row was enqueued IN the same change, carrying the
      // disable to the edge within the projection window.
      const outbox = await db
        .select()
        .from(projectionOutbox)
        .where(and(eq(projectionOutbox.linkId, linkId), eq(projectionOutbox.operation, "upsert")));
      expect(outbox.length).toBeGreaterThanOrEqual(1);

      // An admin audit row was written for the disable.
      const audits = await auditRowsFor(linkId);
      expect(audits.some((a) => a.action === "admin.link.disable")).toBe(true);
      expect(audits[0]!.actorLabel).toBe(admin.email);
      expect(audits[0]!.requestIp).toBe("203.0.113.9");
    });

    it("re-enabling clears disabled_at and the gate opens again", async () => {
      const slug = `reenable-${stamp}`;
      const linkId = await seedLink(slug);

      await moderation.disableLink(linkId, { disabled: true }, admin, null);
      expect(effectiveGate((await resolver.resolve(host, slug))!)).toBe("disabled");

      await moderation.disableLink(linkId, { disabled: false }, admin, null);
      const [after] = await db.select({ disabledAt: links.disabledAt }).from(links).where(eq(links.id, linkId));
      expect(after!.disabledAt).toBeNull();
      expect(effectiveGate((await resolver.resolve(host, slug))!)).toBeNull();

      // Both a disable and an enable audit row exist for this link.
      const audits = await auditRowsFor(linkId);
      expect(audits.some((a) => a.action === "admin.link.disable")).toBe(true);
      expect(audits.some((a) => a.action === "admin.link.enable")).toBe(true);
    });

    it("404s a link that does not exist", async () => {
      await expect(
        moderation.disableLink("00000000-0000-0000-0000-000000000000", { disabled: true }, admin, null),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe("destination blocklist refused on create and update", () => {
    const blockedHost = `blocked-${stamp}.example`;

    it("refuses a create whose destination is a blocked host, and a sub-domain of it", async () => {
      await moderation.addBlockedDomain({ domain: blockedHost, reason: "phishing" }, admin, null);

      await expect(
        linksService.create(workspaceId, actor(), {
          destination: `https://${blockedHost}/landing`,
          domain: host,
          rules: [],
          forwardQuery: true,
          deepLink: false,
          hideReferrer: false,
          publicPreview: true,
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);

      // A sub-domain of the blocked host is refused too.
      await expect(
        linksService.create(workspaceId, actor(), {
          destination: `https://login.${blockedHost}/`,
          domain: host,
          rules: [],
          forwardQuery: true,
          deepLink: false,
          hideReferrer: false,
          publicPreview: true,
        } as any),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("allows a create whose destination is NOT blocked (a lookalike is not a sub-domain)", async () => {
      const created = await linksService.create(workspaceId, actor(), {
        destination: "https://notblocked.example/ok",
        domain: host,
        rules: [],
        forwardQuery: true,
        deepLink: false,
        hideReferrer: false,
        publicPreview: true,
      } as any);
      expect(created.destination).toBe("https://notblocked.example/ok");
    });

    it("refuses an UPDATE that points an existing link at a blocked host", async () => {
      const created = await linksService.create(workspaceId, actor(), {
        destination: "https://fine.example/start",
        domain: host,
        rules: [],
        forwardQuery: true,
        deepLink: false,
        hideReferrer: false,
        publicPreview: true,
      } as any);

      await expect(
        linksService.update(workspaceId, created.id, actor(), { destination: `https://${blockedHost}/evil` } as any),
      ).rejects.toBeInstanceOf(BadRequestException);

      // An update that does NOT touch the destination is unaffected by the block.
      const retitled = await linksService.update(workspaceId, created.id, actor(), { comment: "still fine" } as any);
      expect(retitled.comment).toBe("still fine");
    });

    it("rejects adding the same blocked host twice", async () => {
      await moderation.addBlockedDomain({ domain: `dup-${stamp}.example` }, admin, null);
      await expect(
        moderation.addBlockedDomain({ domain: `dup-${stamp}.example` }, admin, null),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it("writes an admin audit row for add and remove", async () => {
      const added = await moderation.addBlockedDomain({ domain: `audit-${stamp}.example` }, admin, "198.51.100.7");
      const addAudits = await auditRowsFor(added.id);
      expect(addAudits.some((a) => a.action === "admin.blocked_domain.add")).toBe(true);

      await moderation.removeBlockedDomain(added.id, admin, null);
      const all = await auditRowsFor(added.id);
      expect(all.some((a) => a.action === "admin.blocked_domain.remove")).toBe(true);
    });
  });

  describe("global abuse queue surfaces no-workspace reports", () => {
    it("includes a report whose slug resolved to no workspace, which the workspace queue hides", async () => {
      // A report with a null workspaceId — the kind reports.service.list never
      // shows an operator.
      const { abuseReports } = await import("@snapurl/database");
      const orphanSlug = `orphan-${stamp}`;
      await db.insert(abuseReports).values({ slug: orphanSlug, reason: "phishing", status: "open", workspaceId: null, linkId: null });

      const page = await moderation.abuseQueue({ limit: 200, offset: 0 } as any);
      const orphan = page.rows.find((r) => r.slug === orphanSlug);
      expect(orphan).toBeDefined();
      expect(orphan!.workspaceId).toBeNull();
      expect(orphan!.linkDisabled).toBe(false);

      // And the orphaned=true filter returns it specifically.
      const orphaned = await moderation.abuseQueue({ orphaned: true, limit: 200, offset: 0 } as any);
      expect(orphaned.rows.some((r) => r.slug === orphanSlug)).toBe(true);
      expect(orphaned.rows.every((r) => r.workspaceId === null)).toBe(true);
    });

    it("acting on a report disables its link and writes both a report and a link audit row", async () => {
      const slug = `reported-${stamp}`;
      const linkId = await seedLink(slug);
      const { abuseReports } = await import("@snapurl/database");
      const [report] = await db
        .insert(abuseReports)
        .values({ slug, reason: "phishing", status: "open", workspaceId, linkId })
        .returning({ id: abuseReports.id });

      await moderation.actOnReport(report!.id, { status: "actioned", disableLink: true }, admin, null);

      const [link] = await db.select({ disabledAt: links.disabledAt }).from(links).where(eq(links.id, linkId));
      expect(link!.disabledAt).not.toBeNull();

      const [row] = await db.select({ status: abuseReports.status }).from(abuseReports).where(eq(abuseReports.id, report!.id));
      expect(row!.status).toBe("actioned");

      const linkAudits = await auditRowsFor(linkId);
      expect(linkAudits.some((a) => a.action === "admin.link.disable")).toBe(true);
      const reportAudits = await auditRowsFor(report!.id);
      expect(reportAudits.some((a) => a.action === "admin.abuse_report.review")).toBe(true);
    });
  });
});

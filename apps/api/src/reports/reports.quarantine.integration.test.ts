import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  abuseReports,
  adminAuditLog,
  createDatabase,
  domains,
  eq,
  links,
  memberships,
  projectionOutbox,
  users,
  workspaces,
  type Database,
} from "@snapurl/database";
import { ReportsService } from "./reports.service.js";
import type { LinkCacheBustService } from "../common/link-cache-bust.service.js";
import type { ProjectionNudgeService } from "../links/projection-nudge.service.js";
import type { MailService } from "../mail/mail.service.js";
import type { Env } from "../config/env.js";

/* ============================================================
   #994 point 3 — auto-quarantine on abuse reports, against a real Postgres.

   The whole behaviour is relational: a link is disabled only once it has N
   DISTINCT non-dismissed reports, the disable writes a links row + a projection
   outbox row + a platform-audit row in one transaction, and the owner is
   notified. A mock cannot prove the count rule or the transactional write, so
   this runs against the shared DB and asserts on the rows it seeded.

   Runs only when DATABASE_URL is set.
   ============================================================ */

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

const envWith = (threshold: number) => ({ ABUSE_QUARANTINE_THRESHOLD: threshold }) as unknown as Env;

describeDb("ReportsService auto-quarantine (#994)", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;
  let cacheBust: { bust: ReturnType<typeof vi.fn> };
  let nudge: { nudge: ReturnType<typeof vi.fn> };
  let mail: { sendLinkQuarantined: ReturnType<typeof vi.fn> };
  let workspaceId: string;
  let domainHost: string;
  let ownerEmail: string;

  const stamp = Date.now();

  const makeService = (threshold: number) =>
    new ReportsService(
      db,
      envWith(threshold),
      cacheBust as unknown as LinkCacheBustService,
      nudge as unknown as ProjectionNudgeService,
      mail as unknown as MailService,
    );

  /** A fresh link with its own slug, so each test is independent. */
  async function makeLink(slug: string): Promise<string> {
    const [dom] = await db.select({ id: domains.id }).from(domains).where(eq(domains.domain, domainHost));
    const [link] = await db
      .insert(links)
      .values({ workspaceId, domainId: dom!.id, slug, destination: `https://phish.example/${slug}` })
      .returning({ id: links.id });
    return link!.id;
  }

  const disabledAt = async (linkId: string) =>
    (await db.select({ disabledAt: links.disabledAt }).from(links).where(eq(links.id, linkId)))[0]!.disabledAt;

  const auditRowsFor = async (linkId: string) =>
    db
      .select({ action: adminAuditLog.action, actorLabel: adminAuditLog.actorLabel, after: adminAuditLog.after })
      .from(adminAuditLog)
      .where(eq(adminAuditLog.targetId, linkId));

  const outboxRowsFor = async (linkId: string) =>
    db.select({ operation: projectionOutbox.operation }).from(projectionOutbox).where(eq(projectionOutbox.linkId, linkId));

  beforeAll(async () => {
    handle = createDatabase({ url: DATABASE_URL!, max: 1 });
    db = handle.db;
    cacheBust = { bust: vi.fn(async () => {}) };
    nudge = { nudge: vi.fn() };
    mail = { sendLinkQuarantined: vi.fn(async () => {}) };

    const [ws] = await db
      .insert(workspaces)
      .values({ name: "quarantine test", slug: `quar-${stamp}` })
      .returning({ id: workspaces.id });
    workspaceId = ws!.id;

    domainHost = `quar-${stamp}.test`;
    await db.insert(domains).values({ workspaceId, domain: domainHost, status: "live", verifiedAt: new Date() });

    // An owner membership so notifyOwner has a recipient.
    ownerEmail = `owner-${stamp}@example.com`;
    const [u] = await db
      .insert(users)
      .values({ name: "Owner", email: ownerEmail })
      .returning({ id: users.id });
    await db
      .insert(memberships)
      .values({ workspaceId, userId: u!.id, email: ownerEmail, role: "owner", status: "active" });
  });

  afterAll(async () => {
    if (workspaceId) await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await handle?.close();
  });

  it("disables the link, audits, projects and notifies once the threshold is reached", async () => {
    const service = makeService(3);
    const slug = `reach-${stamp}`;
    const linkId = await makeLink(slug);
    mail.sendLinkQuarantined.mockClear();

    // Two distinct reporters — still below threshold 3.
    await service.submitReport(slug, { reason: "phishing", reporterContact: "a@example.com" }, domainHost);
    await service.submitReport(slug, { reason: "phishing", reporterContact: "b@example.com" }, domainHost);
    expect(await disabledAt(linkId)).toBeNull();
    expect(mail.sendLinkQuarantined).not.toHaveBeenCalled();

    // The third distinct reporter crosses it.
    await service.submitReport(slug, { reason: "phishing", reporterContact: "c@example.com" }, domainHost);

    expect(await disabledAt(linkId)).not.toBeNull();

    const audit = await auditRowsFor(linkId);
    expect(audit).toHaveLength(1);
    expect(audit[0]!.action).toBe("admin.link.disable");
    expect(audit[0]!.actorLabel).toBe("system:auto-quarantine");
    expect(audit[0]!.after).toMatchObject({ disabled: true, reason: "auto-quarantine", threshold: 3 });

    const outbox = await outboxRowsFor(linkId);
    expect(outbox.some((r) => r.operation === "upsert")).toBe(true);

    expect(mail.sendLinkQuarantined).toHaveBeenCalledTimes(1);
    expect(mail.sendLinkQuarantined).toHaveBeenCalledWith(
      expect.objectContaining({ to: ownerEmail, shortUrl: `${domainHost}/${slug}` }),
    );
  });

  it("does not over-count repeat reports from the same contact", async () => {
    const service = makeService(3);
    const slug = `repeat-${stamp}`;
    const linkId = await makeLink(slug);

    // The SAME contact three times collapses to one distinct reporter.
    for (let i = 0; i < 3; i++) {
      await service.submitReport(slug, { reason: "spam", reporterContact: "spammer@example.com" }, domainHost);
    }
    expect(await disabledAt(linkId)).toBeNull();
  });

  it("does not count dismissed reports toward the threshold", async () => {
    const service = makeService(3);
    const slug = `dismissed-${stamp}`;
    const linkId = await makeLink(slug);

    await service.submitReport(slug, { reason: "x", reporterContact: "d1@example.com" }, domainHost);
    await service.submitReport(slug, { reason: "x", reporterContact: "d2@example.com" }, domainHost);
    // An operator dismissed those two — mark them dismissed directly.
    await db.update(abuseReports).set({ status: "dismissed" }).where(eq(abuseReports.linkId, linkId));
    // A third fresh report: only 1 non-dismissed now, well below 3.
    await service.submitReport(slug, { reason: "x", reporterContact: "d3@example.com" }, domainHost);

    expect(await disabledAt(linkId)).toBeNull();
  });

  it("is a no-op when the link is already disabled: no second audit or notification", async () => {
    const service = makeService(1); // threshold 1 so one report would normally disable
    const slug = `already-${stamp}`;
    const linkId = await makeLink(slug);
    // Pre-disable it (as an admin would).
    await db.update(links).set({ disabledAt: new Date() }).where(eq(links.id, linkId));
    mail.sendLinkQuarantined.mockClear();

    await service.submitReport(slug, { reason: "x", reporterContact: "e@example.com" }, domainHost);

    // Still disabled, but no auto-quarantine audit row was written for it.
    expect(await disabledAt(linkId)).not.toBeNull();
    const audit = await auditRowsFor(linkId);
    expect(audit).toHaveLength(0);
    expect(mail.sendLinkQuarantined).not.toHaveBeenCalled();
  });

  it("is off when the threshold is 0", async () => {
    const service = makeService(0);
    const slug = `off-${stamp}`;
    const linkId = await makeLink(slug);

    for (const c of ["z1", "z2", "z3", "z4"]) {
      await service.submitReport(slug, { reason: "x", reporterContact: `${c}@example.com` }, domainHost);
    }
    expect(await disabledAt(linkId)).toBeNull();
  });

  it("the public response is still { ok: true } even when a report triggers a disable", async () => {
    const service = makeService(1);
    const slug = `oracle-${stamp}`;
    await makeLink(slug);
    const res = await service.submitReport(slug, { reason: "x", reporterContact: "f@example.com" }, domainHost);
    expect(res).toEqual({ ok: true });
  });
});

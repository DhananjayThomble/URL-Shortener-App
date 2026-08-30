import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { abuseReports, createDatabase, domains, eq, links, workspaces, type Database } from "@snapurl/database";
import { ReportsService } from "./reports.service.js";

/* ============================================================
   ReportsService.submitReport against a real Postgres (#291).

   The invariants that only a real DB can prove: a report resolves the slug to
   its link and workspace when it can, stores null when it cannot, and answers
   identically either way so the endpoint is not an enumeration oracle.

   Runs only when DATABASE_URL is set — see the note in rollup.test.ts.
   ============================================================ */

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

describeDb("ReportsService.submitReport", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;
  let service: ReportsService;
  let workspaceId: string;
  let linkId: string;

  const stamp = Date.now();
  const slug = `r${stamp}-real`;

  beforeAll(async () => {
    handle = createDatabase({ url: DATABASE_URL!, max: 1 });
    db = handle.db;
    service = new ReportsService(db);

    const [ws] = await db
      .insert(workspaces)
      .values({ name: "reports test", slug: `reports-${stamp}` })
      .returning({ id: workspaces.id });
    workspaceId = ws!.id;

    const [dom] = await db
      .insert(domains)
      .values({ workspaceId, domain: `reports-${stamp}.test` })
      .returning({ id: domains.id });

    const [link] = await db
      .insert(links)
      .values({ workspaceId, domainId: dom!.id, slug, destination: "https://example.com/phish" })
      .returning({ id: links.id });
    linkId = link!.id;
  });

  afterAll(async () => {
    if (workspaceId) await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    // The report for the non-existent slug has no workspace to cascade from.
    await db.delete(abuseReports).where(eq(abuseReports.slug, `${slug}-missing`));
    await handle?.close();
  });

  it("resolves the link and workspace for an existing slug", async () => {
    const result = await service.submitReport(slug, { reason: "This is a phishing page." });
    expect(result).toEqual({ ok: true });

    const [row] = await db.select().from(abuseReports).where(eq(abuseReports.linkId, linkId)).limit(1);
    expect(row).toBeDefined();
    expect(row!.slug).toBe(slug);
    expect(row!.status).toBe("open");
    expect(row!.linkId).toBe(linkId);
    expect(row!.workspaceId).toBe(workspaceId);
  });

  it("returns ok:true and stores null link/workspace for a non-existent slug (no enumeration)", async () => {
    const missing = `${slug}-missing`;
    const result = await service.submitReport(missing, { reason: "Reporting a link that isn't here." });
    expect(result).toEqual({ ok: true });

    const [row] = await db.select().from(abuseReports).where(eq(abuseReports.slug, missing)).limit(1);
    expect(row).toBeDefined();
    expect(row!.linkId).toBeNull();
    expect(row!.workspaceId).toBeNull();
  });

  it("stores null when reporterContact is empty or omitted", async () => {
    await service.submitReport(slug, { reason: "No contact given.", reporterContact: "" });
    const rows = await db.select().from(abuseReports).where(eq(abuseReports.linkId, linkId));
    const withoutContact = rows.find((r) => r.reason === "No contact given.");
    expect(withoutContact).toBeDefined();
    expect(withoutContact!.reporterContact).toBeNull();
  });
});

/* ============================================================
   ReportsService.list / review — operator side (#291, FEAT-003).

   These prove the invariants only a real DB can: the operator sees only their
   own workspace's reports (never another workspace's, never a null-workspace
   one), flagging a link writes the exact 'flagged' value the redirect gate
   reads, a status-only update leaves the link untouched, and a report in
   another workspace is NotFound. Test (2) is the one that must fail if the flag
   write were reverted.
   ============================================================ */
import { NotFoundException } from "@nestjs/common";
import { toActor } from "../common/activity.js";

const reviewer = toActor({ userId: null, label: "operator@test", workspaceId: "", role: "editor", email: "" });

describeDb("ReportsService.list / review", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;
  let service: ReportsService;

  const stamp = Date.now();
  let wsA: string;
  let wsB: string;
  let linkA: string;
  let reportOnLinkA: string;
  let reportOnLinkA2: string;
  let reportInWsB: string;
  let reportNullWorkspace: string;

  beforeAll(async () => {
    handle = createDatabase({ url: DATABASE_URL!, max: 1 });
    db = handle.db;
    service = new ReportsService(db);

    // Two independent workspaces, each with a domain and a link.
    const [a] = await db
      .insert(workspaces)
      .values({ name: "ws A", slug: `rev-a-${stamp}` })
      .returning({ id: workspaces.id });
    wsA = a!.id;
    const [b] = await db
      .insert(workspaces)
      .values({ name: "ws B", slug: `rev-b-${stamp}` })
      .returning({ id: workspaces.id });
    wsB = b!.id;

    const [domA] = await db
      .insert(domains)
      .values({ workspaceId: wsA, domain: `rev-a-${stamp}.test` })
      .returning({ id: domains.id });
    const [domB] = await db
      .insert(domains)
      .values({ workspaceId: wsB, domain: `rev-b-${stamp}.test` })
      .returning({ id: domains.id });

    const [lA] = await db
      .insert(links)
      .values({ workspaceId: wsA, domainId: domA!.id, slug: `rev-a-${stamp}`, destination: "https://example.com/a" })
      .returning({ id: links.id });
    linkA = lA!.id;
    const [lB] = await db
      .insert(links)
      .values({ workspaceId: wsB, domainId: domB!.id, slug: `rev-b-${stamp}`, destination: "https://example.com/b" })
      .returning({ id: links.id });

    // Two reports for workspace A's link, one for B's link, one that never
    // resolved (null workspace).
    const [r1] = await db
      .insert(abuseReports)
      .values({ slug: `rev-a-${stamp}`, linkId: linkA, workspaceId: wsA, reason: "phishing on A", status: "open" })
      .returning({ id: abuseReports.id });
    reportOnLinkA = r1!.id;
    const [r2] = await db
      .insert(abuseReports)
      .values({ slug: `rev-a-${stamp}`, linkId: linkA, workspaceId: wsA, reason: "malware on A", status: "open" })
      .returning({ id: abuseReports.id });
    reportOnLinkA2 = r2!.id;
    const [r3] = await db
      .insert(abuseReports)
      .values({ slug: `rev-b-${stamp}`, linkId: lB!.id, workspaceId: wsB, reason: "phishing on B", status: "open" })
      .returning({ id: abuseReports.id });
    reportInWsB = r3!.id;
    const [r4] = await db
      .insert(abuseReports)
      .values({ slug: `rev-nowhere-${stamp}`, linkId: null, workspaceId: null, reason: "unresolved", status: "open" })
      .returning({ id: abuseReports.id });
    reportNullWorkspace = r4!.id;
  });

  afterAll(async () => {
    if (wsA) await db.delete(workspaces).where(eq(workspaces.id, wsA));
    if (wsB) await db.delete(workspaces).where(eq(workspaces.id, wsB));
    await db.delete(abuseReports).where(eq(abuseReports.id, reportNullWorkspace));
    await handle?.close();
  });

  it("lists only the caller workspace's reports — not another workspace's, not null-workspace ones", async () => {
    const list = await service.list(wsA);
    const ids = list.map((r) => r.id);
    expect(ids).toContain(reportOnLinkA);
    expect(ids).toContain(reportOnLinkA2);
    expect(ids).not.toContain(reportInWsB);
    expect(ids).not.toContain(reportNullWorkspace);
    // Every returned report genuinely belongs to A.
    expect(list.every((r) => ids.includes(r.id))).toBe(true);
    expect(list.length).toBe(2);
  });

  it("flags the resolved link and marks the report 'actioned' when flagLink is true", async () => {
    const dto = await service.review(wsA, reportOnLinkA, reviewer, { flagLink: true });
    expect(dto.status).toBe("actioned");

    // The enforcement invariant: this is the exact value gateFor blocks on. If
    // the flag write in review() were reverted, this assertion fails.
    const [row] = await db
      .select({ status: links.safeBrowsingStatus, checkedAt: links.safeBrowsingCheckedAt })
      .from(links)
      .where(eq(links.id, linkA))
      .limit(1);
    expect(row!.status).toBe("flagged");
    expect(row!.checkedAt).not.toBeNull();
  });

  it("updates status without touching safeBrowsingStatus for a status-only review", async () => {
    // A second, still-pending link report in workspace A.
    const before = await db
      .select({ status: links.safeBrowsingStatus })
      .from(links)
      .where(eq(links.id, linkA))
      .limit(1);

    const dto = await service.review(wsA, reportOnLinkA2, reviewer, { status: "dismissed" });
    expect(dto.status).toBe("dismissed");

    const after = await db
      .select({ status: links.safeBrowsingStatus })
      .from(links)
      .where(eq(links.id, linkA))
      .limit(1);
    // Whatever the link's status was, a status-only review does not change it.
    expect(after[0]!.status).toBe(before[0]!.status);
  });

  it("throws NotFound for a report outside the caller's workspace", async () => {
    await expect(service.review(wsA, reportInWsB, reviewer, { status: "dismissed" })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

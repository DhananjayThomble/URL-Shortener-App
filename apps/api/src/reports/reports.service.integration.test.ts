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

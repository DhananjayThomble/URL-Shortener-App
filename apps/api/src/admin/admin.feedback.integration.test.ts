import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { adminAuditLog, and, createDatabase, desc, eq, feedback, users, workspaces, type Database } from "@snapurl/database";
import { AdminFeedbackService } from "./admin.feedback.service.js";
import type { AdminIdentity } from "./admin.service.js";

/* ============================================================
   #997 — the "Report a problem" admin inbox against a real Postgres.

   Oracles are the issue's acceptance lines:
     - "Admin inbox list and status changes, admin-only and audited (tests)" —
       the list returns reports newest-first with a status filter; a status/notes
       change updates the row AND writes exactly one admin_audit_log row with the
       right action/target and a correct before/after; the detail view returns the
       screenshot the list omits.

   Admin-only is enforced by AdminGuard on the controller (covered by the
   access-matrix suite, which records every /admin/feedback route as 403 for
   every non-admin principal); this service suite proves the behaviour BEHIND the
   guard — the list/detail/update logic and its audit trail.

   Red-on-broken: drop the writeAdminAuditEntry call from update() and the audit
   assertion finds zero rows; return the screenshot from list() and the
   "list omits the blob" assertion fails.

   DB-gated: skips with no DATABASE_URL. afterAll closes the pool and deletes
   every seeded row.
   ============================================================ */

const DATABASE_URL = process.env.DATABASE_URL;
const describeDb = DATABASE_URL ? describe : describe.skip;

const PNG_PX =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describeDb("AdminFeedbackService", () => {
  let handle: ReturnType<typeof createDatabase>;
  let db: Database;
  let service: AdminFeedbackService;
  let admin: AdminIdentity;
  let workspaceId: string;
  let adminUserId: string;
  const stamp = Date.now();
  const ids: string[] = [];

  beforeAll(async () => {
    handle = createDatabase({ url: DATABASE_URL!, max: 1 });
    db = handle.db;
    // DB and READ_DB point at the same handle in the test — the service only
    // reads on readDb and writes on db, and a single pool serves both.
    service = new AdminFeedbackService(db, db);

    const [ws] = await db
      .insert(workspaces)
      .values({ name: "admin fb test", slug: `admin-fb-${stamp}` })
      .returning({ id: workspaces.id });
    workspaceId = ws!.id;
    const [u] = await db
      .insert(users)
      .values({ email: `admin-fb-${stamp}@example.com`, name: "Admin" })
      .returning({ id: users.id });
    adminUserId = u!.id;
    admin = { id: adminUserId, name: "Admin", email: `admin-fb-${stamp}@example.com` } as AdminIdentity;

    // Seed three reports: two "new" (one with a screenshot + workspace), one "done".
    const [a] = await db
      .insert(feedback)
      .values({ message: "first new", page: "/a", workspaceId, status: "new" })
      .returning({ id: feedback.id });
    const [b] = await db
      .insert(feedback)
      .values({ message: "second new with shot", page: "/b", screenshot: PNG_PX, status: "new" })
      .returning({ id: feedback.id });
    const [c] = await db
      .insert(feedback)
      .values({ message: "already done", page: "/c", status: "done" })
      .returning({ id: feedback.id });
    ids.push(a!.id, b!.id, c!.id);
  });

  afterAll(async () => {
    for (const id of ids) await db.delete(feedback).where(eq(feedback.id, id));
    if (adminUserId) {
      await db.delete(adminAuditLog).where(eq(adminAuditLog.actorId, adminUserId));
      await db.delete(users).where(eq(users.id, adminUserId));
    }
    if (workspaceId) await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await handle?.close();
  });

  it("lists reports newest-first and omits the screenshot blob (hasScreenshot only)", async () => {
    const page = await service.list({ limit: 50, offset: 0 });
    const mine = page.rows.filter((r) => ids.includes(r.id));
    expect(mine.length).toBe(3);
    // Newest-first: the three were inserted a,b,c, so c (done) is newest.
    const order = page.rows.filter((r) => ids.includes(r.id)).map((r) => r.id);
    expect(order[0]).toBe(ids[2]);
    expect(order[2]).toBe(ids[0]);
    // The row carries hasScreenshot but never the blob itself.
    const withShot = mine.find((r) => r.id === ids[1])!;
    expect(withShot.hasScreenshot).toBe(true);
    expect((withShot as Record<string, unknown>).screenshot).toBeUndefined();
    const noShot = mine.find((r) => r.id === ids[0])!;
    expect(noShot.hasScreenshot).toBe(false);
    // The workspace name is resolved by the left join when present.
    expect(withShot.workspaceName).toBeNull();
    expect(noShot.workspaceName).toBe("admin fb test");
  });

  it("filters the list by status", async () => {
    const done = await service.list({ status: "done", limit: 50, offset: 0 });
    const mineDone = done.rows.filter((r) => ids.includes(r.id));
    expect(mineDone.map((r) => r.id)).toEqual([ids[2]]);

    const news = await service.list({ status: "new", limit: 50, offset: 0 });
    const mineNew = news.rows.filter((r) => ids.includes(r.id)).map((r) => r.id).sort();
    expect(mineNew).toEqual([ids[0], ids[1]].sort());
  });

  it("paginates with hasMore", async () => {
    const first = await service.list({ limit: 1, offset: 0 });
    expect(first.rows.length).toBe(1);
    expect(first.hasMore).toBe(true);
  });

  it("returns a single report in full, including its screenshot", async () => {
    const detail = await service.get(ids[1]!);
    expect(detail.id).toBe(ids[1]);
    expect(detail.screenshot).toBe(PNG_PX);
    expect(detail.hasScreenshot).toBe(true);
    const noShot = await service.get(ids[0]!);
    expect(noShot.screenshot).toBeNull();
  });

  it("404s a report that does not exist", async () => {
    await expect(service.get("00000000-0000-0000-0000-000000000000")).rejects.toBeInstanceOf(NotFoundException);
  });

  it("updates status + notes and writes exactly one audit row with correct before/after", async () => {
    const detail = await service.update(ids[0]!, { status: "in_progress", notes: "triaging" }, admin, "203.0.113.9");
    expect(detail.status).toBe("in_progress");
    expect(detail.notes).toBe("triaging");

    const [row] = await db.select().from(feedback).where(eq(feedback.id, ids[0]!)).limit(1);
    expect(row!.status).toBe("in_progress");
    expect(row!.notes).toBe("triaging");

    const audits = await db
      .select()
      .from(adminAuditLog)
      .where(and(eq(adminAuditLog.actorId, adminUserId), eq(adminAuditLog.targetId, ids[0]!)))
      .orderBy(desc(adminAuditLog.at));
    expect(audits.length).toBe(1);
    expect(audits[0]!.action).toBe("admin.feedback.update");
    expect(audits[0]!.targetType).toBe("feedback");
    expect(audits[0]!.actorLabel).toBe(admin.email);
    expect(audits[0]!.requestIp).toBe("203.0.113.9");
    expect((audits[0]!.before as { status: string }).status).toBe("new");
    expect((audits[0]!.after as { status: string }).status).toBe("in_progress");
    expect((audits[0]!.after as { notes: string }).notes).toBe("triaging");
  });

  it("rejects an empty update (neither status nor notes)", async () => {
    await expect(service.update(ids[1]!, {} as never, admin, null)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("404s an update to a non-existent report and writes no audit row", async () => {
    const before = await db.select().from(adminAuditLog).where(eq(adminAuditLog.actorId, adminUserId));
    await expect(
      service.update("00000000-0000-0000-0000-000000000000", { status: "done" }, admin, null),
    ).rejects.toBeInstanceOf(NotFoundException);
    const after = await db.select().from(adminAuditLog).where(eq(adminAuditLog.actorId, adminUserId));
    expect(after.length).toBe(before.length);
  });
});

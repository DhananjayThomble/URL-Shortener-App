import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import {
  and,
  desc,
  eq,
  feedback,
  sql,
  workspaces,
  writeAdminAuditEntry,
  type Database,
} from "@snapurl/database";
import type {
  FeedbackDetail,
  FeedbackListQuery,
  FeedbackPage,
  FeedbackRow,
  UpdateFeedbackInput,
} from "@snapurl/contract";
import { DB, READ_DB } from "../database/database.module.js";
import type { AdminIdentity } from "./admin.service.js";

/* ============================================================
   #997 — the "Report a problem" admin inbox.

   The platform-admin side of in-app feedback. Reads (the inbox list, one
   report's detail including its screenshot) run on the read handle — pure
   reporting, no write follows. The one WRITE (moving a report's status and/or
   setting operator notes) runs on the primary inside a transaction that records
   its own admin-audit row via writeAdminAuditEntry, so the change and its audit
   trail commit together — the same shape every other #971 moderation action
   uses. Mounted behind AdminGuard on AdminController, so reaching any of these
   already means the caller is a confirmed platform admin.

   The list deliberately omits the screenshot blob (it would make the response
   enormous) and reports only whether one is attached; the detail route ships
   the data URL.
   ============================================================ */

type FeedbackStatus = FeedbackRow["status"];

@Injectable()
export class AdminFeedbackService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(READ_DB) private readonly readDb: Database,
  ) {}

  /** The feedback inbox, newest first, optionally filtered by status. */
  async list(q: FeedbackListQuery): Promise<FeedbackPage> {
    const rows = await this.readDb
      .select({
        id: feedback.id,
        message: feedback.message,
        page: feedback.page,
        userAgent: feedback.userAgent,
        appVersion: feedback.appVersion,
        errorEventId: feedback.errorEventId,
        screenshot: feedback.screenshot,
        userId: feedback.userId,
        workspaceId: feedback.workspaceId,
        workspaceName: workspaces.name,
        reporterEmail: feedback.reporterEmail,
        status: feedback.status,
        notes: feedback.notes,
        createdAt: feedback.createdAt,
        updatedAt: feedback.updatedAt,
      })
      .from(feedback)
      .leftJoin(workspaces, eq(feedback.workspaceId, workspaces.id))
      .where(q.status ? eq(feedback.status, q.status) : undefined)
      .orderBy(desc(feedback.createdAt))
      .limit(q.limit + 1)
      .offset(q.offset);

    const hasMore = rows.length > q.limit;
    const page = hasMore ? rows.slice(0, q.limit) : rows;
    return {
      hasMore,
      rows: page.map((r) => this.toRow(r)),
    };
  }

  /** One report in full, including its screenshot data URL (null when none). */
  async get(id: string): Promise<FeedbackDetail> {
    const [r] = await this.readDb
      .select({
        id: feedback.id,
        message: feedback.message,
        page: feedback.page,
        userAgent: feedback.userAgent,
        appVersion: feedback.appVersion,
        errorEventId: feedback.errorEventId,
        screenshot: feedback.screenshot,
        userId: feedback.userId,
        workspaceId: feedback.workspaceId,
        workspaceName: workspaces.name,
        reporterEmail: feedback.reporterEmail,
        status: feedback.status,
        notes: feedback.notes,
        createdAt: feedback.createdAt,
        updatedAt: feedback.updatedAt,
      })
      .from(feedback)
      .leftJoin(workspaces, eq(feedback.workspaceId, workspaces.id))
      .where(eq(feedback.id, id))
      .limit(1);
    if (!r) throw new NotFoundException("That report doesn't exist.");
    return { ...this.toRow(r), screenshot: r.screenshot ?? null };
  }

  /**
   * Move a report's status and/or set its notes, in a single audited
   * transaction. A request with neither is refused (the contract's refine makes
   * that a 400 at the edge, and this is the belt-and-braces service guard).
   */
  async update(id: string, input: UpdateFeedbackInput, admin: AdminIdentity, requestIp: string | null): Promise<FeedbackDetail> {
    if (input.status === undefined && input.notes === undefined) {
      throw new BadRequestException("Nothing to update: pass a status, notes, or both.");
    }

    await this.db.transaction(async (tx) => {
      const [before] = await tx
        .select({ status: feedback.status, notes: feedback.notes })
        .from(feedback)
        .where(eq(feedback.id, id))
        .limit(1);
      if (!before) throw new NotFoundException("That report doesn't exist.");

      const set: { status?: string; notes?: string; updatedAt: Date } = { updatedAt: new Date() };
      if (input.status !== undefined) set.status = input.status;
      if (input.notes !== undefined) set.notes = input.notes;

      await tx.update(feedback).set(set).where(eq(feedback.id, id));

      await writeAdminAuditEntry(tx, {
        actorId: admin.id,
        actorLabel: admin.email,
        action: "admin.feedback.update",
        targetType: "feedback",
        targetId: id,
        before: { status: before.status, notes: before.notes },
        after: {
          status: input.status ?? before.status,
          notes: input.notes ?? before.notes,
        },
        requestIp,
      });
    });

    return this.get(id);
  }

  private toRow(r: {
    id: string;
    message: string;
    page: string | null;
    userAgent: string | null;
    appVersion: string | null;
    errorEventId: string | null;
    screenshot: string | null;
    userId: string | null;
    workspaceId: string | null;
    workspaceName: string | null;
    reporterEmail: string | null;
    status: string;
    notes: string | null;
    createdAt: Date;
    updatedAt: Date;
  }): FeedbackRow {
    return {
      id: r.id,
      message: r.message,
      page: r.page,
      userAgent: r.userAgent,
      appVersion: r.appVersion,
      errorEventId: r.errorEventId,
      hasScreenshot: r.screenshot != null && r.screenshot.length > 0,
      userId: r.userId,
      workspaceId: r.workspaceId,
      workspaceName: r.workspaceName ?? null,
      reporterEmail: r.reporterEmail,
      status: r.status as FeedbackStatus,
      notes: r.notes,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }
}

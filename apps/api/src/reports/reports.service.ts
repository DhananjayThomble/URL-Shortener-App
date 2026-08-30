import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { abuseReports, and, desc, eq, links, sql, type Database } from "@snapurl/database";
import type { AbuseReport, SubmitReportInput, SubmitReportResult, UpdateAbuseReportInput } from "@snapurl/contract";
import { DB } from "../database/database.module.js";
import { recordActivity, type Actor } from "../common/activity.js";

type AbuseReportRow = typeof abuseReports.$inferSelect;

@Injectable()
export class ReportsService {
  constructor(@Inject(DB) private readonly db: Database) {}
  private readonly logger = new Logger(ReportsService.name);

  /**
   * Public, unauthenticated intake for abuse reports (#291).
   *
   * The response is { ok: true } UNCONDITIONALLY — it never throws NotFound and
   * never varies by whether the slug resolves. A victim reporting a phishing
   * link should not be told "that link doesn't exist"; and just as importantly,
   * an unauthenticated endpoint that answered differently for a real slug than
   * for a made-up one would be an enumeration oracle for every short code in
   * the system. So the raw slug is always stored, and the resolved link and
   * workspace are best-effort: null when the slug names nothing.
   */
  async submitReport(slug: string, input: SubmitReportInput): Promise<SubmitReportResult> {
    // Best-effort resolution. lower() matching mirrors the preview/unlock path
    // in public.service.ts — a printed QR read as SNAP.TO/Spring reports the
    // same link as snap.to/spring.
    const [link] = await this.db
      .select({ id: links.id, workspaceId: links.workspaceId })
      .from(links)
      .where(sql`lower(${links.slug}) = ${slug.toLowerCase()}`)
      .limit(1);

    const contact = input.reporterContact?.trim() ? input.reporterContact.trim() : null;

    await this.db.insert(abuseReports).values({
      slug,
      linkId: link?.id ?? null,
      workspaceId: link?.workspaceId ?? null,
      reason: input.reason,
      reporterContact: contact,
      status: "open",
    });

    return { ok: true };
  }

  /* ---------------- operator-side (authed, workspace-scoped) ---------------- */

  /**
   * List the reports an operator owns (#291, FEAT-003).
   *
   * Scoped strictly to reports whose slug resolved to a link in THIS workspace.
   * Reports with a null workspaceId (an unresolved slug — a typo, or a link
   * already deleted) are intentionally shown to no workspace here: an
   * unresolved slug belongs to no one, so no operator owns it. Surfacing those
   * would leak one workspace's reports to another and has no natural owner to
   * act on it; a future global/admin view is out of scope for this feature.
   */
  async list(workspaceId: string): Promise<AbuseReport[]> {
    const rows = await this.db
      .select()
      .from(abuseReports)
      .where(eq(abuseReports.workspaceId, workspaceId))
      .orderBy(desc(abuseReports.createdAt));
    return rows.map(toDto);
  }

  /**
   * Review a report and optionally flag the link behind it (#291, FEAT-003).
   *
   * Loads the report scoped by workspaceId (NotFound if missing or owned by
   * another workspace, mirroring forms.service.get). Then, in a SINGLE
   * transaction so a report is never marked actioned while its link stayed
   * unflagged:
   *   - if `input.status` is set, moves the report to that status;
   *   - if `input.flagLink` is true AND the report resolved to a link, sets
   *     links.safeBrowsingStatus = 'flagged' (+ safeBrowsingCheckedAt = now)
   *     for that link scoped to the workspace. 'flagged' is the exact value the
   *     redirect gate reads (apps/redirect/src/main.ts gateFor), so this is the
   *     enforcement path.
   *
   * When flagLink flips a link and the caller passed no explicit status, the
   * report is defaulted to 'actioned' — flagging a link IS the action, and a
   * report left 'open' after enforcement would misrepresent the queue.
   *
   * The recorded outcome (status + audit entry) reflects the ACTUAL result of
   * the links UPDATE, not the report's intake-time linkId. The flag write is
   * scoped to links.workspaceId, so a link that has since moved to another
   * workspace (or been otherwise removed from this one) matches zero rows even
   * though report.linkId still names it. In that case we do NOT default the
   * report to 'actioned' and do NOT write a 'link.flagged' audit entry — a
   * moved/deleted link must never let a report claim an enforcement that did
   * not occur (review issue #2, #291).
   */
  async review(workspaceId: string, id: string, actor: Actor, input: UpdateAbuseReportInput): Promise<AbuseReport> {
    if (input.status === undefined && input.flagLink === undefined) {
      throw new BadRequestException("Nothing to update: pass a status, flagLink, or both.");
    }

    const report = await this.getOwned(workspaceId, id);

    // We only attempt to flag when there is a resolved link on the report; but
    // whether the flag actually took effect is decided by the UPDATE below, not
    // by the intake-time linkId.
    const attemptFlag = input.flagLink === true && report.linkId !== null;

    const flagged = await this.db.transaction(async (tx) => {
      let didFlag = false;

      if (attemptFlag) {
        // .returning() yields exactly the rows the UPDATE changed. An empty
        // array means the link no longer matches (id, workspaceId) — it moved
        // or is gone — so the flag did NOT take effect.
        const updated = await tx
          .update(links)
          .set({ safeBrowsingStatus: "flagged", safeBrowsingCheckedAt: new Date() })
          .where(and(eq(links.id, report.linkId!), eq(links.workspaceId, workspaceId)))
          .returning({ id: links.id });
        didFlag = updated.length > 0;
      }

      // Flagging a link is itself the action, so default to 'actioned' when the
      // caller did not state a status of their own — but only if the flag
      // actually landed. A no-op flag falls back to the reviewed path (or an
      // explicit input.status, if the caller gave one).
      const nextStatus = input.status ?? (didFlag ? "actioned" : undefined);
      if (nextStatus !== undefined) {
        await tx
          .update(abuseReports)
          .set({ status: nextStatus, updatedAt: new Date() })
          .where(and(eq(abuseReports.id, id), eq(abuseReports.workspaceId, workspaceId)));
      }

      return didFlag;
    });

    // The audit reflects what actually happened: a 'link.flagged' entry only
    // when a link row was truly updated, otherwise the plain reviewed entry.
    const recordedStatus = input.status ?? (flagged ? "actioned" : report.status);
    await recordActivity(this.db, this.logger, {
      workspaceId,
      actor,
      auditAction: flagged ? "link.flagged" : "abuse_report.reviewed",
      targetType: flagged ? "link" : "abuse_report",
      targetId: flagged ? report.linkId! : id,
      metadata: { reportId: id, slug: report.slug, status: recordedStatus, flagged },
    });

    return this.get(workspaceId, id);
  }

  private async getOwned(workspaceId: string, id: string): Promise<AbuseReportRow> {
    const [row] = await this.db
      .select()
      .from(abuseReports)
      .where(and(eq(abuseReports.id, id), eq(abuseReports.workspaceId, workspaceId)))
      .limit(1);
    if (!row) throw new NotFoundException("That report doesn't exist, or isn't in this workspace.");
    return row;
  }

  private async get(workspaceId: string, id: string): Promise<AbuseReport> {
    return toDto(await this.getOwned(workspaceId, id));
  }
}

function toDto(row: AbuseReportRow): AbuseReport {
  return {
    id: row.id,
    slug: row.slug,
    reason: row.reason,
    reporterContact: row.reporterContact,
    status: row.status as AbuseReport["status"],
    linkId: row.linkId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

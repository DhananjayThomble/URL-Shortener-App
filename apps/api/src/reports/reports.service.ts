import { Inject, Injectable } from "@nestjs/common";
import { abuseReports, links, sql, type Database } from "@snapurl/database";
import type { SubmitReportInput, SubmitReportResult } from "@snapurl/contract";
import { DB } from "../database/database.module.js";

@Injectable()
export class ReportsService {
  constructor(@Inject(DB) private readonly db: Database) {}

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
}

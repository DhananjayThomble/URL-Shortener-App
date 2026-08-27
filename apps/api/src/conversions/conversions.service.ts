import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { and, clickDaily, conversions, desc, eq, gte, links, lt, sql, workspaces, type Database } from "@snapurl/database";
import type { ConversionsReport, RecordConversionInput } from "@snapurl/contract";
import { DB } from "../database/database.module.js";

const RANGE_DAYS: Record<string, number> = { "24h": 1, "7d": 7, "30d": 30, "90d": 90, "12m": 365 };

@Injectable()
export class ConversionsService {
  constructor(@Inject(DB) private readonly db: Database) {}

  async report(workspaceId: string, range = "30d"): Promise<ConversionsReport> {
    const days = RANGE_DAYS[range] ?? 30;
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    start.setUTCDate(start.getUTCDate() - days + 1);
    const previousStart = new Date(start);
    previousStart.setUTCDate(previousStart.getUTCDate() - days);

    /* G7 — a report has to say what currency it is in.

       Nothing is converted. Summing a USD sale into an INR total produces a
       number that means nothing, and converting would need a rate source and a
       rate date — a product decision, not a backend one. So the report states
       the workspace currency and counts only conversions recorded in it. */
    const [workspace] = await this.db
      .select({ currency: workspaces.currency })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);
    const currency = workspace?.currency ?? "INR";

    const totals = await this.totalsFor(workspaceId, start, undefined, currency);
    const previous = await this.totalsFor(workspaceId, previousStart, start, currency);

    const events = await this.db
      .select({
        id: sql<string>`min(${conversions.id}::text)`,
        kind: conversions.kind,
        name: conversions.name,
        source: conversions.source,
        count: sql<number>`count(*)::int`,
      })
      .from(conversions)
      .where(and(eq(conversions.workspaceId, workspaceId), gte(conversions.occurredAt, start)))
      .groupBy(conversions.kind, conversions.name, conversions.source)
      .orderBy(desc(sql`count(*)`))
      .limit(12);

    const byLink = await this.db
      .select({
        link: links.slug,
        campaign: sql<string>`coalesce(${links.utm}->>'campaign', coalesce(${links.folder}, '-'))`,
        clicks: links.clicks,
        signups: sql<number>`count(*) filter (where ${conversions.kind} in ('signup', 'lead'))::int`,
        revenueMinor: sql<string>`coalesce(sum(${conversions.valueMinor}) filter (where ${conversions.currency} = ${currency}), 0)::text`,
      })
      .from(conversions)
      .innerJoin(links, eq(conversions.linkId, links.id))
      .where(and(eq(conversions.workspaceId, workspaceId), gte(conversions.occurredAt, start)))
      .groupBy(links.id, links.slug, links.utm, links.folder, links.clicks)
      .orderBy(desc(sql`count(*)`))
      .limit(10);

    return {
      currency,
      totals,
      deltas: {
        clicks: percentChange(previous.clicks, totals.clicks),
        leads: percentChange(previous.leads, totals.leads),
        signups: percentChange(previous.signups, totals.signups),
        paid: percentChange(previous.paid, totals.paid),
        revenue: percentChange(previous.revenue, totals.revenue),
      },
      events: events.map((e) => ({
        id: e.id,
        kind: e.kind as ConversionsReport["events"][number]["kind"],
        name: e.name,
        source: e.source,
        count: e.count,
      })),
      byLink: byLink.map((r) => ({
        link: r.link,
        campaign: r.campaign,
        clicks: r.clicks,
        signups: r.signups,
        cvr: r.clicks > 0 ? Math.round((r.signups / r.clicks) * 1000) / 10 : 0,
        revenue: minorToMajor(r.revenueMinor),
      })),
      revenueSeries: await this.revenueSeries(workspaceId, start, days, currency),
    };
  }

  async record(workspaceId: string, input: RecordConversionInput) {
    let linkId = input.linkId ?? null;
    if (!linkId && input.slug) {
      const [link] = await this.db
        .select({ id: links.id })
        .from(links)
        .where(and(eq(links.workspaceId, workspaceId), eq(links.slug, input.slug)))
        .limit(1);
      if (!link) throw new BadRequestException(`No link with the back-half "${input.slug}" in this workspace.`);
      linkId = link.id;
    }

    const [workspace] = await this.db
      .select({ currency: workspaces.currency })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);

    /* externalId makes this idempotent. A customer retrying a webhook after a
       timeout must not book the same sale twice — and they will retry. */
    const [row] = await this.db
      .insert(conversions)
      .values({
        workspaceId,
        linkId,
        kind: input.kind,
        name: input.name,
        source: "api",
        valueMinor: input.valueMinor,
        currency: (input.currency ?? workspace?.currency ?? "INR").toUpperCase(),
        externalId: input.externalId ?? null,
        visitorHash: input.visitorHash ?? null,
      })
      .onConflictDoNothing()
      .returning();

    return { id: row?.id ?? null, recorded: Boolean(row) };
  }

  private async totalsFor(workspaceId: string, start: Date, end: Date | undefined, currency: string) {
    const bounds = [eq(conversions.workspaceId, workspaceId), gte(conversions.occurredAt, start)];
    if (end) bounds.push(lt(conversions.occurredAt, end));

    const [row] = await this.db
      .select({
        leads: sql<number>`count(*) filter (where ${conversions.kind} = 'lead')::int`,
        signups: sql<number>`count(*) filter (where ${conversions.kind} = 'signup')::int`,
        paid: sql<number>`count(*) filter (where ${conversions.kind} = 'sale')::int`,
        revenueMinor: sql<string>`coalesce(sum(${conversions.valueMinor}) filter (where ${conversions.currency} = ${currency}), 0)::text`,
      })
      .from(conversions)
      .where(and(...bounds));

    const clickBounds = [eq(clickDaily.workspaceId, workspaceId), gte(clickDaily.day, isoDay(start))];
    if (end) clickBounds.push(lt(clickDaily.day, isoDay(end)));
    const [clicks] = await this.db
      .select({ total: sql<number>`coalesce(sum(${clickDaily.clicks}), 0)::int` })
      .from(clickDaily)
      .where(and(...clickBounds));

    return {
      clicks: clicks?.total ?? 0,
      leads: row?.leads ?? 0,
      signups: row?.signups ?? 0,
      paid: row?.paid ?? 0,
      revenue: minorToMajor(row?.revenueMinor ?? "0"),
    };
  }

  private async revenueSeries(workspaceId: string, start: Date, days: number, currency: string): Promise<number[]> {
    const rows = await this.db
      .select({
        day: sql<string>`(${conversions.occurredAt} at time zone 'UTC')::date::text`,
        revenueMinor: sql<string>`coalesce(sum(${conversions.valueMinor}), 0)::text`,
      })
      .from(conversions)
      .where(
        and(
          eq(conversions.workspaceId, workspaceId),
          gte(conversions.occurredAt, start),
          eq(conversions.currency, currency),
        ),
      )
      .groupBy(sql`(${conversions.occurredAt} at time zone 'UTC')::date`)
      .orderBy(sql`(${conversions.occurredAt} at time zone 'UTC')::date`);

    const byDay = new Map(rows.map((r) => [r.day, minorToMajor(r.revenueMinor)]));
    const out: number[] = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(start);
      d.setUTCDate(d.getUTCDate() + i);
      out.push(byDay.get(isoDay(d)) ?? 0);
    }
    return out;
  }
}

/** Minor units become major units exactly once, at the edge of the system, so
 *  no intermediate total is ever a float. */
function minorToMajor(minor: string | number): number {
  return Number(minor) / 100;
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function percentChange(before: number, after: number): number {
  if (before === 0) return after === 0 ? 0 : 100;
  return Math.round(((after - before) / before) * 1000) / 10;
}

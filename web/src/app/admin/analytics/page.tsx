"use client";

import { useState } from "react";
import type { AdminAnalyticsCsvView, AdminAnalyticsRange, AdminRankRow } from "@snapurl/contract";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  ErrorState,
  Segmented,
  Skeleton,
  Table,
  TableWrap,
  Td,
  Th,
} from "@/components/ui";
import { downloadAdminAnalyticsCsv, useAdminAnalytics } from "@/lib/api/hooks/admin";

/* ============================================================
   #973 — the platform-wide analytics view (admin panel 6/7).

   Reaching this page already means the server confirmed the caller is a
   platform admin (the /admin layout's AdminGate). It reads GET /admin/analytics
   and renders growth, usage, business, email and abuse — the same figures the
   API builds from the daily summary tables. The range picker and the
   compare toggle drive the query; each table has its own CSV export.
   ============================================================ */

const RANGES: AdminAnalyticsRange[] = ["7d", "30d", "90d", "12m"];
const RANGE_LABEL: Record<AdminAnalyticsRange, string> = {
  "7d": "7 days",
  "30d": "30 days",
  "90d": "90 days",
  "12m": "12 months",
};

export default function AdminAnalyticsPage() {
  const [range, setRange] = useState<AdminAnalyticsRange>("30d");
  const [compare, setCompare] = useState(false);
  const { data, isPending, isError, error, refetch } = useAdminAnalytics(range, compare);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-ink-1">Platform analytics</h1>
          <p className="mt-1 text-sm text-ink-3">
            Growth, usage, business, email and abuse across the whole platform, from the daily summary tables.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Segmented
            value={range}
            onChange={(r) => setRange(r)}
            options={RANGES.map((r) => ({ value: r, label: RANGE_LABEL[r] }))}
            aria-label="Date range"
          />
          <label className="flex items-center gap-2 text-xs text-ink-3">
            <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} />
            Compare to previous period
          </label>
        </div>
      </div>

      {isError ? (
        <ErrorState message={error instanceof Error ? error.message : "Could not load analytics."} onRetry={() => refetch()} />
      ) : isPending ? (
        <LoadingSkeleton />
      ) : (
        <div className="space-y-6" data-testid="admin-analytics">
          {/* ── Growth ── */}
          <Section title="Growth" view="growth" range={range}>
            <StatRow>
              <Stat label="Signups" value={data.growth.signups} previous={data.previous?.signups} />
              <Stat label="New workspaces" value={data.growth.newWorkspaces} previous={data.previous?.newWorkspaces} />
              <Stat label="Active users" value={data.growth.activeUsers} previous={data.previous?.activeUsers} />
            </StatRow>
            <StatRow>
              <Stat label="Active · daily" value={data.growth.activeDaily} />
              <Stat label="Active · weekly" value={data.growth.activeWeekly} />
              <Stat label="Active · monthly" value={data.growth.activeMonthly} />
            </StatRow>
            <RetentionTable retention={data.growth.retention} />
          </Section>

          {/* ── Usage ── */}
          <Section title="Usage" view="usage" range={range}>
            <StatRow>
              <Stat label="Links created" value={data.usage.linksCreated} previous={data.previous?.linksCreated} />
              <Stat label="Total clicks" value={data.usage.totalClicks} previous={data.previous?.totalClicks} />
              <Stat label="Unique visitors" value={data.usage.uniqueVisitors} previous={data.previous?.uniqueVisitors} />
            </StatRow>
            <div className="grid gap-6 md:grid-cols-2">
              <RankTable title="Top workspaces" rows={data.usage.topWorkspaces} view="topWorkspaces" range={range} unit="clicks" />
              <RankTable title="Top links" rows={data.usage.topLinks} view="topLinks" range={range} unit="clicks" />
              <RankTable title="By country" rows={data.usage.byCountry} unit="clicks" />
              <RankTable title="By device" rows={data.usage.byDevice} unit="clicks" />
              <RankTable title="By browser" rows={data.usage.byBrowser} unit="clicks" />
              <RankTable title="By referrer" rows={data.usage.byReferrer} unit="clicks" />
            </div>
          </Section>

          {/* ── Business ── */}
          <Section title="Business" view="business" range={range}>
            <div className="grid gap-6 md:grid-cols-2">
              <RankTable title="Workspaces per plan" rows={data.business.byPlan} unit="workspaces" />
              <Card>
                <CardHeader title="Near their limit" />
                <CardBody>
                  {data.business.nearLimit.length === 0 ? (
                    <p className="text-sm text-ink-3">No workspaces are near their click allowance.</p>
                  ) : (
                    <TableWrap label="Workspaces near their click allowance">
                      <Table>
                        <thead>
                          <tr>
                            <Th>Workspace</Th>
                            <Th>Plan</Th>
                            <Th className="text-right">Clicks</Th>
                            <Th className="text-right">Included</Th>
                            <Th className="text-right">Used</Th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.business.nearLimit.map((w) => (
                            <tr key={w.workspace}>
                              <Td>{w.workspace}</Td>
                              <Td>{w.plan}</Td>
                              <Td className="text-right tabular-nums">{w.clicks.toLocaleString()}</Td>
                              <Td className="text-right tabular-nums">{w.included.toLocaleString()}</Td>
                              <Td className="text-right tabular-nums">{Math.round(w.usedFraction * 100)}%</Td>
                            </tr>
                          ))}
                        </tbody>
                      </Table>
                    </TableWrap>
                  )}
                </CardBody>
              </Card>
            </div>
          </Section>

          {/* ── Email ── */}
          <Section title="Email (SES)">
            {data.email.available ? (
              <StatRow>
                <Stat label="Sends" value={data.email.sends ?? 0} />
                <Stat label="Bounces" value={data.email.bounces ?? 0} />
                <Stat label="Complaints" value={data.email.complaints ?? 0} />
                <Stat label="Bounce rate" value={pct(data.email.bounceRate)} raw />
              </StatRow>
            ) : (
              <Card>
                <CardBody>
                  <p className="text-sm text-ink-3">
                    Email metrics are not configured. They read from SES/CloudWatch, which needs a read-only grant on
                    the API role — a follow-up to this view.
                  </p>
                </CardBody>
              </Card>
            )}
          </Section>

          {/* ── Abuse ── */}
          <Section title="Abuse" view="abuse" range={range}>
            <StatRow>
              <Stat label="Reports" value={data.abuse.reports} previous={data.previous?.reports} />
              <Stat label="Resolved" value={data.abuse.resolved} />
              <Stat
                label="Avg resolution"
                value={data.abuse.avgResolutionHours == null ? "—" : `${data.abuse.avgResolutionHours}h`}
                raw
              />
            </StatRow>
          </Section>
        </div>
      )}
    </div>
  );
}

/* ── small presentational pieces ─────────────────────────── */

function Section({
  title,
  view,
  range,
  children,
}: {
  title: string;
  view?: AdminAnalyticsCsvView;
  range?: AdminAnalyticsRange;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-3">{title}</h2>
        {view && range ? <CsvButton view={view} range={range} /> : null}
      </div>
      {children}
    </section>
  );
}

function CsvButton({ view, range }: { view: AdminAnalyticsCsvView; range: AdminAnalyticsRange }) {
  const [busy, setBusy] = useState(false);
  return (
    <Button
      variant="ghost"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await downloadAdminAnalyticsCsv(view, range);
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? "Exporting…" : "Export CSV"}
    </Button>
  );
}

function StatRow({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{children}</div>;
}

function Stat({
  label,
  value,
  previous,
  raw,
}: {
  label: string;
  value: number | string;
  previous?: number;
  raw?: boolean;
}) {
  const shown = raw || typeof value === "string" ? value : value.toLocaleString();
  const delta = typeof value === "number" && previous != null ? percentDelta(previous, value) : null;
  return (
    <Card>
      <CardBody>
        <div className="text-xs text-ink-3">{label}</div>
        <div className="mt-1 text-2xl font-semibold tabular-nums text-ink-1">{shown}</div>
        {delta != null ? (
          <div className={`mt-1 text-xs ${delta >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
            {delta >= 0 ? "▲" : "▼"} {Math.abs(delta)}% vs previous
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}

function RankTable({
  title,
  rows,
  unit,
  view,
  range,
}: {
  title: string;
  rows: AdminRankRow[];
  unit: string;
  view?: AdminAnalyticsCsvView;
  range?: AdminAnalyticsRange;
}) {
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center justify-between gap-2">
            <span>{title}</span>
            {view && range ? <CsvButton view={view} range={range} /> : null}
          </span>
        }
      />
      <CardBody>
        {rows.length === 0 ? (
          <p className="text-sm text-ink-3">Nothing in this range.</p>
        ) : (
          <TableWrap label={title}>
            <Table>
              <thead>
                <tr>
                  <Th>Name</Th>
                  <Th className="text-right">{unit}</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.label}>
                    <Td>{r.label}</Td>
                    <Td className="text-right tabular-nums">{r.value.toLocaleString()}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </CardBody>
    </Card>
  );
}

function RetentionTable({
  retention,
}: {
  retention: { weeks: number; retained: number; cohort: number }[];
}) {
  return (
    <Card>
      <CardHeader title="Retention after signup" />
      <CardBody>
        <TableWrap label="Retention after signup">
          <Table>
            <thead>
              <tr>
                <Th>Weeks later</Th>
                <Th className="text-right">Retained</Th>
                <Th className="text-right">Cohort</Th>
                <Th className="text-right">Rate</Th>
              </tr>
            </thead>
            <tbody>
              {retention.map((r) => (
                <tr key={r.weeks}>
                  <Td>{r.weeks}w</Td>
                  <Td className="text-right tabular-nums">{r.retained.toLocaleString()}</Td>
                  <Td className="text-right tabular-nums">{r.cohort.toLocaleString()}</Td>
                  <Td className="text-right tabular-nums">
                    {r.cohort === 0 ? "—" : `${Math.round((r.retained / r.cohort) * 100)}%`}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      </CardBody>
    </Card>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-live="polite">
      <Skeleton className="h-8 w-48" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24" />
        ))}
      </div>
    </div>
  );
}

/** Percent change old -> current, rounded to a whole number. Null when there is
 *  no basis (previous was zero). */
function percentDelta(previous: number, current: number): number | null {
  if (previous === 0) return null;
  return Math.round(((current - previous) / previous) * 100);
}

/** A fraction (0..1) as a percentage string, or "—" when null. */
function pct(fraction: number | null): string {
  return fraction == null ? "—" : `${Math.round(fraction * 1000) / 10}%`;
}

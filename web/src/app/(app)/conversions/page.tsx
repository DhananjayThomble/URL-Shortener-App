"use client";

import { PageHead } from "@/components/app-shell";
import { Funnel, Sparkline } from "@/components/charts";
import { Card, CardBody, CardHeader, Chip, ErrorState, Segmented, Skeleton, Table, TableWrap, Td, Th, Tile } from "@/components/ui";
import { useConversions } from "@/lib/api/hooks";
import type { AnalyticsRange } from "@snapurl/contract";
import { useState } from "react";
import { formatDelta, full, inr, NO_VALUE, ratioPct } from "@/lib/utils";

/** A tile's delta line: the period change, plus the rate against clicks when there is one. */
function tileDelta(delta: number | null, rate?: string) {
  const d = formatDelta(delta);
  const text = rate && rate !== NO_VALUE ? `${d.text} · ${rate}` : d.text;
  return { delta: text, deltaTone: d.tone };
}

/** Share of clicks as a number, or null (rendered as a dash) when there were no clicks. */
function shareOf(n: number, clicks: number): number | null {
  return clicks > 0 ? (n / clicks) * 100 : null;
}

export default function ConversionsPage() {
  const [range, setRange] = useState<AnalyticsRange>("30d");
  const { data, isLoading, isError, error, refetch } = useConversions(range);

  return (
    <>
      <PageHead
        title="Conversions"
        sub="Which links actually produced revenue — not which produced clicks."
        actions={
          <>
            <Segmented<AnalyticsRange>
              aria-label="Conversions date range"
              value={range}
              onChange={setRange}
              options={[
                { value: "24h", label: "24h" },
                  { value: "7d", label: "7d" },
                  { value: "30d", label: "30d" },
                  { value: "90d", label: "90d" },
                  { value: "12m", label: "12m" },
              ]}
            />
          </>
        }
      />

      {isError ? (
        <Card>
          <ErrorState message={(error as Error).message} onRetry={() => refetch()} />
        </Card>
      ) : isLoading || !data ? (
        <Skeleton className="h-[400px]" />
      ) : (
        <>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(178px,1fr))] gap-3 mb-5">
            <Tile label="Clicks" value={full(data.totals.clicks)} {...tileDelta(data.deltas.clicks)} />
            <Tile label="Leads" value={full(data.totals.leads)} {...tileDelta(data.deltas.leads, ratioPct(data.totals.leads, data.totals.clicks))} />
            <Tile label="Signups" value={full(data.totals.signups)} {...tileDelta(data.deltas.signups, ratioPct(data.totals.signups, data.totals.clicks))} />
            <Tile label="Paid" value={full(data.totals.paid)} {...tileDelta(data.deltas.paid, ratioPct(data.totals.paid, data.totals.clicks, 2))} />
            <Tile label="Revenue" value={inr(data.totals.revenue)} {...tileDelta(data.deltas.revenue)}>
              <Sparkline values={data.revenueSeries} width={160} height={26} />
            </Tile>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[1.55fr_1fr] gap-3.5 mb-3.5 items-start">
            <Card>
              <CardHeader title="Funnel" right={<Chip>Click → revenue</Chip>} />
              <CardBody>
                <Funnel
                  steps={[
                    { label: "Clicks", value: data.totals.clicks },
                    { label: "Leads", value: data.totals.leads, pct: shareOf(data.totals.leads, data.totals.clicks) },
                    { label: "Signups", value: data.totals.signups, pct: shareOf(data.totals.signups, data.totals.clicks) },
                    { label: "Paid", value: data.totals.paid, pct: shareOf(data.totals.paid, data.totals.clicks) },
                  ]}
                />
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Tracked events" />
              <CardBody className="flex flex-col gap-[9px]">
                {data.events.map((e) => (
                  <div key={e.id} className="flex items-center gap-[11px] px-[11px] py-[9px] border border-line rounded-[var(--radius-sm)]">
                    <Chip tone={e.kind === "custom" ? "default" : "teal"}>{e.kind}</Chip>
                    <div className="flex-1 min-w-0">
                      <b className="block text-[13px] font-semibold">{e.name}</b>
                      <span className="block text-[11px] text-ink-3 font-mono truncate">{e.source}</span>
                    </div>
                    <span className="font-mono text-[12.5px] font-semibold tnum">{full(e.count)}</span>
                  </div>
                ))}
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader title="Revenue by link" />
            <TableWrap label="Revenue by link">
              <Table>
                <thead>
                  <tr>
                    <Th>Link</Th>
                    <Th>Campaign</Th>
                    <Th>Clicks</Th>
                    <Th>Signups</Th>
                    <Th>CVR</Th>
                    <Th>Revenue</Th>
                    <Th>Rev / click</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.byLink.map((r) => (
                    <tr key={r.link}>
                      <Td className="text-ink font-medium font-mono">{r.link}</Td>
                      <Td>{r.campaign}</Td>
                      <Td className="tnum">{full(r.clicks)}</Td>
                      <Td className="tnum">{full(r.signups)}</Td>
                      <Td className="tnum">{r.cvr}%</Td>
                      <Td className="tnum text-ink font-medium">{inr(r.revenue)}</Td>
                      <Td className="tnum">{r.clicks > 0 ? `₹${Math.round(r.revenue / r.clicks)}` : NO_VALUE}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          </Card>
        </>
      )}
    </>
  );
}

"use client";

import { PageHead } from "@/components/app-shell";
import { Funnel, Sparkline } from "@/components/charts";
import { Button, Card, CardBody, CardHeader, Chip, ErrorState, Segmented, Skeleton, Table, TableWrap, Td, Th, Tile } from "@/components/ui";
import { useConversions } from "@/lib/api/hooks";
import type { AnalyticsRange } from "@snapurl/contract";
import { useState } from "react";
import { full, inr, pct } from "@/lib/utils";

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
            <Button>Define an event</Button>
            <Button variant="primary">Install tracking</Button>
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
            <Tile label="Clicks" value={full(data.totals.clicks)} delta={`▲ ${pct(data.deltas.clicks)}`} deltaTone="up" />
            <Tile
              label="Leads"
              value={full(data.totals.leads)}
              delta={`▲ ${pct(data.deltas.leads)} · ${((data.totals.leads / data.totals.clicks) * 100).toFixed(1)}%`}
              deltaTone="up"
            />
            <Tile
              label="Signups"
              value={full(data.totals.signups)}
              delta={`▼ ${pct(Math.abs(data.deltas.signups))} · ${((data.totals.signups / data.totals.clicks) * 100).toFixed(1)}%`}
              deltaTone="down"
            />
            <Tile
              label="Paid"
              value={full(data.totals.paid)}
              delta={`▲ ${pct(data.deltas.paid)} · ${((data.totals.paid / data.totals.clicks) * 100).toFixed(2)}%`}
              deltaTone="up"
            />
            <Tile label="Revenue" value={inr(data.totals.revenue)} delta={`▲ ${pct(data.deltas.revenue)}`} deltaTone="up">
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
                    { label: "Leads", value: data.totals.leads, pct: (data.totals.leads / data.totals.clicks) * 100 },
                    { label: "Signups", value: data.totals.signups, pct: (data.totals.signups / data.totals.clicks) * 100 },
                    { label: "Paid", value: data.totals.paid, pct: (data.totals.paid / data.totals.clicks) * 100 },
                  ]}
                />
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Tracked events" right={<Button size="sm">＋ Add</Button>} />
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
                <div className="px-[13px] py-[11px] bg-wash-teal rounded-[var(--radius-sm)] text-[12.5px] text-teal leading-[1.5] mt-1">
                  <b>Attribution is server-side.</b>{" "}
                  <span className="text-ink-2">
                    The click ID travels in the redirect, not in a cookie — so it survives Safari, ad blockers and
                    cross-device.
                  </span>
                </div>
              </CardBody>
            </Card>
          </div>

          <Card>
            <CardHeader title="Revenue by link" />
            <TableWrap>
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
                      <Td className="tnum">₹{Math.round(r.revenue / r.clicks)}</Td>
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

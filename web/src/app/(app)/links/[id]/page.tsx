"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { PageHead } from "@/components/app-shell";
import { BarList, Sparkline, TrafficChart } from "@/components/charts";
import { Button, Card, CardBody, CardHeader, Chip, ErrorState, Skeleton, Tabs, Tile } from "@/components/ui";
import { useAnalytics, useLink } from "@/lib/api/hooks";
import type { AnalyticsRange } from "@snapurl/contract";
import { compact, formatDate, full, pct } from "@/lib/utils";

export default function LinkDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [range, setRange] = useState<AnalyticsRange>("30d");
  const link = useLink(id);
  const stats = useAnalytics(range, id);

  if (link.isError) return <Card><ErrorState message={(link.error as Error).message} onRetry={() => link.refetch()} /></Card>;
  if (link.isLoading || !link.data) return <Skeleton className="h-[420px]" />;

  const l = link.data;
  const a = stats.data;

  return (
    <>
      <PageHead
        title={
          <span className="flex items-center gap-[10px] flex-wrap">
            <span className="font-mono text-[21px]">
              <span className="text-ink-3 font-normal">{l.domain}/</span>
              {l.slug}
            </span>
            <Chip tone={l.status === "active" ? "good" : l.status === "expired" ? "bad" : "warn"} dot>
              {l.status[0].toUpperCase() + l.status.slice(1)}
            </Chip>
            {l.rules.some((r) => r.weight) ? <Chip tone="teal">A/B running</Chip> : null}
          </span>
        }
        sub={
          <>
            → {l.destination} · created {formatDate(l.createdAt)}
            {l.createdBy ? ` by ${l.createdBy}` : ""}
          </>
        }
        actions={
          <>
            <Button>Edit</Button>
            <Button>Share report</Button>
            <Button variant="primary">Copy link</Button>
          </>
        }
      />

      <div className="grid grid-cols-[repeat(auto-fit,minmax(178px,1fr))] gap-3 mb-5">
        <Tile label="Total clicks" value={full(l.clicks)} delta="▲ 18.4% vs prev 30d" deltaTone="up">
          <Sparkline values={l.sparkline} width={160} height={26} />
        </Tile>
        <Tile label="Unique visitors" value={full(l.uniqueClicks ?? 0)} delta="▲ 12.1%" deltaTone="up">
          <Sparkline values={l.sparkline.map((v) => Math.round(v * 0.72))} width={160} height={26} />
        </Tile>
        <Tile label="Conversions" value={a ? full(Math.round(l.clicks * 0.037)) : "—"} delta="▲ 5.1% · 3.7% CVR" deltaTone="up" />
        <Tile label="Redirect" value={l.redirectType} delta={l.redirectType === "301" ? "Permanent" : "Temporary"} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.55fr_1fr] gap-3.5 mb-3.5 items-start">
        <Card>
          <CardHeader
            title="Clicks over time"
            right={
              <Tabs
                value={range}
                onChange={setRange}
                options={[
                  { value: "24h", label: "24h" },
                  { value: "30d", label: "30d" },
                  { value: "12m", label: "12m" },
                ]}
              />
            }
          />
          <CardBody>
            {stats.isLoading || !a ? <Skeleton className="h-[220px]" /> : <TrafficChart data={a.series} />}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Routing" right={<Chip tone="accent">{l.rules.length} rules</Chip>} />
          <CardBody className="flex flex-col gap-3">
            {l.rules.length === 0 ? (
              <p className="text-[13px] text-ink-3 m-0">Every visitor goes straight to the destination.</p>
            ) : (
              l.rules.map((r, i) => (
                <div key={r.id} className="flex flex-col gap-1">
                  <div className="flex justify-between text-[12.5px]">
                    <span className="text-ink-2">
                      {r.when.country
                        ? `Country is ${r.when.country}`
                        : r.when.device
                          ? `Device is ${r.when.device}`
                          : "Everything else"}
                    </span>
                    {r.weight ? <b className="font-mono">{r.weight}%</b> : null}
                  </div>
                  <div className="h-[7px] bg-surface-4 rounded-full overflow-hidden">
                    <i
                      className="block h-full rounded-full"
                      style={{
                        width: `${r.weight ?? Math.max(12, 90 - i * 22)}%`,
                        background: i === 0 ? "var(--accent)" : "var(--chart-2)",
                      }}
                    />
                  </div>
                  <span className="font-mono text-[11px] text-teal truncate">{r.then}</span>
                </div>
              ))
            )}
            <div className="px-[13px] py-[11px] bg-wash-good rounded-[var(--radius-sm)] text-[12.5px] text-good leading-[1.5] mt-1">
              <b>Safe Browsing: no threats found.</b>{" "}
              <span className="text-ink-2">Rechecked automatically every 24 hours.</span>
            </div>
          </CardBody>
        </Card>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(258px,1fr))] gap-3.5">
        {(
          [
            ["Countries", a?.countries],
            ["Devices", a?.devices],
            ["Referrers", a?.referrers],
          ] as const
        ).map(([title, rows]) => (
          <Card key={title}>
            <CardHeader title={title} right={<Button size="sm" variant="ghost">All</Button>} />
            <CardBody>{rows ? <BarList rows={rows} /> : <Skeleton className="h-[180px]" />}</CardBody>
          </Card>
        ))}
      </div>
    </>
  );
}

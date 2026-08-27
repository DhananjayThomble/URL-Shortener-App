"use client";

import { useState } from "react";
import { PageHead } from "@/components/app-shell";
import { BarList, Sparkline, TrafficChart } from "@/components/charts";
import { Button, Card, CardBody, CardHeader, ErrorState, Skeleton, Tabs, Tile } from "@/components/ui";
import { useAnalytics } from "@/lib/api/hooks";
import { compact, full, pct } from "@/lib/utils";

export default function AnalyticsPage() {
  const [range, setRange] = useState("30d");
  const [series, setSeries] = useState<"clicks" | "both">("both");
  const { data, isLoading, isError, error, refetch } = useAnalytics(range);

  return (
    <>
      <PageHead
        title="Analytics"
        sub="No cookies set · click data never sold · 3 years retention"
        actions={
          <>
            <Button>Last 30 days ▾</Button>
            <Button>Schedule report</Button>
            <Button variant="primary">Export CSV</Button>
          </>
        }
      />

      {isError ? (
        <Card>
          <ErrorState message={(error as Error).message} onRetry={() => refetch()} />
        </Card>
      ) : isLoading || !data ? (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(178px,1fr))] gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-[122px]" />
          ))}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(178px,1fr))] gap-3 mb-5">
            <Tile label="Clicks" value={full(data.totals.clicks)} delta={`▲ ${pct(data.deltas.clicks)}`} deltaTone="up">
              <Sparkline values={data.series.map((s) => s.clicks)} width={160} height={26} />
            </Tile>
            <Tile label="Unique visitors" value={full(data.totals.unique)} delta={`▲ ${pct(data.deltas.unique)}`} deltaTone="up">
              <Sparkline values={data.series.map((s) => s.unique)} width={160} height={26} />
            </Tile>
            <Tile label="QR scans" value={full(data.totals.scans)} delta={`▲ ${pct(data.deltas.scans)}`} deltaTone="up">
              <Sparkline values={data.series.map((s) => s.scans ?? 0)} width={160} height={26} />
            </Tile>
            <Tile
              label="Conversions"
              value={full(data.totals.conversions)}
              delta={`▼ ${pct(Math.abs(data.deltas.conversions))}`}
              deltaTone="down"
            />
            <Tile label="Blocked / unsafe" value={full(data.totals.blocked)} delta="Safe Browsing" deltaTone="flat" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[1.55fr_1fr] gap-3.5 mb-3.5 items-start">
            <Card>
              <CardHeader
                title="Traffic"
                right={
                  <Tabs
                    value={series}
                    onChange={setSeries}
                    options={[
                      { value: "clicks", label: "Clicks" },
                      { value: "both", label: "Clicks + scans" },
                    ]}
                  />
                }
              />
              <CardBody>
                <TrafficChart data={data.series} series={series === "both" ? ["clicks", "scans"] : ["clicks"]} />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Top links" right={<Button size="sm" variant="ghost">View all</Button>} />
              <CardBody>
                <BarList rows={data.topLinks} mono />
              </CardBody>
            </Card>
          </div>

          <div className="grid grid-cols-[repeat(auto-fit,minmax(258px,1fr))] gap-3.5">
            {(
              [
                ["Countries", data.countries],
                ["Browsers", data.browsers],
                ["Tags", data.tags],
              ] as const
            ).map(([title, rows]) => (
              <Card key={title}>
                <CardHeader title={title} />
                <CardBody>
                  <BarList rows={rows} />
                </CardBody>
              </Card>
            ))}
          </div>
        </>
      )}
    </>
  );
}

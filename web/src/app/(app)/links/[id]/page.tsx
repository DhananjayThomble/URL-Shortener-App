"use client";

import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { PageHead } from "@/components/app-shell";
import { BarList, Sparkline, TrafficChart } from "@/components/charts";
import { Button, Card, CardBody, CardHeader, Chip, ErrorState, NotFoundState, Skeleton, Tabs, Tile } from "@/components/ui";
import { EditLinkDrawer } from "@/components/links/edit-link-drawer";
import { useAnalytics, useDeleteLink, useLink } from "@/lib/api/hooks";
import type { AnalyticsRange } from "@snapurl/contract";
import { copy, formatDate, formatDelta, full, NO_VALUE, pct, shortUrlHref } from "@/lib/utils";
import { headlineStats, RANGE_SCOPE } from "@/lib/link-detail-stats";
import { detailLoadErrorKind } from "@/lib/load-error";

const RANGE_LABEL: Record<AnalyticsRange, string> = {
  "24h": "prev 24h",
  "7d": "prev 7d",
  "30d": "prev 30d",
  "90d": "prev 90d",
  "12m": "prev 12m",
};

/**
 * Render a delta the API actually reported.
 *
 * Returns undefined while analytics are still loading, so the tile shows
 * nothing rather than a number that was never measured — every one of these
 * used to be a hardcoded string that moved for no reason.
 */
function deltaFor(value: number | null | undefined, range: AnalyticsRange) {
  if (value === undefined) return { delta: undefined, deltaTone: "flat" as const };
  const d = formatDelta(value);
  return {
    delta: d.text === NO_VALUE ? d.text : `${d.text} vs ${RANGE_LABEL[range]}`,
    deltaTone: d.tone,
  };
}

export default function LinkDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [range, setRange] = useState<AnalyticsRange>("30d");
  const link = useLink(id);
  const stats = useAnalytics(range, id);

  const deleteLink = useDeleteLink();

  const [editing, setEditing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [copied, setCopied] = useState(false);

  if (link.isError) {
    /* A link that is not there — or is in another workspace, which the API
       reports identically — cannot be fixed by retrying (#790). Fixed copy, not
       the server's message, so the two cases read alike. */
    const kind = detailLoadErrorKind(link.error);
    if (kind === "not-found")
      return (
        <Card>
          <NotFoundState
            title="Link not found"
            body="This link doesn't exist, or you don't have access to it. It may have been deleted."
            backHref="/links"
            backLabel="Back to links"
          />
        </Card>
      );
    if (kind === "forbidden")
      return (
        <Card>
          <NotFoundState
            title="You can't open this link"
            body="You don't have permission to view it."
            backHref="/links"
            backLabel="Back to links"
          />
        </Card>
      );
    return <Card><ErrorState message={(link.error as Error).message} onRetry={() => link.refetch()} /></Card>;
  }
  if (link.isLoading || !link.data) return <Skeleton className="h-[420px]" />;

  const l = link.data;
  const a = stats.data;

  /* The four tiles read from the analytics response that was already being
     fetched. Three of them used to be invented: two fixed percentage strings
     and a conversions count derived as clicks × 0.037, which is a number
     nobody measured presented next to three that were real.

     #768: the two headline tiles also used to show the link's ALL-TIME counters
     (l.clicks / l.uniqueClicks) under a delta and beside breakdowns that were
     for the selected range. Now the value, delta, sparkline and breakdowns all
     come from the same response; the all-time counters are a labelled note. */
  const clickSeries = a?.series.map((p) => p.clicks);
  const uniqueSeries = a?.series.map((p) => p.unique);
  const conversions = a?.totals.conversions;
  const cvr = a && a.totals.clicks > 0 ? (a.totals.conversions / a.totals.clicks) * 100 : null;
  const headline = headlineStats(l, a);
  const scope = RANGE_SCOPE[range];

  /* The link's public short URL, the same https://<domain>/<slug> the QR studio
     encodes. */
  async function copyShortUrl() {
    if (await copy(shortUrlHref(l.domain, l.slug))) {
      setProblem(null);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else {
      setProblem("Couldn't copy to the clipboard from this browser. Select the short URL in the title and copy it manually.");
    }
  }

  async function remove() {
    try {
      await deleteLink.mutateAsync(id);
      router.push("/links");
    } catch (err) {
      setProblem((err as Error).message);
      setConfirmingDelete(false);
    }
  }

  return (
    <>
      <PageHead
        title={
          <span className="flex items-center gap-[10px] flex-wrap">
            <span className="font-mono text-[21px]">
              <span className="text-ink-3 font-normal">{l.domain}/</span>
              {l.slug}
            </span>
            <Chip tone={l.status === "active" ? "good" : l.status === "expired" ? "bad" : l.status === "archived" ? "default" : "warn"} dot>
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
            <Button onClick={() => setEditing(true)}>Edit</Button>
            {confirmingDelete ? (
              <>
                <Button onClick={() => setConfirmingDelete(false)}>Keep it</Button>
                <Button variant="danger" onClick={remove} disabled={deleteLink.isPending}>
                  {deleteLink.isPending ? "Deleting…" : "Delete for good"}
                </Button>
              </>
            ) : (
              <Button aria-label="Delete this link" onClick={() => setConfirmingDelete(true)}>Delete</Button>
            )}
            <Button variant="primary" onClick={copyShortUrl}>
              {copied ? "Copied ✓" : "Copy link"}
            </Button>
          </>
        }
      />

      {problem ? (
        <p className="text-[12.5px] text-bad mb-3" role="alert">
          {problem}
        </p>
      ) : null}

      {confirmingDelete ? (
        <Card className="mb-3.5">
          <CardBody className="text-[13px] text-ink-2 leading-[1.6]">
            <b className="text-ink">Deleting {l.domain}/{l.slug} cannot be undone.</b> Anywhere this
            link has already been printed, shared or turned into a QR code will stop working
            immediately. Its {full(l.clicks)} recorded {l.clicks === 1 ? "click goes" : "clicks go"} with it.
          </CardBody>
        </Card>
      ) : null}

      <EditLinkDrawer open={editing} onClose={() => setEditing(false)} link={l} />

      {stats.isError ? (
        <div className="flex items-center gap-3 flex-wrap mb-3" role="alert">
          <p className="text-[12.5px] text-bad m-0">
            Couldn&apos;t load the numbers for this range.
          </p>
          <Button onClick={() => stats.refetch()}>Retry</Button>
        </div>
      ) : null}

      <div className="grid grid-cols-[repeat(auto-fit,minmax(178px,1fr))] gap-3 mb-5">
        <Tile
          label="Total clicks"
          scope={`last ${scope}`}
          value={headline.clicks.value}
          note={headline.clicks.allTime}
          {...deltaFor(a?.deltas.clicks, range)}
        >
          {clickSeries ? <Sparkline values={clickSeries} width={160} height={26} /> : null}
        </Tile>
        {/* Approximate: uniques come from a HyperLogLog sketch (about 0.8%
            error), so the label signals that rather than implying an exact count. */}
        <Tile
          label="Unique visitors (approx.)"
          scope={`last ${scope}`}
          value={headline.unique.value}
          note={headline.unique.allTime}
          {...deltaFor(a?.deltas.unique, range)}
        >
          {/* The real per-day uniques, not the click sparkline scaled by 0.72. */}
          {uniqueSeries ? <Sparkline values={uniqueSeries} width={160} height={26} /> : null}
        </Tile>
        <Tile
          label="Conversions"
          scope={`last ${scope}`}
          value={conversions === undefined ? "—" : full(conversions)}
          {...(() => {
            const d = deltaFor(a?.deltas.conversions, range);
            return cvr === null ? d : { ...d, delta: `${d.delta ?? ""}${d.delta ? " · " : ""}${pct(cvr)} CVR` };
          })()}
        />
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
            {/* Read from the link rather than asserted. The verdict used to be
                hardcoded as "no threats found" for every link regardless of
                what safeBrowsing.status actually said. */}
            <div
              className={`px-[13px] py-[11px] rounded-[var(--radius-sm)] text-[12.5px] leading-[1.5] mt-1 ${
                l.safeBrowsing.status === "clean"
                  ? "bg-wash-good text-good"
                  : l.safeBrowsing.status === "flagged"
                    ? "bg-wash-bad text-bad"
                    : "bg-wash-warn text-amber"
              }`}
            >
              <b>
                {l.safeBrowsing.status === "clean"
                  ? "Safe Browsing: no threats found."
                  : l.safeBrowsing.status === "flagged"
                    ? "Safe Browsing: this destination is flagged."
                    : "Safe Browsing: not yet checked."}
              </b>
            </div>
          </CardBody>
        </Card>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(258px,1fr))] gap-3.5">
        {(
          [
            ["Countries", a?.countries],
            ["Cities", a?.cities],
            ["Devices", a?.devices],
            ["Referrers", a?.referrers],
          ] as const
        ).map(([title, rows]) => (
          <Card key={title}>
            <CardHeader title={title} />
            <CardBody>{rows ? <BarList rows={rows} /> : <Skeleton className="h-[180px]" />}</CardBody>
          </Card>
        ))}
      </div>
    </>
  );
}

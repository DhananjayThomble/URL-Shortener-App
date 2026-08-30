"use client";

import { PageHead } from "@/components/app-shell";
import { Button, Card, Chip, EmptyState, ErrorState, Skeleton, Table, TableWrap, Td, Th } from "@/components/ui";
import { useReports, useReviewReport } from "@/lib/api/hooks";
import type { AbuseReportStatus } from "@snapurl/contract";
import { formatDate } from "@/lib/utils";

/* Operator-side abuse-report queue — #291 (FEAT-003). Lists reports filed
   against this workspace's links and lets an editor move them through their
   status or flag the underlying link (which blocks the redirect server-side). */

const TONE: Record<AbuseReportStatus, "good" | "warn" | "default" | "bad"> = {
  open: "warn",
  reviewed: "default",
  dismissed: "default",
  actioned: "bad",
};

export default function ReportsPage() {
  const reports = useReports();
  const review = useReviewReport();

  if (reports.isError) {
    return (
      <Card>
        <ErrorState message={(reports.error as Error).message} onRetry={() => reports.refetch()} />
      </Card>
    );
  }

  const items = reports.data ?? [];

  return (
    <>
      <PageHead
        title="Abuse reports"
        sub="Reports filed against links in this workspace. Flagging a link blocks its redirect immediately."
      />

      {reports.isLoading ? (
        <Skeleton className="h-[220px]" />
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            icon="⚑"
            title="No reports"
            body="When someone reports one of this workspace's links from its trust page, it shows up here."
          />
        </Card>
      ) : (
        <Card>
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Link</Th>
                  <Th>Reason</Th>
                  <Th>Reporter</Th>
                  <Th>Status</Th>
                  <Th>Filed</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id}>
                    <Td className="font-mono text-[12px] text-accent">/{r.slug}</Td>
                    <Td className="text-ink max-w-[340px] text-[12.5px]">{r.reason}</Td>
                    <Td className="text-[12px] text-ink-3">
                      {r.reporterContact ?? <span className="text-ink-3">anonymous</span>}
                    </Td>
                    <Td>
                      <Chip tone={TONE[r.status]} dot>
                        {r.status[0]!.toUpperCase() + r.status.slice(1)}
                      </Chip>
                    </Td>
                    <Td className="text-[12px] text-ink-3 whitespace-nowrap">{formatDate(r.createdAt)}</Td>
                    <Td className="text-right whitespace-nowrap">
                      <div className="inline-flex gap-1.5">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={review.isPending}
                          onClick={() => review.mutate({ id: r.id, status: "reviewed" })}
                        >
                          Reviewed
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={review.isPending}
                          onClick={() => review.mutate({ id: r.id, status: "dismissed" })}
                        >
                          Dismiss
                        </Button>
                        <Button
                          size="sm"
                          disabled={review.isPending || r.linkId === null}
                          title={r.linkId === null ? "This report's slug did not resolve to a link" : undefined}
                          onClick={() => review.mutate({ id: r.id, flagLink: true })}
                        >
                          Flag link
                        </Button>
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        </Card>
      )}
    </>
  );
}

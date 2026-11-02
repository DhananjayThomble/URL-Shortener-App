"use client";

import { useState } from "react";
import type { FeedbackRow, FeedbackStatus } from "@snapurl/contract";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  ErrorState,
  Skeleton,
  Table,
  Td,
  Th,
} from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import { useAdminFeedback, useAdminFeedbackItem, useUpdateFeedback } from "@/lib/api/hooks";

/* #997 — the "Report a problem" admin inbox.

   The platform-admin surface for in-app feedback: the list (newest first, with
   a status filter), a detail view (the full message, the captured context and
   the screenshot), and the controls to move a report through its lifecycle
   (new → in progress → done) and leave notes. Reaching this page means
   AdminGate confirmed the caller is a platform admin; the API re-checks on
   every request and records every status/notes change in the admin audit log. */

const STATUS_LABEL: Record<FeedbackStatus, string> = {
  new: "New",
  in_progress: "In progress",
  done: "Done",
};

const STATUS_TONE: Record<FeedbackStatus, "warn" | "default" | "good"> = {
  new: "warn",
  in_progress: "default",
  done: "good",
};

const selectClass =
  "rounded-[var(--radius-sm)] border border-line bg-surface-2 px-[9px] py-[5px] text-[13px] text-ink outline-none focus:border-line-2";

export default function AdminFeedbackPage() {
  const [status, setStatus] = useState<FeedbackStatus | "all">("all");
  const [selected, setSelected] = useState<string | null>(null);
  const { data, isPending, isError, refetch } = useAdminFeedback({
    status: status === "all" ? undefined : status,
    limit: 50,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink-1">Feedback</h1>
        <p className="mt-1 text-sm text-ink-3">
          Problem reports submitted from the app. Move each one through new → in progress → done and leave notes. Every
          status and notes change is recorded in the admin audit log.
        </p>
      </div>

      <Card>
        <CardHeader title="Inbox" />
        <CardBody>
          <label className="mb-3 flex items-center gap-2 text-sm text-ink-3">
            Status
            <select
              className={selectClass}
              value={status}
              onChange={(e) => setStatus(e.target.value as FeedbackStatus | "all")}
              aria-label="Filter by status"
            >
              <option value="all">All</option>
              <option value="new">New</option>
              <option value="in_progress">In progress</option>
              <option value="done">Done</option>
            </select>
          </label>

          {isPending ? (
            <Skeleton className="h-40 w-full" />
          ) : isError ? (
            <ErrorState message="Could not read the feedback inbox." onRetry={() => refetch()} />
          ) : data!.rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-3">No reports match.</p>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>When</Th>
                  <Th>Message</Th>
                  <Th>From</Th>
                  <Th>Page</Th>
                  <Th>Status</Th>
                  <Th>Action</Th>
                </tr>
              </thead>
              <tbody>
                {data!.rows.map((r: FeedbackRow) => (
                  <tr key={r.id}>
                    <Td className="whitespace-nowrap text-ink-3">{new Date(r.createdAt).toLocaleString()}</Td>
                    <Td className="max-w-xs truncate" title={r.message}>
                      {r.message}
                      {r.hasScreenshot ? <span className="ml-1 text-ink-3" title="Has a screenshot">📎</span> : null}
                    </Td>
                    <Td className="text-ink-3">{r.reporterEmail ?? (r.userId ? "signed-in user" : "anonymous")}</Td>
                    <Td className="max-w-[12rem] truncate font-mono text-[12px] text-ink-3" title={r.page ?? ""}>
                      {r.page ?? "—"}
                    </Td>
                    <Td>
                      <Chip tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Chip>
                    </Td>
                    <Td>
                      <Button variant="ghost" onClick={() => setSelected(r.id)}>
                        Open
                      </Button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </CardBody>
      </Card>

      {selected ? <FeedbackDetailPanel id={selected} onClose={() => setSelected(null)} /> : null}
    </div>
  );
}

/* ---- detail + status/notes controls ---- */

function FeedbackDetailPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, isPending, isError, refetch } = useAdminFeedbackItem(id);
  const update = useUpdateFeedback();
  const toast = useToast();

  const [status, setStatus] = useState<FeedbackStatus | null>(null);
  const [notes, setNotes] = useState<string | null>(null);

  // The form seeds from the loaded report once, then tracks the operator's
  // edits; null means "not yet edited, use the server value".
  const effectiveStatus = status ?? data?.status ?? "new";
  const effectiveNotes = notes ?? data?.notes ?? "";

  const onSave = () => {
    if (!data) return;
    const input: { status?: FeedbackStatus; notes?: string } = {};
    if (effectiveStatus !== data.status) input.status = effectiveStatus;
    if (effectiveNotes !== (data.notes ?? "")) input.notes = effectiveNotes;
    if (input.status === undefined && input.notes === undefined) {
      toast.show({ message: "Nothing to save." });
      return;
    }
    update.mutate(
      { id, input },
      {
        onSuccess: () => {
          toast.show({ message: "Report updated." });
          setStatus(null);
          setNotes(null);
        },
        onError: (err) => toast.show({ message: err instanceof Error ? err.message : "Could not update the report." }),
      },
    );
  };

  return (
    <Card>
      <CardHeader
        title="Report detail"
        right={
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        }
      />
      <CardBody>
        {isPending ? (
          <Skeleton className="h-40 w-full" />
        ) : isError || !data ? (
          <ErrorState message="Could not read that report." onRetry={() => refetch()} />
        ) : (
          <div className="space-y-4">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13px]">
              <dt className="text-ink-3">When</dt>
              <dd>{new Date(data.createdAt).toLocaleString()}</dd>
              <dt className="text-ink-3">From</dt>
              <dd>{data.reporterEmail ?? (data.userId ? "signed-in user" : "anonymous")}</dd>
              <dt className="text-ink-3">Workspace</dt>
              <dd>{data.workspaceName ?? "—"}</dd>
              <dt className="text-ink-3">Page</dt>
              <dd className="font-mono text-[12px] break-all">{data.page ?? "—"}</dd>
              <dt className="text-ink-3">App version</dt>
              <dd className="font-mono text-[12px]">{data.appVersion ?? "—"}</dd>
              <dt className="text-ink-3">Browser</dt>
              <dd className="break-all text-ink-3">{data.userAgent ?? "—"}</dd>
              {data.errorEventId ? (
                <>
                  <dt className="text-ink-3">Error event</dt>
                  <dd className="font-mono text-[12px]">{data.errorEventId}</dd>
                </>
              ) : null}
            </dl>

            <div>
              <div className="mb-1 text-[12px] font-medium text-ink-2">Message</div>
              <p className="m-0 whitespace-pre-wrap rounded-[var(--radius-sm)] bg-surface-2 p-3 text-[13px] text-ink">
                {data.message}
              </p>
            </div>

            {data.screenshot ? (
              <div>
                <div className="mb-1 text-[12px] font-medium text-ink-2">Screenshot</div>
                {/* The screenshot is a self-contained data URL the reporter
                    attached; render it inline for the operator. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={data.screenshot}
                  alt="Screenshot attached to the report"
                  className="max-h-80 rounded-[var(--radius-sm)] border border-line"
                />
              </div>
            ) : null}

            <div className="flex flex-wrap items-end gap-3 border-t border-line pt-4">
              <label className="flex flex-col gap-1 text-[12px] text-ink-2">
                Status
                <select
                  className={selectClass}
                  value={effectiveStatus}
                  onChange={(e) => setStatus(e.target.value as FeedbackStatus)}
                  aria-label="Change status"
                >
                  <option value="new">New</option>
                  <option value="in_progress">In progress</option>
                  <option value="done">Done</option>
                </select>
              </label>
              <label className="flex flex-1 flex-col gap-1 text-[12px] text-ink-2">
                Notes
                <textarea
                  className="min-w-[14rem] resize-y rounded-[var(--radius-sm)] border border-line bg-surface-2 px-[9px] py-[6px] text-[13px] text-ink outline-none focus:border-line-2"
                  rows={2}
                  maxLength={4000}
                  value={effectiveNotes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Operator notes…"
                  aria-label="Operator notes"
                />
              </label>
              <Button variant="primary" disabled={update.isPending} onClick={onSave}>
                {update.isPending ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

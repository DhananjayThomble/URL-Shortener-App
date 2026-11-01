"use client";

import { useState } from "react";
import type { AdminBacklog, AdminServiceState, AdminServiceStatus } from "@snapurl/contract";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  ErrorState,
  Field,
  Input,
  Skeleton,
  Table,
  Td,
  Th,
} from "@/components/ui";
import { useToast } from "@/components/ui/toast";
import {
  useAdminAudit,
  useAdminBacklogs,
  useAdminServices,
  useReleaseJobLease,
  useRetryProjectionOutbox,
  useRetryWebhookDeliveries,
} from "@/lib/api/hooks";

/* #974 — system health and operations.

   Three panels: the status of every component, the backlog counts with a retry
   for each, and the admin audit trail with filters. Reaching this page means
   AdminGate confirmed the caller is a platform admin; the API checks it again
   on every request behind it. */

const STATE_TONE: Record<AdminServiceState, "good" | "warn" | "bad"> = {
  ok: "good",
  degraded: "warn",
  down: "bad",
};

const STATE_DOT: Record<AdminServiceState, string> = {
  ok: "bg-emerald-500",
  degraded: "bg-amber-500",
  down: "bg-red-500",
};

export default function AdminHealthPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink-1">System health and operations</h1>
        <p className="mt-1 text-sm text-ink-3">
          The health of each part of the platform, the operational backlogs, and the admin audit log. Every retry here
          is recorded in that log.
        </p>
      </div>

      <ServicesPanel />
      <BacklogsPanel />
      <AdminAuditPanel />
    </div>
  );
}

/* ---- services ---- */

function ServicesPanel() {
  const { data, isPending, isError, refetch } = useAdminServices();

  return (
    <Card>
      <CardHeader title="Services" />
      <CardBody>
        {isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : isError ? (
          <ErrorState message="Could not read service status." onRetry={() => refetch()} />
        ) : (
          <ul className="space-y-2">
            {data!.services.map((s) => (
              <ServiceRow key={s.name} service={s} />
            ))}
          </ul>
        )}
      </CardBody>
    </Card>
  );
}

function ServiceRow({ service }: { service: AdminServiceStatus }) {
  return (
    <li className="flex items-center gap-3 text-sm">
      <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${STATE_DOT[service.state]}`} aria-hidden />
      <span className="w-24 shrink-0 font-medium text-ink-1 capitalize">{service.name}</span>
      <Chip tone={STATE_TONE[service.state]}>{service.state}</Chip>
      <span className="text-ink-3">{service.detail}</span>
    </li>
  );
}

/* ---- backlogs ---- */

function BacklogsPanel() {
  const { data, isPending, isError, refetch } = useAdminBacklogs();

  return (
    <Card>
      <CardHeader title="Backlogs" />
      <CardBody>
        {isPending ? (
          <Skeleton className="h-28 w-full" />
        ) : isError ? (
          <ErrorState message="Could not read the backlog counts." onRetry={() => refetch()} />
        ) : (
          <div className="space-y-3">
            {data!.backlogs.map((b) => (
              <BacklogRow key={b.name} backlog={b} />
            ))}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function BacklogRow({ backlog }: { backlog: AdminBacklog }) {
  const toast = useToast();
  const [leaseName, setLeaseName] = useState("");
  const retryOutbox = useRetryProjectionOutbox();
  const retryWebhooks = useRetryWebhookDeliveries();
  const releaseLease = useReleaseJobLease();

  const pending = retryOutbox.isPending || retryWebhooks.isPending || releaseLease.isPending;

  const onRetried = (n: number, what: string) =>
    toast.show({ message: n > 0 ? `Re-queued ${n} ${what}.` : `Nothing stuck to re-queue.` });

  return (
    <div className="rounded-md border border-line-1 p-3">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-[13px] text-ink-1">{backlog.name}</span>
        <Chip tone="default">{backlog.pending} pending</Chip>
        <Chip tone={backlog.stuck > 0 ? "warn" : "default"}>{backlog.stuck} stuck</Chip>

        <div className="ml-auto">
          {backlog.name === "projection_outbox" && (
            <Button
              disabled={pending}
              onClick={() => retryOutbox.mutate(undefined, { onSuccess: (r) => onRetried(r.retried, "edge updates") })}
            >
              Retry stuck
            </Button>
          )}
          {backlog.name === "webhook_deliveries" && (
            <Button
              disabled={pending}
              onClick={() =>
                retryWebhooks.mutate(undefined, { onSuccess: (r) => onRetried(r.retried, "webhook deliveries") })
              }
            >
              Retry failed
            </Button>
          )}
        </div>
      </div>

      {/* A job lease is released by name — the operator reads the stuck lease's
          name from the worker logs and releases that one, rather than releasing
          every lease at once. */}
      {backlog.name === "job_leases" && (
        <div className="mt-3 flex items-end gap-2">
          <div className="flex-1">
            <Field label="Lease name">
              <Input
                value={leaseName}
                onChange={(e) => setLeaseName(e.target.value)}
                placeholder="e.g. click_events_prune_retention"
              />
            </Field>
          </div>
          <Button
            disabled={pending || leaseName.trim().length === 0}
            onClick={() =>
              releaseLease.mutate(leaseName.trim(), {
                onSuccess: (r) => {
                  onRetried(r.retried, "lease");
                  if (r.retried > 0) setLeaseName("");
                },
              })
            }
          >
            Release
          </Button>
        </div>
      )}
    </div>
  );
}

/* ---- admin audit viewer ---- */

function AdminAuditPanel() {
  const [action, setAction] = useState("");
  const [actor, setActor] = useState("");
  const [applied, setApplied] = useState<{ action?: string; actor?: string }>({});

  const { data, isPending, isError, refetch } = useAdminAudit({
    action: applied.action || undefined,
    actor: applied.actor || undefined,
    limit: 50,
  });

  return (
    <Card>
      <CardHeader title="Admin audit log" />
      <CardBody>
        <form
          className="mb-4 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setApplied({ action: action.trim(), actor: actor.trim() });
          }}
        >
          <div className="flex-1 min-w-40">
            <Field label="Action">
              <Input
                value={action}
                onChange={(e) => setAction(e.target.value)}
                placeholder="admin.webhook_deliveries.retry"
              />
            </Field>
          </div>
          <div className="flex-1 min-w-40">
            <Field label="Actor">
              <Input value={actor} onChange={(e) => setActor(e.target.value)} placeholder="email contains…" />
            </Field>
          </div>
          <Button type="submit">Filter</Button>
        </form>

        {isPending ? (
          <Skeleton className="h-40 w-full" />
        ) : isError ? (
          <ErrorState message="Could not read the admin audit log." onRetry={() => refetch()} />
        ) : data!.rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-3">No audit entries match.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Actor</Th>
                <Th>Action</Th>
                <Th>Target</Th>
              </tr>
            </thead>
            <tbody>
              {data!.rows.map((r) => (
                <tr key={r.id}>
                  <Td className="whitespace-nowrap text-ink-3">{new Date(r.at).toLocaleString()}</Td>
                  <Td>{r.actor}</Td>
                  <Td className="font-mono text-[12px]">{r.action}</Td>
                  <Td className="text-ink-3">{r.targetType ? `${r.targetType}${r.targetId ? ` · ${r.targetId}` : ""}` : "—"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {data?.hasMore ? <p className="mt-3 text-xs text-ink-3">Showing the newest 50. Narrow the filter to see more.</p> : null}
      </CardBody>
    </Card>
  );
}

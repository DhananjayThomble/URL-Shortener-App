"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
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
  TableWrap,
  Td,
  Th,
} from "@/components/ui";
import { useAdminUpdateWorkspace, useAdminViewAs, useAdminWorkspace } from "@/lib/api/hooks";
import { plural } from "@/lib/plural";

/* #969 — the admin workspace detail page: members, usage this month, the
   manual plan/limit edit, and the read-only "view as". View-as is a separate
   fetch that the server records in the audit log each time it opens. */
export default function AdminWorkspaceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: ws, isPending, isError, error, refetch } = useAdminWorkspace(id);

  if (isError) {
    return (
      <ErrorState message={error instanceof Error ? error.message : "Couldn't load this workspace."} onRetry={() => refetch()} />
    );
  }
  if (isPending) {
    return (
      <div className="space-y-4" aria-hidden>
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href="/admin/workspaces" className="text-xs text-ink-3 hover:text-ink-1">
          ← Workspaces
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-ink-1">{ws.name}</h1>
        <p className="text-sm text-ink-3">
          /{ws.slug} · {ws.plan}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Clicks this month" value={`${ws.clicksThisMonth.toLocaleString()} / ${ws.clicksIncluded.toLocaleString()}`} />
        <Stat label="Links" value={String(ws.linkCount)} />
        <Stat label="Domains" value={String(ws.domainCount)} />
      </div>

      <PlanEditor id={id} plan={ws.plan} clicksIncluded={ws.clicksIncluded} />

      <Card>
        <CardHeader title={`Members (${ws.members.length})`} />
        <CardBody>
          {ws.members.length === 0 ? (
            <p className="text-sm text-ink-3">No members.</p>
          ) : (
            <TableWrap label="Workspace members">
              <Table>
                <thead>
                  <tr>
                    <Th>Email</Th>
                    <Th>Role</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {ws.members.map((m) => (
                    <tr key={`${m.email}-${m.role}`}>
                      <Td>
                        {m.userId ? (
                          <Link href={`/admin/users/${m.userId}`} className="text-ink-1 hover:underline">
                            {m.email}
                          </Link>
                        ) : (
                          m.email
                        )}
                      </Td>
                      <Td>
                        <Chip>{m.role}</Chip>
                      </Td>
                      <Td className="text-ink-3">{m.status}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          )}
        </CardBody>
      </Card>

      <ViewAsPanel id={id} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardBody>
        <div className="text-xs text-ink-3">{label}</div>
        <div className="mt-1 text-lg font-semibold text-ink-1">{value}</div>
      </CardBody>
    </Card>
  );
}

/* The manual plan/limit edit. Pre-filled from the workspace; saving sends only
   the fields that changed so an untouched field is left alone server-side. */
function PlanEditor({ id, plan, clicksIncluded }: { id: string; plan: string; clicksIncluded: number }) {
  const update = useAdminUpdateWorkspace();
  const [planValue, setPlanValue] = useState(plan);
  const [clicksValue, setClicksValue] = useState(String(clicksIncluded));
  const [notice, setNotice] = useState<string | null>(null);

  // Keep the inputs in step if the underlying workspace changes (e.g. after a
  // save invalidates and refetches).
  useEffect(() => {
    setPlanValue(plan);
    setClicksValue(String(clicksIncluded));
  }, [plan, clicksIncluded]);

  const dirty = planValue !== plan || clicksValue !== String(clicksIncluded);

  function save() {
    setNotice(null);
    const input: { id: string; plan?: string; clicksIncluded?: number } = { id };
    if (planValue !== plan) input.plan = planValue.trim();
    if (clicksValue !== String(clicksIncluded)) {
      const n = Number(clicksValue);
      if (!Number.isInteger(n) || n < 0) {
        setNotice("Included clicks must be a whole number of 0 or more.");
        return;
      }
      input.clicksIncluded = n;
    }
    update
      .mutateAsync(input)
      .then(() => setNotice("Saved."))
      .catch((e: unknown) => setNotice(e instanceof Error ? e.message : "Save failed."));
  }

  return (
    <Card>
      <CardHeader title="Plan and limits" />
      <CardBody className="space-y-4">
        <p className="text-sm text-ink-3">Plans are assigned by hand until billing exists.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Plan">
            <Input value={planValue} onChange={(e) => setPlanValue(e.target.value)} />
          </Field>
          <Field label="Included clicks">
            <Input
              type="number"
              min={0}
              value={clicksValue}
              onChange={(e) => setClicksValue(e.target.value)}
            />
          </Field>
        </div>
        <div className="flex items-center gap-3">
          <Button variant="primary" disabled={!dirty || update.isPending} onClick={save}>
            Save changes
          </Button>
          {notice ? (
            <span className="text-sm text-ink-2" role="status">
              {notice}
            </span>
          ) : null}
        </div>
      </CardBody>
    </Card>
  );
}

/* Read-only "view as". Opening the panel fetches the owner's view; the server
   records the access in the audit log. There is no control here that changes
   anything — it shows the workspace exactly as its owner would see it. */
function ViewAsPanel({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const { data, isPending, isError, error } = useAdminViewAs(id, { enabled: open });

  return (
    <Card>
      <CardHeader
        title="View as owner (read-only)"
        right={
          <Button disabled={open && isPending} onClick={() => setOpen(true)}>
            {open ? "Refresh view" : "Open view"}
          </Button>
        }
      />
      <CardBody>
        {!open ? (
          <p className="text-sm text-ink-3">
            See this workspace as its owner does. The view is read-only and each open is recorded in the audit log.
          </p>
        ) : isError ? (
          <p className="text-sm text-bad">{error instanceof Error ? error.message : "Couldn't load the view."}</p>
        ) : isPending || !data ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <div className="space-y-3">
            <Chip tone="warn" dot>
              Read-only view
            </Chip>
            <p className="text-sm text-ink-3">Recent links, as the owner's dashboard lists them.</p>
            {data.recentLinks.length === 0 ? (
              <p className="text-sm text-ink-3">No links yet.</p>
            ) : (
              <ul className="divide-y divide-line-1">
                {data.recentLinks.map((l) => (
                  <li key={l.id} className="py-2 text-sm">
                    <span className="font-medium text-ink-1">
                      {l.domain}/{l.slug}
                    </span>
                    <span className="ml-2 text-ink-3">→ {l.destination}</span>
                    <span className="ml-2 text-ink-3">· {plural(l.clicks, "click")}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </CardBody>
    </Card>
  );
}

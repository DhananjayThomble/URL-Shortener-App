"use client";

import { useState } from "react";
import type { AdminAbuseReportRow, AdminBlockedDomain, AdminCustomDomainRow, AdminFlaggedLinkRow, AdminLinkRow } from "@snapurl/contract";
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
  useActOnAbuseReport,
  useAddBlockedDomain,
  useAdminAbuseQueue,
  useAdminBlockedDomains,
  useAdminCustomDomains,
  useAdminDisableLink,
  useAdminFlaggedLinks,
  useAdminLinkSearch,
  useRemoveBlockedDomain,
} from "@/lib/api/hooks";

/* #971 — moderation and abuse.

   The platform-admin surface for abuse across the whole platform: the global
   abuse queue (including reports with no workspace), platform link search with
   a disable/enable toggle, the destination blocklist, the Safe Browsing flagged
   list and the custom-domain status list. Reaching this page means AdminGate
   confirmed the caller is a platform admin; the API re-checks on every request
   behind it, and records every write in the admin audit log. */

export default function AdminModerationPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink-1">Moderation and abuse</h1>
        <p className="mt-1 text-sm text-ink-3">
          Handle abuse across the platform. Disabling a link stops it redirecting; a blocked destination is refused on
          new and edited links. Every action here is recorded in the admin audit log.
        </p>
      </div>

      <AbuseQueuePanel />
      <LinkSearchPanel />
      <BlocklistPanel />
      <FlaggedLinksPanel />
      <CustomDomainsPanel />
    </div>
  );
}

/* ---- abuse queue ---- */

function AbuseQueuePanel() {
  const [orphanedOnly, setOrphanedOnly] = useState(false);
  const { data, isPending, isError, refetch } = useAdminAbuseQueue({
    orphaned: orphanedOnly ? true : undefined,
    limit: 50,
  });
  const act = useActOnAbuseReport();
  const toast = useToast();

  return (
    <Card>
      <CardHeader title="Abuse queue" />
      <CardBody>
        <label className="mb-3 flex items-center gap-2 text-sm text-ink-3">
          <input type="checkbox" checked={orphanedOnly} onChange={(e) => setOrphanedOnly(e.target.checked)} />
          Only reports with no workspace
        </label>

        {isPending ? (
          <Skeleton className="h-40 w-full" />
        ) : isError ? (
          <ErrorState message="Could not read the abuse queue." onRetry={() => refetch()} />
        ) : data!.rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-3">No reports match.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Slug</Th>
                <Th>Reason</Th>
                <Th>Workspace</Th>
                <Th>Status</Th>
                <Th>Action</Th>
              </tr>
            </thead>
            <tbody>
              {data!.rows.map((r: AdminAbuseReportRow) => (
                <tr key={r.id}>
                  <Td className="whitespace-nowrap text-ink-3">{new Date(r.createdAt).toLocaleString()}</Td>
                  <Td className="font-mono text-[12px]">{r.slug}</Td>
                  <Td className="max-w-xs truncate" title={r.reason}>{r.reason}</Td>
                  <Td className="text-ink-3">{r.workspaceName ?? (r.workspaceId ? r.workspaceId : "—")}</Td>
                  <Td><Chip tone={r.status === "open" ? "warn" : "default"}>{r.status}</Chip></Td>
                  <Td>
                    <div className="flex gap-2">
                      {r.linkId && !r.linkDisabled ? (
                        <Button
                          disabled={act.isPending}
                          onClick={() =>
                            act.mutate(
                              { id: r.id, input: { status: "actioned", disableLink: true } },
                              { onSuccess: () => toast.show({ message: "Link disabled and report actioned." }) },
                            )
                          }
                        >
                          Disable link
                        </Button>
                      ) : null}
                      {r.status === "open" ? (
                        <Button
                          variant="ghost"
                          disabled={act.isPending}
                          onClick={() =>
                            act.mutate(
                              { id: r.id, input: { status: "dismissed" } },
                              { onSuccess: () => toast.show({ message: "Report dismissed." }) },
                            )
                          }
                        >
                          Dismiss
                        </Button>
                      ) : null}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </CardBody>
    </Card>
  );
}

/* ---- platform link search ---- */

function LinkSearchPanel() {
  const [term, setTerm] = useState("");
  const [applied, setApplied] = useState("");
  const { data, isPending, isError, refetch } = useAdminLinkSearch({ q: applied || undefined, limit: 50 });
  const disable = useAdminDisableLink();
  const toast = useToast();

  return (
    <Card>
      <CardHeader title="Link search" />
      <CardBody>
        <form
          className="mb-4 flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setApplied(term.trim());
          }}
        >
          <div className="flex-1">
            <Field label="Search by slug, destination or owner">
              <Input value={term} onChange={(e) => setTerm(e.target.value)} placeholder="phishing.example or owner@…" />
            </Field>
          </div>
          <Button type="submit">Search</Button>
        </form>

        {isPending ? (
          <Skeleton className="h-40 w-full" />
        ) : isError ? (
          <ErrorState message="Could not search links." onRetry={() => refetch()} />
        ) : data!.rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-3">No links match.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Link</Th>
                <Th>Destination</Th>
                <Th>Owner</Th>
                <Th>State</Th>
                <Th>Action</Th>
              </tr>
            </thead>
            <tbody>
              {data!.rows.map((r: AdminLinkRow) => (
                <tr key={r.id}>
                  <Td className="font-mono text-[12px]">{r.domain}/{r.slug}</Td>
                  <Td className="max-w-xs truncate" title={r.destination}>{r.destination}</Td>
                  <Td className="text-ink-3">{r.owner ?? r.workspaceName ?? "—"}</Td>
                  <Td>
                    {r.disabled ? <Chip tone="bad">disabled</Chip> : <Chip tone="good">live</Chip>}
                    {r.safeBrowsingStatus === "flagged" ? <Chip tone="warn">flagged</Chip> : null}
                  </Td>
                  <Td>
                    <Button
                      variant={r.disabled ? "ghost" : "default"}
                      disabled={disable.isPending}
                      onClick={() =>
                        disable.mutate(
                          { id: r.id, input: { disabled: !r.disabled } },
                          { onSuccess: () => toast.show({ message: r.disabled ? "Link enabled." : "Link disabled." }) },
                        )
                      }
                    >
                      {r.disabled ? "Enable" : "Disable"}
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </CardBody>
    </Card>
  );
}

/* ---- destination blocklist ---- */

function BlocklistPanel() {
  const { data, isPending, isError, refetch } = useAdminBlockedDomains();
  const add = useAddBlockedDomain();
  const remove = useRemoveBlockedDomain();
  const toast = useToast();
  const [domain, setDomain] = useState("");
  const [reason, setReason] = useState("");

  return (
    <Card>
      <CardHeader title="Destination blocklist" />
      <CardBody>
        <form
          className="mb-4 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            add.mutate(
              { domain: domain.trim(), reason: reason.trim() || undefined },
              {
                onSuccess: () => {
                  toast.show({ message: `Blocked ${domain.trim()}.` });
                  setDomain("");
                  setReason("");
                },
                onError: (err) => toast.show({ message: err instanceof Error ? err.message : "Could not block that domain." }),
              },
            );
          }}
        >
          <div className="min-w-48 flex-1">
            <Field label="Domain">
              <Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="evil.example" />
            </Field>
          </div>
          <div className="min-w-48 flex-1">
            <Field label="Reason (optional)">
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="phishing" />
            </Field>
          </div>
          <Button type="submit" disabled={add.isPending || domain.trim().length === 0}>
            Block
          </Button>
        </form>

        {isPending ? (
          <Skeleton className="h-28 w-full" />
        ) : isError ? (
          <ErrorState message="Could not read the blocklist." onRetry={() => refetch()} />
        ) : data!.domains.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-3">No domains are blocked.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Domain</Th>
                <Th>Reason</Th>
                <Th>Added by</Th>
                <Th>Action</Th>
              </tr>
            </thead>
            <tbody>
              {data!.domains.map((d: AdminBlockedDomain) => (
                <tr key={d.id}>
                  <Td className="font-mono text-[12px]">{d.domain}</Td>
                  <Td className="text-ink-3">{d.reason ?? "—"}</Td>
                  <Td className="text-ink-3">{d.addedBy}</Td>
                  <Td>
                    <Button
                      variant="ghost"
                      disabled={remove.isPending}
                      onClick={() =>
                        remove.mutate(d.id, { onSuccess: () => toast.show({ message: `Unblocked ${d.domain}.` }) })
                      }
                    >
                      Remove
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </CardBody>
    </Card>
  );
}

/* ---- Safe Browsing flagged list ---- */

function FlaggedLinksPanel() {
  const { data, isPending, isError, refetch } = useAdminFlaggedLinks();

  return (
    <Card>
      <CardHeader title="Flagged by Safe Browsing" />
      <CardBody>
        {isPending ? (
          <Skeleton className="h-28 w-full" />
        ) : isError ? (
          <ErrorState message="Could not read the flagged links." onRetry={() => refetch()} />
        ) : data!.rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-3">No links are flagged.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Link</Th>
                <Th>Destination</Th>
                <Th>Checked</Th>
                <Th>State</Th>
              </tr>
            </thead>
            <tbody>
              {data!.rows.map((r: AdminFlaggedLinkRow) => (
                <tr key={r.id}>
                  <Td className="font-mono text-[12px]">{r.domain}/{r.slug}</Td>
                  <Td className="max-w-xs truncate" title={r.destination}>{r.destination}</Td>
                  <Td className="whitespace-nowrap text-ink-3">{r.checkedAt ? new Date(r.checkedAt).toLocaleString() : "—"}</Td>
                  <Td>{r.disabled ? <Chip tone="bad">disabled</Chip> : <Chip tone="warn">flagged</Chip>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </CardBody>
    </Card>
  );
}

/* ---- custom-domain status list ---- */

function CustomDomainsPanel() {
  const { data, isPending, isError, refetch } = useAdminCustomDomains();

  return (
    <Card>
      <CardHeader title="Custom domains" />
      <CardBody>
        {isPending ? (
          <Skeleton className="h-28 w-full" />
        ) : isError ? (
          <ErrorState message="Could not read the custom domains." onRetry={() => refetch()} />
        ) : data!.rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-3">No custom domains.</p>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Domain</Th>
                <Th>Workspace</Th>
                <Th>Verification</Th>
                <Th>SSL</Th>
              </tr>
            </thead>
            <tbody>
              {data!.rows.map((r: AdminCustomDomainRow) => (
                <tr key={r.id}>
                  <Td className="font-mono text-[12px]">{r.domain}</Td>
                  <Td className="text-ink-3">{r.workspaceName ?? "—"}</Td>
                  <Td><Chip tone={r.status === "live" ? "good" : "warn"}>{r.status}</Chip></Td>
                  <Td><Chip tone={r.ssl === "issued" || r.ssl === "active" ? "good" : "warn"}>{r.ssl}</Chip></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </CardBody>
    </Card>
  );
}

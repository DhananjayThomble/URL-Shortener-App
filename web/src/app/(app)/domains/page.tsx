"use client";

import { useState } from "react";
import { PageHead } from "@/components/app-shell";
import { Button, Card, CardBody, CardHeader, Chip, Field, Input, Skeleton, Table, TableWrap, Td, Th } from "@/components/ui";
import { useAddDomain, useDeleteDomain, useDomains, useVerifyDomain } from "@/lib/api/hooks";
import { AddDomainInput } from "@snapurl/contract";
import { formatDate, full } from "@/lib/utils";

export default function DomainsPage() {
  const { data, isLoading } = useDomains();
  const addDomain = useAddDomain();
  const verifyDomain = useVerifyDomain();
  const deleteDomain = useDeleteDomain();

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);

  const domains = data ?? [];
  const pending = domains.find((d) => d.status === "verifying");

  async function add() {
    const parsed = AddDomainInput.safeParse({ domain: name.trim() });
    if (!parsed.success) {
      setProblem(parsed.error.issues[0]?.message ?? "That doesn't look like a domain name.");
      return;
    }
    try {
      await addDomain.mutateAsync(parsed.data);
      setName("");
      setAdding(false);
      setProblem(null);
    } catch (err) {
      setProblem((err as Error).message);
    }
  }

  async function verify(id: string) {
    setProblem(null);
    try {
      await verifyDomain.mutateAsync(id);
    } catch (err) {
      // The usual failure is "the TXT record isn't there yet", which is
      // information rather than an error — show it where it was asked for.
      setProblem((err as Error).message);
    }
  }

  async function disconnect(id: string) {
    setProblem(null);
    try {
      await deleteDomain.mutateAsync(id);
      setConfirming(null);
    } catch (err) {
      setProblem((err as Error).message);
      setConfirming(null);
    }
  }

  return (
    <>
      <PageHead
        title="Domains"
        sub="Bring your own domain. SSL is issued automatically and renews itself."
        actions={
          <Button variant="primary" onClick={() => { setAdding((a) => !a); setProblem(null); }}>
            {adding ? "Cancel" : "＋ Add domain"}
          </Button>
        }
      />

      {adding ? (
        <Card className="mb-3.5">
          <CardHeader title="Add a domain" />
          <CardBody className="flex flex-col gap-3">
            <Field
              label="Domain"
              help="Add it here first, then create the DNS record we show you. Nothing resolves until it verifies."
              error={problem ?? undefined}
            >
              <Input
                value={name}
                autoFocus
                placeholder="go.example.com"
                className="font-mono text-[12.5px]"
                onChange={(e) => { setName(e.target.value); setProblem(null); }}
                onKeyDown={(e) => { if (e.key === "Enter") void add(); }}
              />
            </Field>
            <div className="flex gap-2">
              <Button variant="primary" onClick={add} disabled={addDomain.isPending || !name.trim()}>
                {addDomain.isPending ? "Adding…" : "Add domain"}
              </Button>
              <Button onClick={() => { setAdding(false); setProblem(null); }}>Cancel</Button>
            </div>
          </CardBody>
        </Card>
      ) : null}

      {problem && !adding ? (
        <Card className="mb-3.5 border-bad">
          <CardBody className="text-[13px] text-bad">{problem}</CardBody>
        </Card>
      ) : null}

      <Card className="mb-3.5">
        {isLoading ? (
          <CardBody>
            <Skeleton className="h-[160px]" />
          </CardBody>
        ) : (
          <TableWrap>
            <Table>
              <thead>
                <tr>
                  <Th>Domain</Th>
                  <Th>Status</Th>
                  <Th>SSL</Th>
                  <Th>Links</Th>
                  <Th>Root redirect</Th>
                  <Th>404 redirect</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {domains.map((d) => (
                  <tr key={d.id}>
                    <Td className="text-ink font-medium font-mono">{d.domain}</Td>
                    <Td>
                      <Chip tone={d.status === "live" ? "good" : "warn"} dot>
                        {d.status === "live" ? "Live" : "Verifying DNS"}
                      </Chip>
                    </Td>
                    <Td>
                      <Chip tone={d.ssl === "active" ? "good" : "warn"}>
                        {d.ssl === "active" && d.sslRenewsAt ? `Auto · renews ${formatDate(d.sslRenewsAt)}` : "Pending"}
                      </Chip>
                    </Td>
                    <Td className="tnum">{full(d.links)}</Td>
                    <Td className="font-mono text-[12px]">
                      {d.rootRedirect ?? <span className="text-ink-3">— not set</span>}
                    </Td>
                    <Td className="font-mono text-[12px]">
                      {d.notFoundRedirect ?? <span className="text-ink-3">— not set</span>}
                    </Td>
                    <Td className="text-right whitespace-nowrap">
                      {d.status !== "live" ? (
                        <Button size="sm" variant="ghost" onClick={() => verify(d.id)} disabled={verifyDomain.isPending}>
                          {verifyDomain.isPending ? "Checking…" : "Check DNS"}
                        </Button>
                      ) : null}
                      {confirming === d.id ? (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                            Keep
                          </Button>
                          <Button size="sm" variant="danger" onClick={() => disconnect(d.id)} disabled={deleteDomain.isPending}>
                            Disconnect
                          </Button>
                        </>
                      ) : (
                        <Button size="sm" variant="ghost" onClick={() => { setConfirming(d.id); setProblem(null); }}>
                          Disconnect
                        </Button>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </Card>

      {confirming ? (
        <Card className="mb-3.5">
          <CardBody className="text-[13px] text-ink-2 leading-[1.6]">
            <b className="text-ink">Disconnecting a domain stops every link on it.</b> Printed codes and shared URLs
            using it will 404 immediately. The links themselves are not deleted, but nothing resolves to them until the
            domain is connected again. The shared short domain belongs to everyone and cannot be disconnected.
          </CardBody>
        </Card>
      ) : null}

      {pending?.dns ? (
        <Card>
          <CardHeader
            title={`Finish setting up ${pending.domain}`}
            right={
              <div className="flex items-center gap-2">
                <Chip tone="warn">1 step left</Chip>
                <Button size="sm" onClick={() => verify(pending.id)} disabled={verifyDomain.isPending}>
                  {verifyDomain.isPending ? "Checking…" : "Check now"}
                </Button>
              </div>
            }
          />
          <CardBody>
            <p className="m-0 mb-3.5 text-[13.5px] text-ink-2">
              Add this record at your DNS provider, then check again. DNS changes can take a few minutes to propagate.
            </p>
            <TableWrap>
              <Table className="min-w-[420px]">
                <thead>
                  <tr>
                    <Th>Type</Th>
                    <Th>Name</Th>
                    <Th>Value</Th>
                    <Th>TTL</Th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <Td className="text-ink font-medium font-mono">{pending.dns.type}</Td>
                    <Td className="font-mono">{pending.dns.name}</Td>
                    <Td className="font-mono text-accent">{pending.dns.value}</Td>
                    <Td className="font-mono">{pending.dns.ttl}</Td>
                  </tr>
                </tbody>
              </Table>
            </TableWrap>
          </CardBody>
        </Card>
      ) : null}
    </>
  );
}

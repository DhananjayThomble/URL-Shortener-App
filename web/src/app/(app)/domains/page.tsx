"use client";

import { PageHead } from "@/components/app-shell";
import { Button, Card, CardBody, CardHeader, Chip, Skeleton, Table, TableWrap, Td, Th } from "@/components/ui";
import { useDomains } from "@/lib/api/hooks";
import { formatDate, full } from "@/lib/utils";

export default function DomainsPage() {
  const { data, isLoading } = useDomains();
  const domains = data ?? [];
  const pending = domains.find((d) => d.status === "verifying");

  return (
    <>
      <PageHead
        title="Domains"
        sub="Bring your own domain. SSL is issued automatically and renews itself."
        actions={<Button variant="primary">＋ Add domain</Button>}
      />

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
                    <Td className="text-right">
                      <Button size="sm" variant="ghost">
                        Manage
                      </Button>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </Card>

      {pending?.dns ? (
        <Card>
          <CardHeader title={`Finish setting up ${pending.domain}`} right={<Chip tone="warn">1 step left</Chip>} />
          <CardBody>
            <p className="m-0 mb-3.5 text-[13.5px] text-ink-2">
              Add this record at your DNS provider. We check every 30 seconds and issue the certificate as soon as it
              resolves.
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

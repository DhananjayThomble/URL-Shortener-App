"use client";

import { useRef, useState } from "react";
import { PageHead } from "@/components/app-shell";
import { Button, Card, CardBody, CardHeader, Chip, Field, Input, Skeleton, Table, TableWrap, Td, Th } from "@/components/ui";
import { useAddDomain, useDeleteDomain, useDomains, useMe, useUpdateDomain, useVerifyDomain } from "@/lib/api/hooks";
import { AddDomainInput, type Domain } from "@snapurl/contract";
import { full } from "@/lib/utils";
import { canEditDomainRedirects, parseRedirectDraft, type RedirectErrors } from "@/lib/domain-redirects";
import { canDisconnectDomain, domainSslView, domainStatusView } from "@/lib/domain-state";
import { dnsSteps } from "@/lib/domain-dns";
import { DnsSetupCard } from "@/components/domains/dns-setup-card";

/**
 * Edit a domain's root and 404 redirects (#648).
 *
 * Validated with the contract's UpdateDomainInput before anything is sent, so
 * the per-field messages here are the same rules the API enforces (http(s)
 * only, no private / loopback / link-local hosts). A blank field is sent as
 * `null`, which clears that redirect.
 */
function RedirectsEditor({ domain, onClose }: { domain: Domain; onClose: (saved: boolean) => void }) {
  const update = useUpdateDomain();
  const [root, setRoot] = useState(domain.rootRedirect ?? "");
  const [notFound, setNotFound] = useState(domain.notFoundRedirect ?? "");
  const [errors, setErrors] = useState<RedirectErrors>({});

  async function save() {
    const result = parseRedirectDraft(root, notFound);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    try {
      await update.mutateAsync({ id: domain.id, input: result.input });
      onClose(true);
    } catch (err) {
      setErrors({ form: (err as Error).message });
    }
  }

  return (
    <Card className="mb-3.5" role="region" aria-label={`Redirects for ${domain.domain}`}>
      <CardHeader title={`Redirects for ${domain.domain}`} />
      <CardBody>
        <form
          className="flex flex-col gap-3"
          noValidate
          onSubmit={(e) => { e.preventDefault(); void save(); }}
          onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); onClose(false); } }}
        >
          <Field
            label="Root redirect"
            help={`Where a visitor to ${domain.domain}/ with no slug goes. Leave blank to clear.`}
            error={errors.rootRedirect}
          >
            <Input
              name="rootRedirect"
              type="url"
              inputMode="url"
              autoFocus
              value={root}
              placeholder="https://example.com/"
              className="font-mono text-[12.5px]"
              onChange={(e) => { setRoot(e.target.value); setErrors((x) => ({ ...x, rootRedirect: undefined, form: undefined })); }}
            />
          </Field>
          <Field
            label="404 redirect"
            help="Where a slug that doesn't exist on this domain goes. Leave blank to clear."
            error={errors.notFoundRedirect}
          >
            <Input
              name="notFoundRedirect"
              type="url"
              inputMode="url"
              value={notFound}
              placeholder="https://example.com/not-found"
              className="font-mono text-[12.5px]"
              onChange={(e) => { setNotFound(e.target.value); setErrors((x) => ({ ...x, notFoundRedirect: undefined, form: undefined })); }}
            />
          </Field>
          {errors.form ? (
            <p role="alert" className="m-0 text-[12.5px] text-bad">{errors.form}</p>
          ) : null}
          <div className="flex gap-2">
            <Button variant="primary" type="submit" disabled={update.isPending}>
              {update.isPending ? "Saving…" : "Save redirects"}
            </Button>
            <Button type="button" onClick={() => onClose(false)}>Cancel</Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}

export default function DomainsPage() {
  const { data, isLoading } = useDomains();
  const addDomain = useAddDomain();
  const verifyDomain = useVerifyDomain();
  const deleteDomain = useDeleteDomain();
  const { data: me } = useMe();
  // The API refuses a redirect change below admin; don't offer it (#711 review).
  const canEditRedirects = canEditDomainRedirects(me?.role);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const editButtons = useRef(new Map<string, HTMLButtonElement>());

  const domains = data ?? [];
  const pendingDomains = domains.filter((d) => d.status === "verifying" && dnsSteps(d).length > 0);
  const editingDomain = domains.find((d) => d.id === editing && !d.shared && canEditRedirects);

  function closeEditor() {
    const id = editing;
    setEditing(null);
    // Return focus to the control that opened the editor.
    if (id) requestAnimationFrame(() => editButtons.current.get(id)?.focus());
  }

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
    // Belt and braces: the shared domain has no Disconnect control, but never
    // send the request for it even if a stale confirm state points at it.
    const target = domains.find((d) => d.id === id);
    if (target && !canDisconnectDomain(target)) {
      setConfirming(null);
      return;
    }
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
              <Button aria-label="Cancel adding a domain" onClick={() => { setAdding(false); setProblem(null); }}>Cancel</Button>
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
          <TableWrap label="Domains">
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
                    <Td className="text-ink font-medium font-mono">
                      {d.domain}
                      {d.shared ? (
                        <Chip className="ml-2 font-sans">Shared</Chip>
                      ) : null}
                    </Td>
                    <Td>
                      <Chip tone={domainStatusView(d).tone} dot>
                        {domainStatusView(d).label}
                      </Chip>
                    </Td>
                    <Td>
                      <Chip tone={domainSslView(d).tone}>{domainSslView(d).label}</Chip>
                    </Td>
                    <Td className="tnum">{full(d.links)}</Td>
                    <Td className="font-mono text-[12px]">
                      {d.rootRedirect ?? <span className="text-ink-3">— not set</span>}
                    </Td>
                    <Td className="font-mono text-[12px]">
                      {d.notFoundRedirect ?? <span className="text-ink-3">— not set</span>}
                    </Td>
                    <Td className="text-right whitespace-nowrap">
                      {!d.shared && canEditRedirects ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          ref={(el) => { if (el) editButtons.current.set(d.id, el); else editButtons.current.delete(d.id); }}
                          aria-label={`Edit redirects for ${d.domain}`}
                          aria-expanded={editing === d.id}
                          onClick={() => { setEditing((cur) => (cur === d.id ? null : d.id)); setProblem(null); }}
                        >
                          Edit redirects
                        </Button>
                      ) : null}
                      {d.status !== "live" ? (
                        <Button size="sm" variant="ghost" onClick={() => verify(d.id)} disabled={verifyDomain.isPending}>
                          {verifyDomain.isPending ? "Checking…" : "Check DNS"}
                        </Button>
                      ) : null}
                      {!canDisconnectDomain(d) ? (
                        // The API refuses this with a 409; say why instead of offering it.
                        <span
                          className="text-[12px] text-ink-3"
                          title="This domain is shared by every workspace and managed by SnapURL."
                        >
                          Can't be disconnected
                        </span>
                      ) : confirming === d.id ? (
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

      {editingDomain ? (
        <RedirectsEditor key={editingDomain.id} domain={editingDomain} onClose={closeEditor} />
      ) : null}

      {confirming ? (
        <Card className="mb-3.5">
          <CardBody className="text-[13px] text-ink-2 leading-[1.6]">
            <b className="text-ink">Disconnecting a domain stops every link on it.</b> Printed codes and shared URLs
            using it will 404 immediately. The links themselves are not deleted, but nothing resolves to them until the
            domain is connected again.
          </CardBody>
        </Card>
      ) : null}

      {/* Every domain still waiting on DNS gets its own setup card (#784) —
          not just the first — with both records and a Copy on each value. */}
      {pendingDomains.map((d) => (
        <DnsSetupCard key={d.id} domain={d} checking={verifyDomain.isPending} onCheck={() => verify(d.id)} />
      ))}
    </>
  );
}

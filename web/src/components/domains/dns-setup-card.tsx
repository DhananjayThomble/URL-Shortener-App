"use client";

import { useEffect, useRef, useState } from "react";
import type { Domain } from "@snapurl/contract";
import { Button, Card, CardBody, CardHeader, Chip } from "@/components/ui";
import { dnsSteps } from "@/lib/domain-dns";
import { copy } from "@/lib/utils";

/**
 * The "Finish setting up <domain>" card on /domains (#784).
 *
 * Shows every DNS record the customer has to create — the TXT ownership proof
 * and the record that points traffic at SnapURL — as labelled steps, with a
 * Copy button on each Name and Value. A record is laid out as a definition
 * list rather than a table so a 45-character token wraps inside the card on a
 * phone instead of pushing the page sideways.
 *
 * Copy reports what happened: "Copied" on the button and in a live region on
 * success, an alert when the browser refuses (http:// origins, some webviews).
 * The values are plain selectable text either way.
 */
export function DnsSetupCard({
  domain,
  checking,
  onCheck,
}: {
  domain: Domain;
  checking: boolean;
  onCheck: () => void;
}) {
  const steps = dnsSteps(domain);
  const [copied, setCopied] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  async function copyValue(id: string, text: string) {
    if (timer.current) clearTimeout(timer.current);
    const ok = await copy(text);
    setFailed(!ok);
    setCopied(ok ? id : null);
    if (ok) timer.current = setTimeout(() => setCopied(null), 2000);
  }

  if (steps.length === 0) return null;
  const count = steps.length;
  const copiedLabel = steps.flatMap((s) => [
    { id: `${s.key}-name`, label: `${s.record.type} name` },
    { id: `${s.key}-value`, label: `${s.record.type} value` },
  ]).find((f) => f.id === copied)?.label;

  return (
    <Card className="mb-3.5" role="region" aria-label={`Finish setting up ${domain.domain}`}>
      <CardHeader
        title={`Finish setting up ${domain.domain}`}
        right={
          <div className="flex items-center gap-2">
            <Chip tone="warn">{count === 1 ? "1 record to add" : `${count} records to add`}</Chip>
            <Button size="sm" onClick={onCheck} disabled={checking}>
              {checking ? "Checking…" : "Check now"}
            </Button>
          </div>
        }
      />
      <CardBody>
        <p className="m-0 mb-3.5 text-[13.5px] text-ink-2">
          {count === 1 ? "Add this record" : "Add these records"} at your DNS provider, then check again. DNS changes
          can take a few minutes to propagate.
        </p>

        <div className="flex flex-col gap-4">
          {steps.map((step, i) => (
            <section key={step.key} aria-labelledby={`dns-${domain.id}-${step.key}`}>
              <h4 id={`dns-${domain.id}-${step.key}`} className="m-0 text-[13px] font-bold text-ink">
                Step {i + 1} · {step.title}
              </h4>
              <p className="m-0 mt-0.5 mb-2 text-[12.5px] text-ink-2">{step.help}</p>
              <dl className="m-0 grid grid-cols-[max-content_minmax(0,1fr)] items-center gap-x-4 gap-y-2 rounded-[var(--radius-sm)] border border-line bg-surface-2 p-3 text-[12.5px]">
                <dt className="text-ink-3">Type</dt>
                <dd className="m-0 font-mono font-medium text-ink">{step.record.type}</dd>
                {(["name", "value"] as const).map((field) => {
                  const id = `${step.key}-${field}`;
                  const text = step.record[field];
                  return (
                    <div key={field} className="contents">
                      <dt className="text-ink-3">{field === "name" ? "Name" : "Value"}</dt>
                      <dd className="m-0 flex min-w-0 items-center gap-2">
                        <code className="min-w-0 break-all font-mono text-ink select-all">{text}</code>
                        <Button
                          size="sm"
                          className="shrink-0"
                          aria-label={`Copy ${step.record.type} ${field} for ${domain.domain}`}
                          onClick={() => void copyValue(id, text)}
                        >
                          {copied === id ? "Copied" : "Copy"}
                        </Button>
                      </dd>
                    </div>
                  );
                })}
                <dt className="text-ink-3">TTL</dt>
                <dd className="m-0 font-mono text-ink">{step.record.ttl}</dd>
              </dl>
              {step.note ? <p className="m-0 mt-2 text-[12.5px] leading-[1.55] text-ink-2">{step.note}</p> : null}
            </section>
          ))}
        </div>

        <p role="status" className="sr-only">{copiedLabel ? `Copied ${copiedLabel}` : ""}</p>
        {failed ? (
          <p role="alert" className="m-0 mt-3 text-[12.5px] text-bad">
            Couldn&apos;t copy to the clipboard from this browser. Select the value and copy it manually.
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}

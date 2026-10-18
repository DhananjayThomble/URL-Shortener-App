"use client";

import { useMemo, useRef, useState } from "react";
import { Button, Card, CardBody, CardHeader, Chip, Field } from "@/components/ui";
import { useBulkCreateLinks, useDomains } from "@/lib/api/hooks";
import { parseBulkRows, parseRows, summarizeBulkResult, type BulkReport } from "@/lib/bulk-create-rows";
import { friendlyApiMessage, type CreateLinkInput } from "@snapurl/contract";

const MAX_ROWS = 100;

const TEXTAREA_CLASS =
  "w-full px-[11px] py-[9px] rounded-[var(--radius-sm)] bg-surface-2 border border-line-2 text-[12.5px] text-ink font-mono " +
  "placeholder:text-ink-3 focus:outline-none focus:border-accent focus:bg-surface focus:ring-[3px] focus:ring-accent-wash";

export function BulkCreatePanel({ onClose }: { onClose: () => void }) {
  const { data: domains } = useDomains();
  const bulk = useBulkCreateLinks();

  const [text, setText] = useState("");
  const [domain, setDomain] = useState("");
  const [report, setReport] = useState<BulkReport | null>(null);
  /* A ref, not just `bulk.isPending`: two clicks (or a click and Enter on the
     focused button) in the same tick both run before React has re-rendered the
     button as disabled, and each would send the batch. */
  const inFlight = useRef(false);

  const rows = useMemo(() => parseRows(text), [text]);
  const chosenDomain = domain || domains?.[0]?.domain || "";
  const tooMany = rows.length > MAX_ROWS;

  async function submit() {
    if (inFlight.current || !rows.length || !chosenDomain || tooMany) return;
    inFlight.current = true;
    // The batch is read once, here: what is sent and what the response is
    // matched against (by position) are the same rows, even if the box changes.
    const batch = parseBulkRows(text);
    // The rest of CreateLinkInput's defaults are applied by the server; only
    // what a row can actually express is sent. No redirectType: the server
    // gives an omitted one the workspace's Default redirect type (#753).
    const links = batch.map(
      (r) =>
        ({
          destination: r.destination,
          domain: chosenDomain,
          ...(r.slug ? { slug: r.slug } : {}),
          tags: [],
          rules: [],
          forwardQuery: true,
          deepLink: false,
          hideReferrer: false,
          publicPreview: true,
        }) as CreateLinkInput,
    );
    try {
      const result = await bulk.mutateAsync(links);
      /* #755: put back into the box only the rows that did not come back
         created. Resending a created row is not safe — the server can only
         recognise it by its back-half, and a row without one gets a new random
         back-half every time, i.e. a second link. */
      const next = summarizeBulkResult(batch, result.results);
      setText(next.text);
      setReport(next.report);
    } catch {
      /* surfaced below via bulk.error. The box is left as it was: nothing is
         known to have been created, so sending it again is the right retry. */
    } finally {
      inFlight.current = false;
    }
  }

  return (
    <Card className="mb-3.5">
      <CardHeader
        title="Bulk create"
        right={
          <Chip tone={tooMany ? "bad" : "default"}>
            {rows.length} of {MAX_ROWS}
          </Chip>
        }
      />
      <CardBody className="flex flex-col gap-3">
        <Field
          label="One link per line"
          help="Add a comma, then a space, then a back-half to choose one — otherwise we generate it. Only a comma followed by a space and a slug-shaped back-half (letters, numbers, dots, dashes or underscores) is treated that way, so a destination with commas in its query string is safe."
          error={tooMany ? `That's ${rows.length} rows. Split it into batches of ${MAX_ROWS}.` : undefined}
        >
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            readOnly={bulk.isPending}
            rows={8}
            spellCheck={false}
            placeholder={"https://acme.com/spring\nhttps://acme.com/summer, summer-sale\nhttps://acme.com/pricing?ref=a, pricing"}
            className={TEXTAREA_CLASS}
          />
        </Field>

        <div className="flex items-end gap-3 flex-wrap">
          <Field label="Domain">
            <select
              value={chosenDomain}
              onChange={(e) => setDomain(e.target.value)}
              className="inline-flex items-center px-[10px] py-[8px] bg-surface border border-line-2 rounded-[var(--radius-sm)] text-[12.5px] text-ink"
            >
              {(domains ?? []).map((d) => (
                <option key={d.id} value={d.domain}>
                  {d.domain}
                </option>
              ))}
            </select>
          </Field>
          <Button variant="primary" onClick={submit} disabled={bulk.isPending || !rows.length || tooMany}>
            {bulk.isPending ? "Creating…" : `Create ${rows.length || ""} link${rows.length === 1 ? "" : "s"}`}
          </Button>
          <Button onClick={onClose}>Close</Button>
        </div>

        {bulk.error ? (
          <p className="text-[12.5px] text-bad" role="alert">
            {(bulk.error as Error).message}
          </p>
        ) : null}

        {report ? (
          <>
            {/* The point of the whole feature: every submitted row gets a line,
                so nothing is ever silently dropped. Each row's outcome is
                independent — a bad row elsewhere in the batch never prevents
                a good row from being created, so this no longer claims
                all-or-nothing. Created rows are taken out of the box above
                (#755), so what is left there is exactly what a second submit
                will send. */}
            <p className="text-[12.5px] text-ink-2 m-0" role="status">
              {report.created > 0 ? (
                <>
                  <b className="text-good">{report.created} created.</b> They are in the list below.
                  {report.failed > 0
                    ? ` ${report.failed} ${report.failed === 1 ? "row didn't" : "rows didn't"} go through. ${
                        report.failed === 1 ? "It stays" : "They stay"
                      } in the box above — fix ${report.failed === 1 ? "it" : "them"} and submit again. The created links won't be sent again.`
                    : ""}
                </>
              ) : (
                <>
                  <b className="text-bad">Nothing was created.</b> Fix the rows in the box above and submit again — rows
                  that already exist won't be duplicated.
                </>
              )}
            </p>
            <ol className="flex flex-col gap-[6px] m-0 p-0 list-none max-h-[260px] overflow-y-auto">
              {report.items.map((item, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2 text-[12px] border border-line rounded-[var(--radius-sm)] px-[10px] py-[7px] bg-surface-2"
                >
                  <span className={item.kind === "created" ? "text-good" : "text-bad"} aria-hidden="true">
                    {item.kind === "created" ? "✓" : "✗"}
                  </span>
                  {item.kind === "created" ? (
                    <span className="font-mono text-ink truncate">
                      <span className="sr-only">Created: </span>
                      {item.domain}/{item.slug}
                    </span>
                  ) : (
                    <>
                      <span className="text-ink-3 tnum shrink-0">
                        <span className="sr-only">Not created, </span>Line {item.line}
                      </span>
                      <span className="min-w-0">
                        <span className="font-mono text-ink-2 block truncate">{item.destination}</span>
                        {/* friendlyApiMessage: a row error from an older API still carries `destination: `. */}
                        <span className="text-bad">{friendlyApiMessage(item.error)}</span>
                      </span>
                    </>
                  )}
                </li>
              ))}
            </ol>
          </>
        ) : null}
      </CardBody>
    </Card>
  );
}

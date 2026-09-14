"use client";

import { useMemo, useRef, useState } from "react";
import { Button, Card, CardBody, CardHeader, Chip, Field } from "@/components/ui";
import { useBulkCreateLinks, useDomains } from "@/lib/api/hooks";
import type { BulkLinkOutcome } from "@snapurl/contract";
import { IMPORT_SOURCES, getImportSource } from "@/lib/import";
import { chunk, prepareRows, type PreparedRow } from "@/lib/import/to-links";
import type { ParseResult } from "@/lib/import/types";

const TEXTAREA_CLASS =
  "w-full px-[11px] py-[9px] rounded-[var(--radius-sm)] bg-surface-2 border border-line-2 text-[12.5px] text-ink font-mono " +
  "placeholder:text-ink-3 focus:outline-none focus:border-accent focus:bg-surface focus:ring-[3px] focus:ring-accent-wash";

const SELECT_CLASS =
  "inline-flex items-center px-[10px] py-[8px] bg-surface border border-line-2 rounded-[var(--radius-sm)] text-[12.5px] text-ink";

type Aggregate = {
  created: number;
  /** Rows the server skipped because the requested back-half already exists. */
  skipped: number;
  /** Rows that failed for any other reason. */
  failed: number;
  outcomes: BulkLinkOutcome[];
};

/** A server row error naming a taken back-half is the approved Q1 "skip"
 *  outcome, shown apart from genuine failures. Matches the server's phrasing
 *  ("already taken" / "already asks for"). */
function isCollision(error: string): boolean {
  return /already taken|already asks for|already exists/i.test(error);
}

export function ImportPanel({ onClose }: { onClose: () => void }) {
  const { data: domains } = useDomains();
  const bulk = useBulkCreateLinks();
  const fileRef = useRef<HTMLInputElement>(null);

  const [sourceId, setSourceId] = useState(IMPORT_SOURCES[0]!.id);
  const [domain, setDomain] = useState("");
  const [text, setText] = useState("");
  const [result, setResult] = useState<Aggregate | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  const source = getImportSource(sourceId)!;
  const chosenDomain = domain || domains?.[0]?.domain || "";

  const parsed: ParseResult = useMemo(
    () => (text.trim() ? source.parse(text) : { rows: [], dropped: [], errors: [] }),
    [text, source],
  );
  const prepared: PreparedRow[] = useMemo(
    () => (chosenDomain ? prepareRows(parsed.rows, chosenDomain) : []),
    [parsed.rows, chosenDomain],
  );
  const rewritten = prepared.filter((p) => p.slugRewritten).length;

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setText(await file.text());
    setResult(null);
    setRunError(null);
  }

  async function submit() {
    if (!prepared.length || !chosenDomain || submitting) return;
    setSubmitting(true);
    setRunError(null);
    const agg: Aggregate = { created: 0, skipped: 0, failed: 0, outcomes: [] };
    try {
      // Sequential, ≤100 rows per batch. Each batch is all-or-nothing, so a
      // batch that fails writes nothing and every row comes back with a reason.
      for (const group of chunk(prepared)) {
        const res = await bulk.mutateAsync(group.map((p) => p.input));
        for (const o of res.results) {
          agg.outcomes.push(o);
          if (o.ok) agg.created++;
          else if (isCollision(o.error)) agg.skipped++;
          else agg.failed++;
        }
      }
      setResult(agg);
    } catch (err) {
      setRunError(err instanceof Error ? err.message : "Import failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card className="mb-3.5">
      <CardHeader
        title="Import links"
        right={<Chip tone={parsed.errors.length ? "bad" : "default"}>{parsed.rows.length} rows</Chip>}
      />
      <CardBody className="flex flex-col gap-3">
        <div className="flex items-end gap-3 flex-wrap">
          <Field label="Source">
            <select
              value={sourceId}
              onChange={(e) => { setSourceId(e.target.value); setResult(null); }}
              className={SELECT_CLASS}
              aria-label="Import source"
            >
              {IMPORT_SOURCES.map((s) => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Import into domain">
            <select
              value={chosenDomain}
              onChange={(e) => setDomain(e.target.value)}
              className={SELECT_CLASS}
              aria-label="Import into domain"
            >
              {(domains ?? []).map((d) => (
                <option key={d.id} value={d.domain}>{d.domain}</option>
              ))}
            </select>
          </Field>
          <div>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv,text/plain"
              onChange={onFile}
              className="hidden"
              aria-label="Choose export file"
            />
            <Button onClick={() => fileRef.current?.click()}>Choose file…</Button>
          </div>
        </div>

        <Field label="Or paste the export" help={source.hint}>
          <textarea
            value={text}
            onChange={(e) => { setText(e.target.value); setResult(null); }}
            rows={7}
            spellCheck={false}
            aria-label="Export contents"
            placeholder={"long_url,back_half,title\nhttps://acme.com/spring,spring-sale,Spring Sale"}
            className={TEXTAREA_CLASS}
          />
        </Field>

        {/* Everything we cannot carry, stated before the user commits. */}
        <div className="text-[12px] text-ink-2 flex flex-col gap-1">
          <p className="m-0">
            <b>On import:</b> links are created under <b>{chosenDomain || "your domain"}</b> in this workspace,
            dated now. Titles become the link comment (max 280 chars). Existing back-halves are skipped, never
            overwritten.
          </p>
          {parsed.dropped.length ? (
            <ul className="m-0 pl-4 list-disc text-ink-3">
              {parsed.dropped.map((d) => (
                <li key={d.field}>
                  <b>{d.field}</b> — {d.reason}
                </li>
              ))}
            </ul>
          ) : null}
          {rewritten > 0 ? (
            <p className="m-0 text-ink-3">
              {rewritten} row{rewritten === 1 ? "" : "s"} have a back-half SnapURL can’t use verbatim — a new one
              will be generated for those.
            </p>
          ) : null}
        </div>

        {parsed.errors.length ? (
          <div className="text-[12px] text-bad" role="alert">
            {parsed.errors.length} row{parsed.errors.length === 1 ? "" : "s"} can’t be read and won’t be sent
            (e.g. no destination URL). Fix them in the file or paste to include them.
          </div>
        ) : null}

        <div className="flex items-center gap-3 flex-wrap">
          <Button
            variant="primary"
            onClick={submit}
            disabled={submitting || !prepared.length || !chosenDomain}
          >
            {submitting ? "Importing…" : `Import ${prepared.length || ""} link${prepared.length === 1 ? "" : "s"}`}
          </Button>
          <Button onClick={onClose}>Close</Button>
        </div>

        {runError ? (
          <p className="text-[12.5px] text-bad m-0" role="alert">{runError}</p>
        ) : null}

        {result ? (
          <>
            <p className="text-[12.5px] text-ink-2 m-0" role="status">
              <b className="text-good">{result.created} imported.</b>{" "}
              {result.skipped > 0 ? <><b className="text-ink-2">{result.skipped} skipped</b> (slug already exists). </> : null}
              {result.failed > 0 ? <><b className="text-bad">{result.failed} failed.</b> A batch is all or nothing — fix the flagged rows and import the same file again; imported rows won’t be duplicated.</> : null}
            </p>
            <ol className="flex flex-col gap-[6px] m-0 p-0 list-none max-h-[260px] overflow-y-auto">
              {result.outcomes.map((r, i) => {
                const collision = !r.ok && isCollision(r.error);
                return (
                  <li
                    key={i}
                    className="flex items-start gap-2 text-[12px] border border-line rounded-[var(--radius-sm)] px-[10px] py-[7px] bg-surface-2"
                  >
                    <span className={r.ok ? "text-good" : collision ? "text-ink-3" : "text-bad"}>
                      {r.ok ? "✓" : collision ? "→" : "✗"}
                    </span>
                    {r.ok ? (
                      <span className="font-mono text-ink truncate">{r.link.domain}/{r.link.slug}</span>
                    ) : (
                      <span className="min-w-0">
                        <span className="font-mono text-ink-2 block truncate">{r.destination}</span>
                        <span className={collision ? "text-ink-3" : "text-bad"}>
                          {collision ? "Skipped — " : ""}{r.error}
                        </span>
                      </span>
                    )}
                  </li>
                );
              })}
            </ol>
          </>
        ) : null}
      </CardBody>
    </Card>
  );
}

"use client";

import { useMemo, useState } from "react";
import { Button, Card, CardBody, CardHeader, Chip, Field } from "@/components/ui";
import { useBulkCreateLinks, useDomains } from "@/lib/api/hooks";
import type { CreateLinkInput } from "@snapurl/contract";

const MAX_ROWS = 100;

const TEXTAREA_CLASS =
  "w-full px-[11px] py-[9px] rounded-[var(--radius-sm)] bg-surface-2 border border-line-2 text-[12.5px] text-ink font-mono " +
  "placeholder:text-ink-3 focus:outline-none focus:border-accent focus:bg-surface focus:ring-[3px] focus:ring-accent-wash";

/**
 * One input line becomes one link.
 *
 * `https://example.com/a, spring` — everything before the first comma is the
 * destination, anything after it is the back-half you want. The comma is
 * optional; without one the server generates a back-half.
 *
 * Split on the *first* comma only, because destinations legitimately contain
 * them in query strings.
 */
export function parseRows(text: string): Array<{ destination: string; slug?: string }> {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const comma = line.indexOf(",");
      if (comma === -1) return { destination: line };
      const slug = line.slice(comma + 1).trim();
      return { destination: line.slice(0, comma).trim(), ...(slug ? { slug } : {}) };
    });
}

export function BulkCreatePanel({ onClose }: { onClose: () => void }) {
  const { data: domains } = useDomains();
  const bulk = useBulkCreateLinks();

  const [text, setText] = useState("");
  const [domain, setDomain] = useState("");

  const rows = useMemo(() => parseRows(text), [text]);
  const chosenDomain = domain || domains?.[0]?.domain || "";
  const tooMany = rows.length > MAX_ROWS;

  async function submit() {
    if (!rows.length || !chosenDomain || tooMany) return;
    // The rest of CreateLinkInput's defaults are applied by the server; only
    // what a row can actually express is sent.
    const links = rows.map(
      (r) =>
        ({
          destination: r.destination,
          domain: chosenDomain,
          ...(r.slug ? { slug: r.slug } : {}),
          tags: [],
          redirectType: "302",
          rules: [],
          forwardQuery: true,
          deepLink: false,
          hideReferrer: false,
          publicPreview: true,
        }) as CreateLinkInput,
    );
    try {
      await bulk.mutateAsync({ links });
    } catch {
      /* surfaced below via bulk.error */
    }
  }

  const result = bulk.data;

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
          help="Add a comma and a back-half to choose one — otherwise we generate it. Everything before the first comma is the destination, so query strings are safe."
          error={tooMany ? `That's ${rows.length} rows. Split it into batches of ${MAX_ROWS}.` : undefined}
        >
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
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

        {result ? (
          <>
            {/* The point of the whole feature: every submitted row gets a line,
                so nothing is ever silently dropped. */}
            <p className="text-[12.5px] text-ink-2 m-0">
              {result.created > 0 ? (
                <>
                  <b className="text-good">{result.created} created.</b> They are in the list below.
                </>
              ) : (
                <>
                  <b className="text-bad">Nothing was created.</b> A batch is all or nothing, so fix the rows
                  below and submit the same list again — the good rows cannot be duplicated by retrying.
                </>
              )}
            </p>
            <ol className="flex flex-col gap-[6px] m-0 p-0 list-none max-h-[260px] overflow-y-auto">
              {result.results.map((r) => (
                <li
                  key={r.index}
                  className="flex items-start gap-2 text-[12px] border border-line rounded-[var(--radius-sm)] px-[10px] py-[7px] bg-surface-2"
                >
                  <span className={r.ok ? "text-good" : "text-bad"}>{r.ok ? "✓" : "✗"}</span>
                  <span className="text-ink-3 tnum shrink-0">{r.index + 1}</span>
                  {r.ok ? (
                    <span className="font-mono text-ink truncate">
                      {r.link.domain}/{r.link.slug}
                    </span>
                  ) : (
                    <span className="min-w-0">
                      <span className="font-mono text-ink-2 block truncate">{r.destination}</span>
                      <span className="text-bad">{r.error}</span>
                    </span>
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

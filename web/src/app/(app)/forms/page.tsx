"use client";

import { useState } from "react";
import { PageHead } from "@/components/app-shell";
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Chip,
  EmptyState,
  ErrorState,
  Skeleton,
  Table,
  TableWrap,
  Td,
  Th,
} from "@/components/ui";
import { useExportResponses, useForm, useFormResponses, useForms } from "@/lib/api/hooks";
import { formatDate, full } from "@/lib/utils";

const TONE = { live: "good", draft: "warn", closed: "default" } as const;

export default function FormsPage() {
  const forms = useForms();
  const [openId, setOpenId] = useState<string | null>(null);

  if (forms.isError) {
    return (
      <Card>
        <ErrorState message={(forms.error as Error).message} onRetry={() => forms.refetch()} />
      </Card>
    );
  }

  const items = forms.data ?? [];

  return (
    <>
      <PageHead
        title="Forms"
        sub="Shareable forms with a response table and CSV export. Each one lives at /f/its-address."
      />

      {forms.isLoading ? (
        <Skeleton className="h-[220px]" />
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            icon="▧"
            title="No forms yet"
            body="A form collects what people type and stores it against this workspace — unlike click analytics, which deliberately store as little as possible."
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-3.5">
          <Card>
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <Th>Form</Th>
                    <Th>Address</Th>
                    <Th>Status</Th>
                    <Th>Responses</Th>
                    <Th>Updated</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {items.map((f) => (
                    <tr key={f.id}>
                      <Td className="text-ink font-medium">{f.title}</Td>
                      <Td className="font-mono text-[12px] text-accent">/f/{f.slug}</Td>
                      <Td>
                        <Chip tone={TONE[f.status]} dot>
                          {f.status[0]!.toUpperCase() + f.status.slice(1)}
                        </Chip>
                      </Td>
                      <Td className="tnum">{full(f.responseCount)}</Td>
                      <Td className="text-[12px] text-ink-3">{formatDate(f.updatedAt)}</Td>
                      <Td className="text-right">
                        <Button size="sm" variant="ghost" onClick={() => setOpenId(openId === f.id ? null : f.id)}>
                          {openId === f.id ? "Hide" : "Responses"}
                        </Button>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          </Card>

          {openId ? <Responses formId={openId} /> : null}
        </div>
      )}
    </>
  );
}

function Responses({ formId }: { formId: string }) {
  const form = useForm(formId);
  const responses = useFormResponses(formId);
  const exporter = useExportResponses();

  if (responses.isLoading || form.isLoading) return <Skeleton className="h-[200px]" />;
  if (responses.isError) {
    return (
      <Card>
        <ErrorState message={(responses.error as Error).message} onRetry={() => responses.refetch()} />
      </Card>
    );
  }

  const data = responses.data;
  if (!data) return null;

  /* Columns come from the API, which unions the form's current fields with
     every key any response actually carries — so an answer to a field that has
     since been deleted still has somewhere to appear. */
  const labels = new Map((form.data?.fields ?? []).map((f) => [f.key, f.label]));

  return (
    <Card>
      <CardHeader
        title={`Responses — ${form.data?.title ?? ""}`}
        right={
          <Button
            size="sm"
            onClick={() => void exporter.run(formId, form.data?.slug ?? "responses")}
            disabled={exporter.exporting || data.items.length === 0}
          >
            {exporter.exporting ? "Preparing…" : "Export CSV"}
          </Button>
        }
      />
      {data.items.length === 0 ? (
        <CardBody>
          <EmptyState icon="✉" title="Nothing yet" body="Responses will appear here as they come in." />
        </CardBody>
      ) : (
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>Submitted</Th>
                {data.columns.map((key) => (
                  <Th key={key}>
                    {labels.get(key) ?? (
                      // A key with no label belongs to a field that has been
                      // removed. Saying so beats rendering a bare slug.
                      <span title="This field has since been removed from the form">{key} (removed)</span>
                    )}
                  </Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.items.map((r) => (
                <tr key={r.id}>
                  <Td className="text-[12px] text-ink-3 whitespace-nowrap">{formatDate(r.submittedAt)}</Td>
                  {data.columns.map((key) => (
                    <Td key={key} className="text-[12.5px]">
                      {r.answers[key] ?? <span className="text-ink-3">—</span>}
                    </Td>
                  ))}
                </tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      )}
    </Card>
  );
}

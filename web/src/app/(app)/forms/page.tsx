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
import { FormDrawer } from "@/components/forms/form-drawer";
import { STATUSES } from "@/components/forms/form-values";
import type { Form, FormStatus } from "@snapurl/contract";
import {
  useDeleteForm,
  useExportResponses,
  useForm,
  useFormResponses,
  useForms,
  useUpdateForm,
} from "@/lib/api/hooks";
import { formatDate, full } from "@/lib/utils";

const TONE = { live: "good", draft: "warn", closed: "default" } as const;

export default function FormsPage() {
  const forms = useForms();
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const update = useUpdateForm();
  const remove = useDeleteForm();

  if (forms.isError) {
    return (
      <Card>
        <ErrorState message={(forms.error as Error).message} onRetry={() => forms.refetch()} />
      </Card>
    );
  }

  const items = forms.data ?? [];
  const editingForm = items.find((f) => f.id === editingId);
  const confirming = items.find((f) => f.id === confirmingId);

  const setStatus = async (f: Form, status: FormStatus) => {
    setProblem(null);
    try {
      await update.mutateAsync({ id: f.id, status });
    } catch (err) {
      setProblem(`Couldn't change ${f.title}: ${(err as Error).message}`);
    }
  };

  const destroy = async (f: Form) => {
    setProblem(null);
    try {
      await remove.mutateAsync(f.id);
      if (openId === f.id) setOpenId(null);
      setConfirmingId(null);
    } catch (err) {
      setProblem(`Couldn't delete ${f.title}: ${(err as Error).message}`);
    }
  };

  return (
    <>
      <PageHead
        title="Forms"
        sub="Shareable forms with a response table and CSV export. Each one lives at /f/its-address."
        actions={
          <Button variant="primary" onClick={() => setCreating(true)}>
            New form
          </Button>
        }
      />

      <FormDrawer open={creating} onClose={() => setCreating(false)} />
      {editingForm ? <FormDrawer open onClose={() => setEditingId(null)} form={editingForm} /> : null}

      {problem ? (
        <p role="alert" className="text-[12.5px] text-bad mb-3">
          {problem}
        </p>
      ) : null}

      {confirming ? (
        <Card className="mb-3.5">
          <CardBody className="flex flex-wrap items-center gap-3 text-[13px] text-ink-2 leading-[1.6]">
            <span className="min-w-0 flex-1">
              <b className="text-ink">Deleting {confirming.title} cannot be undone.</b> /f/{confirming.slug} stops
              working immediately, and its {full(confirming.responseCount)}{" "}
              {confirming.responseCount === 1 ? "response goes" : "responses go"} with it.
            </span>
            <span className="flex gap-2">
              <Button onClick={() => setConfirmingId(null)}>Keep it</Button>
              <Button variant="danger" onClick={() => void destroy(confirming)} disabled={remove.isPending}>
                {remove.isPending ? "Deleting…" : "Delete for good"}
              </Button>
            </span>
          </CardBody>
        </Card>
      ) : null}

      {forms.isLoading ? (
        <Skeleton className="h-[220px]" />
      ) : items.length === 0 ? (
        <Card>
          <EmptyState
            icon="▧"
            title="No forms yet"
            body="A form collects what people type and stores it against this workspace — unlike click analytics, which deliberately store as little as possible."
            action={
              <Button variant="primary" onClick={() => setCreating(true)}>
                Create a form
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="flex flex-col gap-3.5">
          <Card>
            <TableWrap label="Forms">
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
                        <div className="flex items-center gap-2">
                          <Chip tone={TONE[f.status]} dot>
                            {f.status[0]!.toUpperCase() + f.status.slice(1)}
                          </Chip>
                          <select
                            aria-label={`Status of ${f.title}`}
                            value={f.status}
                            disabled={update.isPending && update.variables?.id === f.id}
                            onChange={(e) => void setStatus(f, e.target.value as FormStatus)}
                            className="tap-target px-[6px] py-[3px] rounded-[var(--radius-sm)] bg-surface-2 border border-line-2 text-[12px] text-ink-2 focus:outline-none focus:border-accent"
                          >
                            {STATUSES.map((s) => (
                              <option key={s.value} value={s.value}>
                                {s.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      </Td>
                      <Td className="tnum">{full(f.responseCount)}</Td>
                      <Td className="text-[12px] text-ink-3">{formatDate(f.updatedAt)}</Td>
                      <Td className="text-right whitespace-nowrap">
                        <Button size="sm" variant="ghost" onClick={() => setOpenId(openId === f.id ? null : f.id)}>
                          {openId === f.id ? "Hide" : "Responses"}
                        </Button>
                        <Button size="sm" variant="ghost" aria-label={`Edit ${f.title}`} onClick={() => setEditingId(f.id)}>
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Delete ${f.title}`}
                          onClick={() => setConfirmingId(f.id)}
                        >
                          Delete
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
        <TableWrap label="Form responses">
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

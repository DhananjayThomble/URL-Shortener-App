"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { Button, Card, CardBody, Field, Input, Skeleton } from "@/components/ui";
import { usePublicForm, useSubmitForm } from "@/lib/api/hooks";

/* The shareable end of a form.

   Served by the web app at /f/<slug> rather than on a short domain: the
   redirect service owns that slug namespace, and a form competing for it would
   mean a form and a link racing for the same back-half.

   No auth, and no cookies — the same promise the redirect path makes. What is
   different, and what the page says out loud, is that a form stores what
   someone types, so it names the workspace collecting it. */

const CONTROL =
  "w-full px-[11px] py-[9px] rounded-[var(--radius-sm)] bg-surface-2 border border-line-2 text-[13px] text-ink " +
  "placeholder:text-ink-3 focus:outline-none focus:border-accent focus:bg-surface focus:ring-[3px] focus:ring-accent-wash";

export default function PublicFormPage() {
  const { slug } = useParams<{ slug: string }>();
  const form = usePublicForm(slug);
  const submit = useSubmitForm(slug);

  const [values, setValues] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);

  const errors = submit.data?.ok === false ? submit.data.errors : {};
  const set = (key: string, value: string) => setValues((v) => ({ ...v, [key]: value }));

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const result = await submit.mutateAsync(values).catch(() => null);
    if (result?.ok) setDone(true);
  }

  if (form.isLoading) {
    return (
      <main className="max-w-[620px] mx-auto px-6 py-[60px]">
        <Skeleton className="h-[360px]" />
      </main>
    );
  }

  if (form.isError || !form.data) {
    return (
      <main className="max-w-[620px] mx-auto px-6 py-[60px]">
        <Card>
          <CardBody className="text-center py-[44px]">
            <div className="text-[26px] mb-2">🔍</div>
            <h1 className="font-display text-[18px] font-bold m-0 mb-1">There&apos;s no form here</h1>
            <p className="text-[13px] text-ink-3 m-0">
              The address may be wrong, or the form may not be accepting responses.
            </p>
          </CardBody>
        </Card>
      </main>
    );
  }

  const f = form.data;

  return (
    <main className="max-w-[620px] mx-auto px-6 py-[60px]">
      <Card>
        <CardBody className="flex flex-col gap-4">
          <header>
            <h1 className="font-display text-[22px] font-bold tracking-[-0.02em] m-0">{f.title}</h1>
            {f.description ? <p className="text-[13.5px] text-ink-2 mt-1.5 mb-0 leading-[1.6]">{f.description}</p> : null}
          </header>

          {done ? (
            <div className="px-[13px] py-[14px] bg-wash-good rounded-[var(--radius-sm)] text-[13px] text-good">
              <b>Thanks — that&apos;s been recorded.</b>
            </div>
          ) : (
            <form onSubmit={onSubmit} className="flex flex-col gap-3.5">
              {f.fields.map((field) => (
                <Field
                  key={field.key}
                  label={
                    <>
                      {field.label}
                      {field.required ? <span className="text-bad">*</span> : null}
                    </>
                  }
                  error={errors[field.key]}
                >
                  {field.type === "textarea" ? (
                    <textarea
                      rows={4}
                      className={CONTROL}
                      placeholder={field.placeholder ?? ""}
                      value={values[field.key] ?? ""}
                      onChange={(e) => set(field.key, e.target.value)}
                    />
                  ) : field.type === "select" ? (
                    <select
                      className={CONTROL}
                      value={values[field.key] ?? ""}
                      onChange={(e) => set(field.key, e.target.value)}
                    >
                      <option value="">Choose…</option>
                      {(field.options ?? []).map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  ) : field.type === "checkbox" ? (
                    <label className="flex items-center gap-2 text-[13px] text-ink-2">
                      <input
                        type="checkbox"
                        checked={values[field.key] === "yes"}
                        onChange={(e) => set(field.key, e.target.checked ? "yes" : "")}
                      />
                      {field.placeholder ?? "Yes"}
                    </label>
                  ) : (
                    <Input
                      type={field.type === "email" ? "email" : field.type === "number" ? "number" : "text"}
                      placeholder={field.placeholder ?? ""}
                      value={values[field.key] ?? ""}
                      onChange={(e) => set(field.key, e.target.value)}
                    />
                  )}
                </Field>
              ))}

              <Button type="submit" variant="primary" disabled={submit.isPending} className="justify-center">
                {submit.isPending ? "Sending…" : "Submit"}
              </Button>
            </form>
          )}

          {/* A form is the one place SnapURL deliberately stores what a person
              typed, so it says who is collecting it rather than leaving that
              to be inferred. */}
          <p className="text-[11.5px] text-ink-3 leading-[1.55] m-0 pt-1 border-t border-line">
            Collected by <b className="text-ink-2">{f.workspace}</b> using SnapURL. Your answers go to them, not to us
            to sell. No cookies are set by this page.
          </p>
        </CardBody>
      </Card>
    </main>
  );
}

"use client";

import { useEffect, useRef, useState } from "react";
import type { Form, FormFieldType } from "@snapurl/contract";
import { Button, Field, Input, Segmented } from "@/components/ui";
import { useCreateForm, useUpdateForm } from "@/lib/api/hooks";
import {
  FIELD_TYPES,
  STATUSES,
  blankField,
  draftFromForm,
  emptyDraft,
  validateCreate,
  validateUpdate,
  type DraftErrors,
  type FieldDraft,
  type FormDraft,
} from "./form-values";

const CONTROL =
  "w-full px-[11px] py-[9px] rounded-[var(--radius-sm)] bg-surface-2 border border-line-2 text-[13px] text-ink " +
  "placeholder:text-ink-3 focus:outline-none focus:border-accent focus:bg-surface focus:ring-[3px] focus:ring-accent-wash";

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Create a form, or edit one (#649). One drawer for both so the two cannot
 * drift: `form` absent = create (POST /forms), present = edit (PATCH
 * /forms/:id). Structure, focus trap, Escape and restore-focus follow
 * CreateLinkDrawer / EditLinkDrawer.
 *
 * The address (slug) is only settable at creation — UpdateFormInput omits it,
 * and moving a form would break every copy of the link already shared.
 */
export function FormDrawer({ open, onClose, form }: { open: boolean; onClose: () => void; form?: Form }) {
  const editing = Boolean(form);
  const create = useCreateForm();
  const update = useUpdateForm();
  const mutation = editing ? update : create;
  const drawerRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const [draft, setDraft] = useState<FormDraft>(() => (form ? draftFromForm(form) : emptyDraft()));
  const [errors, setErrors] = useState<DraftErrors>({});
  const idp = editing ? "edit-form" : "create-form";

  // Re-seed on open (and clear on close), so nothing from an abandoned attempt
  // leaks into the next one.
  useEffect(() => {
    setDraft(form ? draftFromForm(form) : emptyDraft());
    setErrors({});
    create.reset();
    update.reset();
    // The mutation objects are new every render; re-running on them would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, form?.id]);

  useEffect(() => {
    if (!open) return;
    const el = drawerRef.current;
    if (!el) return;
    const trigger = document.activeElement as HTMLElement | null;
    const queryFocusable = () =>
      Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (node) => !node.closest('[aria-hidden="true"]') && node.tabIndex !== -1,
      );
    document.getElementById(`${idp}-title`)?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const focusable = queryFocusable();
      if (focusable.length === 0) return;
      const firstEl = focusable[0];
      const lastEl = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === firstEl) {
          e.preventDefault();
          lastEl.focus();
        }
      } else if (document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prev;
      if (trigger && document.contains(trigger)) trigger.focus();
    };
  }, [open, idp]);

  if (!open) return null;

  // Any edit clears the message for the thing edited, and a stale server error.
  const touch = (key: string) => {
    if (errors[key]) setErrors(({ [key]: _gone, ...rest }) => rest);
    if (mutation.isError) mutation.reset();
  };
  const set = <K extends keyof FormDraft>(k: K, v: FormDraft[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    touch(k);
  };
  const setField = (i: number, patch: Partial<FieldDraft>) => {
    setDraft((d) => ({ ...d, fields: d.fields.map((f, j) => (j === i ? { ...f, ...patch } : f)) }));
    for (const k of Object.keys(patch)) touch(`fields.${i}.${k}`);
  };
  const addField = () => {
    setDraft((d) => ({ ...d, fields: [...d.fields, blankField()] }));
    // Land the user on the new field's label.
    const n = draft.fields.length;
    requestAnimationFrame(() => document.getElementById(`${idp}-field-${n}-label`)?.focus());
  };
  const removeField = (i: number) => {
    setDraft((d) => ({ ...d, fields: d.fields.filter((_, j) => j !== i) }));
    // Field errors are positional; drop them all rather than mis-attach them.
    setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !k.startsWith("fields."))));
  };
  const moveField = (i: number, by: -1 | 1) => {
    setDraft((d) => {
      const j = i + by;
      if (j < 0 || j >= d.fields.length) return d;
      const fields = [...d.fields];
      [fields[i], fields[j]] = [fields[j]!, fields[i]!];
      return { ...d, fields };
    });
    setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => !k.startsWith("fields."))));
  };

  const focusFirstError = (errs: DraftErrors) => {
    const order = ["title", "description", "slug", "status", "fields"];
    const first = Object.keys(errs).sort((a, b) => {
      const ra = order.findIndex((o) => a.startsWith(o));
      const rb = order.findIndex((o) => b.startsWith(o));
      return ra - rb || a.localeCompare(b, undefined, { numeric: true });
    })[0];
    if (!first) return;
    const id = first.startsWith("fields.")
      ? `${idp}-field-${first.split(".")[1]}-${first.split(".")[2] ?? "label"}`
      : `${idp}-${first}`;
    requestAnimationFrame(() => document.getElementById(id)?.focus());
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    mutation.reset();
    const checked = editing ? validateUpdate(draft) : validateCreate(draft);
    if (!checked.ok) {
      setErrors(checked.errors);
      focusFirstError(checked.errors);
      return;
    }
    setErrors({});
    try {
      if (editing && form) await update.mutateAsync({ id: form.id, ...checked.input });
      else await create.mutateAsync(checked.input as Parameters<typeof create.mutateAsync>[0]);
      onClose();
    } catch {
      /* surfaced in the footer via mutation.error */
    }
  };

  const title = editing ? `Edit ${form!.title}` : "Create a form";
  const formErr = errors.form ?? errors.fields;

  return (
    <>
      <div className="fixed inset-0 bg-[rgb(6_10_15/0.5)] z-[100] backdrop-blur-[2px]" onClick={onClose} />
      <aside
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="fixed top-0 right-0 bottom-0 w-full sm:w-[620px] bg-surface border-l border-line-2 z-[101] flex flex-col shadow-[var(--shadow-3)]"
      >
        <div className="flex items-center gap-3 px-5 py-[17px] border-b border-line">
          <h2 className="text-[17px] font-bold truncate">{editing ? `Edit ${form!.title}` : "New form"}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="ml-auto text-ink-3 text-[18px] px-[9px] py-1 rounded-[5px] hover:bg-surface-3 hover:text-ink"
          >
            ✕
          </button>
        </div>

        <form onSubmit={onSubmit} noValidate className="flex-1 flex flex-col min-h-0">
          <div className="p-5 overflow-y-auto flex-1 flex flex-col gap-[18px]">
            <Field label="Title" error={errors.title} controlId={`${idp}-title`}>
              <Input
                id={`${idp}-title`}
                value={draft.title}
                onChange={(e) => set("title", e.target.value)}
                aria-invalid={errors.title ? true : undefined}
                aria-describedby={errors.title ? `${idp}-title-hint` : undefined}
                placeholder="Spring launch feedback"
              />
            </Field>

            <Field
              label="Description"
              help="Shown under the title on the public page. Optional."
              error={errors.description}
              controlId={`${idp}-description`}
            >
              <textarea
                id={`${idp}-description`}
                rows={2}
                className={CONTROL}
                value={draft.description}
                onChange={(e) => set("description", e.target.value)}
                aria-invalid={errors.description ? true : undefined}
                aria-describedby={`${idp}-description-hint`}
              />
            </Field>

            {editing ? (
              <p className="text-[12.5px] text-ink-3 m-0">
                Lives at <span className="font-mono text-accent">/f/{form!.slug}</span>. The address can&apos;t change once
                a form exists — anyone you already sent it to would land on nothing.
              </p>
            ) : (
              <Field
                label="Address"
                help="Leave blank for a random address."
                error={errors.slug}
                controlId={`${idp}-slug`}
              >
                <div className="flex items-stretch">
                  <span
                    aria-hidden="true"
                    className="px-[11px] py-[9px] bg-surface-3 border border-line-2 border-r-0 rounded-l-[var(--radius-sm)] font-mono text-[12.5px] text-ink-2"
                  >
                    /f/
                  </span>
                  <Input
                    id={`${idp}-slug`}
                    value={draft.slug}
                    onChange={(e) => set("slug", e.target.value)}
                    aria-invalid={errors.slug ? true : undefined}
                    aria-describedby={`${idp}-slug-hint`}
                    placeholder="spring-feedback"
                    className="rounded-l-none font-mono text-[12.5px]"
                    spellCheck={false}
                  />
                </div>
              </Field>
            )}

            <Field
              label="Status"
              help="Only a live form accepts responses. Draft and closed forms are not found at their address."
              error={errors.status}
              controlId={`${idp}-status`}
            >
              <Segmented
                id={`${idp}-status`}
                aria-label="Status"
                aria-describedby={`${idp}-status-hint`}
                options={STATUSES}
                value={draft.status}
                onChange={(v) => set("status", v)}
              />
            </Field>

            <fieldset className="flex flex-col gap-3 border-0 p-0 m-0">
              <legend className="text-[12.5px] font-semibold mb-2">Fields</legend>
              {draft.fields.length === 0 ? (
                <p className="text-[12.5px] text-ink-3 m-0">No fields yet. A form with none only records that it was sent.</p>
              ) : null}
              {draft.fields.map((f, i) => (
                <FieldEditor
                  key={f.uid}
                  idp={`${idp}-field-${i}`}
                  n={i + 1}
                  count={draft.fields.length}
                  field={f}
                  errors={errors}
                  path={`fields.${i}`}
                  onChange={(patch) => setField(i, patch)}
                  onRemove={() => removeField(i)}
                  onMove={(by) => moveField(i, by)}
                />
              ))}
              <div>
                <Button type="button" size="sm" onClick={addField} disabled={draft.fields.length >= 50}>
                  + Add a field
                </Button>
              </div>
              {formErr ? (
                <span role="alert" className="text-[11.5px] text-bad">
                  {formErr}
                </span>
              ) : null}
            </fieldset>
          </div>

          <div className="flex items-center gap-[10px] px-5 py-[14px] border-t border-line bg-surface-2">
            {mutation.isError ? (
              <span role="alert" className="text-[12px] text-bad">
                {(mutation.error as Error).message}
              </span>
            ) : (
              <span className="text-[11.5px] text-ink-3">
                {editing ? "Existing answers stay attached to their field." : "Forms start as a draft unless you set them live."}
              </span>
            )}
            <div className="ml-auto flex gap-2">
              <Button type="button" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={mutation.isPending}>
                {editing ? (update.isPending ? "Saving…" : "Save changes") : create.isPending ? "Creating…" : "Create form"}
              </Button>
            </div>
          </div>
        </form>
      </aside>
    </>
  );
}

function FieldEditor({
  idp,
  n,
  count,
  field,
  errors,
  path,
  onChange,
  onRemove,
  onMove,
}: {
  idp: string;
  n: number;
  count: number;
  field: FieldDraft;
  errors: DraftErrors;
  path: string;
  onChange: (patch: Partial<FieldDraft>) => void;
  onRemove: () => void;
  onMove: (by: -1 | 1) => void;
}) {
  const err = (k: string) => errors[`${path}.${k}`];
  const describe = (k: string) => (err(k) ? `${idp}-${k}-hint` : undefined);
  const name = field.label.trim() || `field ${n}`;
  return (
    <div className="flex flex-col gap-2.5 p-3 border border-line rounded-[var(--radius-sm)] bg-surface-2">
      <div className="flex items-center gap-2">
        <span className="text-[11.5px] font-semibold text-ink-3 uppercase tracking-[0.04em]">Field {n}</span>
        <div className="ml-auto flex gap-1">
          <Button type="button" size="sm" variant="ghost" aria-label={`Move ${name} up`} onClick={() => onMove(-1)} disabled={n === 1}>
            ↑
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            aria-label={`Move ${name} down`}
            onClick={() => onMove(1)}
            disabled={n === count}
          >
            ↓
          </Button>
          <Button type="button" size="sm" variant="ghost" aria-label={`Remove ${name}`} onClick={onRemove}>
            Remove
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-[1fr_170px] gap-2.5">
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idp}-label`} className="sr-only">
            Field {n} label
          </label>
          <Input
            id={`${idp}-label`}
            value={field.label}
            placeholder="Label, e.g. Your name"
            onChange={(e) => onChange({ label: e.target.value })}
            aria-invalid={err("label") ? true : undefined}
            aria-describedby={describe("label")}
          />
          {err("label") ? (
            <span id={`${idp}-label-hint`} className="text-[11.5px] text-bad">
              {err("label")}
            </span>
          ) : null}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idp}-type`} className="sr-only">
            Field {n} type
          </label>
          <select
            id={`${idp}-type`}
            className={CONTROL}
            value={field.type}
            onChange={(e) => onChange({ type: e.target.value as FormFieldType })}
            aria-invalid={err("type") ? true : undefined}
            aria-describedby={describe("type")}
          >
            {FIELD_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          {err("type") ? (
            <span id={`${idp}-type-hint`} className="text-[11.5px] text-bad">
              {err("type")}
            </span>
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={`${idp}-placeholder`} className="text-[12px] text-ink-2">
          {field.type === "checkbox" ? `Field ${n} text beside the box` : `Field ${n} placeholder`}
        </label>
        <Input
          id={`${idp}-placeholder`}
          value={field.placeholder}
          onChange={(e) => onChange({ placeholder: e.target.value })}
          aria-invalid={err("placeholder") ? true : undefined}
          aria-describedby={describe("placeholder")}
        />
        {err("placeholder") ? (
          <span id={`${idp}-placeholder-hint`} className="text-[11.5px] text-bad">
            {err("placeholder")}
          </span>
        ) : null}
      </div>

      {field.type === "select" ? (
        <div className="flex flex-col gap-1">
          <label htmlFor={`${idp}-options`} className="text-[12px] text-ink-2">
            Field {n} options
          </label>
          <textarea
            id={`${idp}-options`}
            rows={3}
            className={CONTROL}
            placeholder={"One per line"}
            value={field.options}
            onChange={(e) => onChange({ options: e.target.value })}
            aria-invalid={err("options") ? true : undefined}
            aria-describedby={`${idp}-options-hint`}
          />
          <span id={`${idp}-options-hint`} className={`text-[11.5px] ${err("options") ? "text-bad" : "text-ink-3"}`}>
            {err("options") ?? "One option per line."}
          </span>
        </div>
      ) : null}

      <label className="flex items-center gap-2 text-[12.5px] text-ink-2">
        <input
          type="checkbox"
          aria-label={`Field ${n} required`}
          checked={field.required}
          onChange={(e) => onChange({ required: e.target.checked })}
        />
        Required
      </label>
    </div>
  );
}

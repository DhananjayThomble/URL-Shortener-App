import {
  CreateFormInput,
  UpdateFormInput,
  type Form,
  type FormFieldInput,
  type FormFieldType,
  type FormStatus,
} from "@snapurl/contract";

/* ============================================================
   Editor state for the forms create/edit drawer (#649), and the
   only path from it to a request body.

   Every body the drawer sends is the output of the CONTRACT's own
   zod schema (CreateFormInput / UpdateFormInput) run here in the
   browser, so the UI cannot send a payload the API's zodBody pipe
   would reject. The errors come back keyed by the same path the
   drawer renders each input under ("title", "fields.0.label", …).
   ============================================================ */

export const FIELD_TYPES: { value: FormFieldType; label: string }[] = [
  { value: "text", label: "Short text" },
  { value: "textarea", label: "Long text" },
  { value: "email", label: "Email" },
  { value: "number", label: "Number" },
  { value: "select", label: "Dropdown" },
  { value: "checkbox", label: "Checkbox" },
];

export const STATUSES: { value: FormStatus; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "live", label: "Live" },
  { value: "closed", label: "Closed" },
];

export interface FieldDraft {
  /** Client-only identity for React keys and control ids. Never sent. */
  uid: string;
  /** Present for a field that already exists. Frozen: answers are stored under it. */
  key?: string;
  label: string;
  type: FormFieldType;
  required: boolean;
  placeholder: string;
  /** One option per line; only sent for `select`. */
  options: string;
}

export interface FormDraft {
  title: string;
  description: string;
  slug: string;
  status: FormStatus;
  fields: FieldDraft[];
}

export type DraftErrors = Record<string, string>;

let seq = 0;
const uid = () => `f${Date.now().toString(36)}${(seq++).toString(36)}`;

export function blankField(): FieldDraft {
  return { uid: uid(), label: "", type: "text", required: false, placeholder: "", options: "" };
}

export function emptyDraft(): FormDraft {
  return { title: "", description: "", slug: "", status: "draft", fields: [] };
}

/** An existing form, reshaped into what the drawer edits. */
export function draftFromForm(form: Form): FormDraft {
  return {
    title: form.title,
    description: form.description,
    slug: form.slug,
    status: form.status,
    fields: form.fields.map((f) => ({
      uid: uid(),
      key: f.key,
      label: f.label,
      type: f.type,
      required: f.required,
      placeholder: f.placeholder ?? "",
      options: (f.options ?? []).join("\n"),
    })),
  };
}

function toFieldInputs(fields: FieldDraft[]): FormFieldInput[] {
  return fields.map((f) => {
    const out: FormFieldInput = { label: f.label.trim(), type: f.type, required: f.required };
    // Keys are only ever echoed back for fields that already have one, so an
    // edit keeps every existing answer attached to its field (contract: "Frozen
    // at creation").
    if (f.key) out.key = f.key;
    const placeholder = f.placeholder.trim();
    if (placeholder) out.placeholder = placeholder;
    if (f.type === "select") {
      out.options = f.options
        .split("\n")
        .map((o) => o.trim())
        .filter(Boolean);
    }
    return out;
  });
}

/**
 * Issue path -> the drawer's error key. Options are a single textarea, so an
 * error on `fields.2.options.4` belongs on `fields.2.options`.
 */
function errorKey(path: ReadonlyArray<PropertyKey>): string {
  const parts = path.map(String);
  if (parts[0] === "fields" && parts[2] === "options") return parts.slice(0, 3).join(".");
  return parts.join(".") || "form";
}

function collect(issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>): DraftErrors {
  const errors: DraftErrors = {};
  for (const issue of issues) {
    const k = errorKey(issue.path);
    errors[k] ??= issue.message;
  }
  return errors;
}

/**
 * Checks the contract cannot express but the public page depends on: a
 * dropdown with no options can never be answered, so a required one would
 * make the form impossible to submit.
 */
function extraChecks(fields: FieldDraft[], errors: DraftErrors) {
  fields.forEach((f, i) => {
    if (f.type === "select" && !f.options.split("\n").some((o) => o.trim())) {
      errors[`fields.${i}.options`] ??= "Add at least one option, one per line.";
    }
    if (!f.label.trim()) errors[`fields.${i}.label`] ??= "Give the field a label.";
  });
}

export type Validated<T> = { ok: true; input: T } | { ok: false; errors: DraftErrors };

export function validateCreate(draft: FormDraft): Validated<CreateFormInput> {
  const parsed = CreateFormInput.safeParse({
    title: draft.title.trim(),
    description: draft.description,
    slug: draft.slug.trim(),
    status: draft.status,
    fields: toFieldInputs(draft.fields),
  });
  const errors = parsed.success ? {} : collect(parsed.error.issues);
  extraChecks(draft.fields, errors);
  if (!parsed.success || Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, input: parsed.data };
}

/** The whole editable surface, every time: fields are replaced wholesale by the API. */
export function validateUpdate(draft: FormDraft): Validated<UpdateFormInput> {
  const parsed = UpdateFormInput.safeParse({
    title: draft.title.trim(),
    description: draft.description,
    status: draft.status,
    fields: toFieldInputs(draft.fields),
  });
  const errors = parsed.success ? {} : collect(parsed.error.issues);
  extraChecks(draft.fields, errors);
  if (!parsed.success || Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, input: parsed.data };
}

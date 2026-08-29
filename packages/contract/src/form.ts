import { z } from "zod";

/* ============================================================
   Forms — a separate product module, not a link feature.

   The schema reasoning is in docs/DECISIONS.md. The one thing
   worth knowing to read this file: a field's `key` is frozen at
   creation and is what answers are stored under. The `label` is
   what the form says and may be rewritten freely.
   ============================================================ */

export const FormFieldType = z.enum(["text", "email", "textarea", "number", "select", "checkbox"]);
export type FormFieldType = z.infer<typeof FormFieldType>;

export const FormField = z.object({
  /** Frozen at creation. Answers are stored under this, never under the label. */
  key: z.string().min(1).max(64),
  label: z.string().min(1).max(160),
  type: FormFieldType,
  required: z.boolean().default(false),
  placeholder: z.string().max(160).nullable().optional(),
  /** Only meaningful for `select`. */
  options: z.array(z.string().min(1).max(160)).max(50).optional(),
});
export type FormField = z.infer<typeof FormField>;

/** What a field looks like on the way in, before a key has been assigned. */
export const FormFieldInput = FormField.partial({ key: true });
export type FormFieldInput = z.infer<typeof FormFieldInput>;

export const FormStatus = z.enum(["draft", "live", "closed"]);
export type FormStatus = z.infer<typeof FormStatus>;

export const Form = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  description: z.string(),
  status: FormStatus,
  fields: z.array(FormField),
  responseCount: z.number(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Form = z.infer<typeof Form>;

export const CreateFormInput = z.object({
  title: z.string().min(1, "Give the form a title.").max(160),
  description: z.string().max(500).default(""),
  slug: z
    .string()
    .regex(/^[a-zA-Z0-9._-]*$/, "Use letters, numbers, dots, dashes or underscores")
    .max(64)
    .optional()
    .or(z.literal("")),
  status: FormStatus.default("draft"),
  fields: z.array(FormFieldInput).max(50).default([]),
});
export type CreateFormInput = z.infer<typeof CreateFormInput>;

export const UpdateFormInput = CreateFormInput.omit({ slug: true }).partial();
export type UpdateFormInput = z.infer<typeof UpdateFormInput>;

export const FormResponse = z.object({
  id: z.string(),
  /** Keyed by field key. Never rewritten when the form changes. */
  answers: z.record(z.string(), z.string()),
  submittedAt: z.string(),
});
export type FormResponse = z.infer<typeof FormResponse>;

export const FormResponseList = z.object({
  items: z.array(FormResponse),
  total: z.number(),
  /** Every key the export would carry: current fields plus any since deleted. */
  columns: z.array(z.string()),
});
export type FormResponseList = z.infer<typeof FormResponseList>;

/**
 * What a visitor sees. Deliberately not the full `Form`: response counts and
 * timestamps are the workspace's business, not the respondent's.
 */
export const PublicForm = z.object({
  slug: z.string(),
  title: z.string(),
  description: z.string(),
  fields: z.array(FormField),
  /** Named on the page, so it is clear who is collecting what is typed. */
  workspace: z.string(),
});
export type PublicForm = z.infer<typeof PublicForm>;

export const SubmitFormInput = z.object({
  answers: z.record(z.string(), z.unknown()),
});
export type SubmitFormInput = z.infer<typeof SubmitFormInput>;

export const SubmitFormResult = z.object({
  ok: z.boolean(),
  /** Keyed by field key so the UI can put each message on the right input. */
  errors: z.record(z.string(), z.string()).default({}),
});
export type SubmitFormResult = z.infer<typeof SubmitFormResult>;

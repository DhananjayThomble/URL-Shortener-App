/* ============================================================
   Forms: keys, validation and export shape.

   Pure, because these are the rules that decide whether a
   response collected today still means anything after the form
   is edited next month. See docs/DECISIONS.md.
   ============================================================ */

export interface FormFieldDef {
  key: string;
  label: string;
  type: "text" | "email" | "textarea" | "number" | "select" | "checkbox";
  required: boolean;
  placeholder?: string | null;
  options?: string[];
}

/**
 * Derive a field key from its label.
 *
 * Called **once**, when the field is created, and the result is then frozen.
 * The label is what the form says; the key is what its history means, and
 * rewriting a label must not orphan answers already collected under it.
 */
export function fieldKeyFrom(label: string, taken: ReadonlySet<string> = new Set()): string {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "field";

  if (!taken.has(base)) return base;
  // Two fields legitimately share a label ("Address" twice, say). Suffixes
  // keep them distinct without either one silently overwriting the other.
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}_${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}_${Date.now()}`;
}

/** Assign keys to any fields that do not have one yet, leaving existing keys alone. */
export function withFieldKeys(fields: Array<Omit<FormFieldDef, "key"> & { key?: string }>): FormFieldDef[] {
  const taken = new Set(fields.map((f) => f.key).filter((k): k is string => Boolean(k)));
  return fields.map((f) => {
    if (f.key) return f as FormFieldDef;
    const key = fieldKeyFrom(f.label, taken);
    taken.add(key);
    return { ...f, key };
  });
}

export interface SubmissionResult {
  ok: boolean;
  /** Keyed by field key, so the UI can put the message on the right input. */
  errors: Record<string, string>;
  /** Only the fields the form actually declares, trimmed. */
  answers: Record<string, string>;
}

/**
 * Check a submission against the form's current definition.
 *
 * Answers for keys the form does not declare are **dropped, not rejected**: a
 * stale tab submitting a field that was deleted a minute ago should not lose
 * the whole response, and accepting arbitrary keys would let anyone write
 * unbounded junk into the answers column.
 */
export function validateSubmission(
  fields: readonly FormFieldDef[],
  raw: Record<string, unknown>,
): SubmissionResult {
  const errors: Record<string, string> = {};
  const answers: Record<string, string> = {};

  for (const field of fields) {
    const value = typeof raw[field.key] === "string" ? (raw[field.key] as string).trim() : "";

    if (!value) {
      if (field.required) errors[field.key] = `${field.label} is required.`;
      continue;
    }

    if (value.length > 4000) {
      errors[field.key] = `${field.label} is too long.`;
      continue;
    }

    if (field.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      errors[field.key] = `${field.label} needs to look like an email address.`;
      continue;
    }

    if (field.type === "number" && !Number.isFinite(Number(value))) {
      errors[field.key] = `${field.label} needs to be a number.`;
      continue;
    }

    /* A select that accepted anything would make the stored answer a free-text
       field wearing a dropdown's clothes, and every report built on it wrong. */
    if (field.type === "select" && field.options?.length && !field.options.includes(value)) {
      errors[field.key] = `${field.label} isn't one of the choices.`;
      continue;
    }

    answers[field.key] = value;
  }

  return { ok: Object.keys(errors).length === 0, errors, answers };
}

/**
 * The columns an export should have.
 *
 * Every key the form declares now, plus every key any response actually
 * carries — including fields since deleted. Exporting only the current
 * definition would mean deleting a field quietly destroys the answers people
 * gave it, in the one artefact meant to be the durable record.
 */
export function exportColumns(
  fields: readonly FormFieldDef[],
  responses: ReadonlyArray<{ answers: Record<string, string> }>,
): string[] {
  const columns = fields.map((f) => f.key);
  const seen = new Set(columns);
  for (const response of responses) {
    for (const key of Object.keys(response.answers)) {
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
    }
  }
  return columns;
}

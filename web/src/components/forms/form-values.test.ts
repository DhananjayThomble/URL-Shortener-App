import { describe, expect, it } from "vitest";
import { CreateFormInput, UpdateFormInput, type Form } from "@snapurl/contract";
import { blankField, draftFromForm, emptyDraft, validateCreate, validateUpdate, type FormDraft } from "./form-values";

/* Oracle: packages/contract/src/form.ts. Whatever validateCreate/validateUpdate
   accepts must also be accepted by the contract schema the API's zodBody pipe
   runs, and the contract's own messages must reach the drawer keyed by the
   path the drawer renders each input under. */

const draft = (over: Partial<FormDraft> = {}): FormDraft => ({ ...emptyDraft(), title: "Feedback", ...over });
const field = (over: Partial<ReturnType<typeof blankField>> = {}) => ({ ...blankField(), label: "Name", ...over });

describe("validateCreate", () => {
  it("refuses an empty or whitespace-only title with the contract's message", () => {
    for (const title of ["", "   "]) {
      const r = validateCreate(draft({ title }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors.title).toBe("Give the form a title.");
    }
  });

  it("refuses an address outside the contract's charset, keyed on slug", () => {
    const r = validateCreate(draft({ slug: "has space" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.slug).toBe("Use letters, numbers, dots, dashes or underscores");
  });

  it("refuses an over-long title and a blank field label, keyed per field", () => {
    const r = validateCreate(draft({ title: "x".repeat(161), fields: [field(), field({ label: "  " })] }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.title).toBeTruthy();
      expect(r.errors["fields.1.label"]).toBeTruthy();
      expect(r.errors["fields.0.label"]).toBeUndefined();
    }
  });

  it("refuses a dropdown with no options and maps option errors to the options box", () => {
    const none = validateCreate(draft({ fields: [field({ type: "select", options: "\n  \n" })] }));
    expect(none.ok).toBe(false);
    if (!none.ok) expect(none.errors["fields.0.options"]).toBeTruthy();

    const tooLong = validateCreate(draft({ fields: [field({ type: "select", options: `ok\n${"y".repeat(161)}` })] }));
    expect(tooLong.ok).toBe(false);
    if (!tooLong.ok) expect(tooLong.errors["fields.0.options"]).toBeTruthy();
  });

  it("refuses more than 50 fields", () => {
    const r = validateCreate(draft({ fields: Array.from({ length: 51 }, () => field()) }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.fields).toBeTruthy();
  });

  it("builds a body the contract accepts: trimmed, options split, placeholder omitted when blank, no key for new fields", () => {
    const r = validateCreate(
      draft({
        title: "  Feedback  ",
        slug: " spring.fb ",
        status: "live",
        fields: [
          field({ label: " Plan ", type: "select", options: " Free \n\nPro\n", required: true }),
          field({ label: "Email", type: "email", placeholder: "  " }),
        ],
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input).toEqual({
      title: "Feedback",
      description: "",
      slug: "spring.fb",
      status: "live",
      fields: [
        { label: "Plan", type: "select", required: true, options: ["Free", "Pro"] },
        { label: "Email", type: "email", required: false },
      ],
    });
    expect(CreateFormInput.safeParse(r.input).success).toBe(true);
  });
});

describe("validateUpdate", () => {
  const form: Form = {
    id: "0190-x",
    slug: "fb",
    title: "Feedback",
    description: "d",
    status: "live",
    fields: [
      { key: "name", label: "Name", type: "text", required: true, placeholder: "Ada" },
      { key: "plan", label: "Plan", type: "select", required: false, options: ["Free", "Pro"] },
    ],
    responseCount: 3,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  it("round-trips an untouched form without losing anything, keys included, and never sends slug", () => {
    const r = validateUpdate(draftFromForm(form));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input).toEqual({
      title: "Feedback",
      description: "d",
      status: "live",
      fields: form.fields,
    });
    expect("slug" in r.input).toBe(false);
    expect(UpdateFormInput.safeParse(r.input).success).toBe(true);
  });

  it("keeps an existing field's key when its label is rewritten, and sends no key for a new field", () => {
    const d = draftFromForm(form);
    d.fields[0]!.label = "Full name";
    d.fields.push(field({ label: "Notes", type: "textarea" }));
    const r = validateUpdate(d);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.input.fields![0]).toMatchObject({ key: "name", label: "Full name" });
    expect(r.input.fields![2]).not.toHaveProperty("key");
  });

  it("drops options when a dropdown becomes another type", () => {
    const d = draftFromForm(form);
    d.fields[1]!.type = "text";
    const r = validateUpdate(d);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.input.fields![1]).not.toHaveProperty("options");
  });

  it("refuses an emptied title", () => {
    const d = draftFromForm(form);
    d.title = "";
    const r = validateUpdate(d);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.title).toBe("Give the form a title.");
  });
});

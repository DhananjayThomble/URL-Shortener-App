import { describe, expect, it } from "vitest";
import {
  CreateFormInput,
  Form,
  FormField,
  FormFieldInput,
  FormFieldType,
  FormResponse,
  FormResponseList,
  FormStatus,
  PublicForm,
  SubmitFormInput,
  SubmitFormResult,
  UpdateFormInput,
} from "./form.js";

/* #895: Forms is a wire module with no runtime tests of its own. These pin the
   schema shapes, enum membership, field constraints and defaults so a weakened
   schema is caught by mutation testing. The product rule that matters most —
   a field's `key` is frozen at creation and answers are stored under it — is
   encoded in FormField (key required) vs FormFieldInput (key optional). */

describe("FormFieldType enum", () => {
  it("accepts its six input types and rejects others", () => {
    for (const t of ["text", "email", "textarea", "number", "select", "checkbox"]) {
      expect(FormFieldType.safeParse(t).success).toBe(true);
    }
    expect(FormFieldType.safeParse("date").success).toBe(false);
    expect(FormFieldType.safeParse("").success).toBe(false);
  });
});

describe("FormStatus enum", () => {
  it("accepts draft/live/closed and rejects others", () => {
    for (const s of ["draft", "live", "closed"]) expect(FormStatus.safeParse(s).success).toBe(true);
    expect(FormStatus.safeParse("archived").success).toBe(false);
  });
});

describe("FormField shape and constraints", () => {
  const valid = { key: "email", label: "Your email", type: "email" as const };

  it("accepts a well-formed field and defaults required to false", () => {
    const parsed = FormField.parse(valid);
    expect(parsed.key).toBe("email");
    expect(parsed.required).toBe(false); // kills required default(false) → default(true)
  });

  it("requires a non-empty key within 64 chars (kills min/max mutations)", () => {
    expect(FormField.safeParse({ ...valid, key: "" }).success).toBe(false); // min(1)
    expect(FormField.safeParse({ ...valid, key: "a".repeat(64) }).success).toBe(true); // max(64) boundary
    expect(FormField.safeParse({ ...valid, key: "a".repeat(65) }).success).toBe(false); // over max → min(64) mutant would reject the 64 case; max(1) would reject "email"
  });

  it("requires a non-empty label within 160 chars", () => {
    expect(FormField.safeParse({ ...valid, label: "" }).success).toBe(false);
    expect(FormField.safeParse({ ...valid, label: "a".repeat(160) }).success).toBe(true);
    expect(FormField.safeParse({ ...valid, label: "a".repeat(161) }).success).toBe(false);
  });

  it("requires key, label and type (kills the shape → {} mutant)", () => {
    expect(FormField.safeParse({ label: "x", type: "text" }).success).toBe(false); // no key
    expect(FormField.safeParse({ key: "k", type: "text" }).success).toBe(false); // no label
    expect(FormField.safeParse({ key: "k", label: "x" }).success).toBe(false); // no type
    expect(FormField.safeParse({ ...valid, type: "date" }).success).toBe(false); // bad type
  });

  it("caps options at 50 entries, each 1..160 chars (select fields)", () => {
    const opts = (n: number) => ({ ...valid, type: "select" as const, options: Array.from({ length: n }, () => "o") });
    expect(FormField.safeParse(opts(50)).success).toBe(true);
    expect(FormField.safeParse(opts(51)).success).toBe(false); // max(50) → min(50) mutant would reject 50
    expect(FormField.safeParse({ ...valid, type: "select", options: [""] }).success).toBe(false); // min(1) per entry
    expect(FormField.safeParse({ ...valid, type: "select", options: ["a".repeat(161)] }).success).toBe(false);
  });

  it("rejects a non-boolean required and a non-string placeholder over 160", () => {
    expect(FormField.safeParse({ ...valid, required: "yes" }).success).toBe(false);
    expect(FormField.safeParse({ ...valid, placeholder: "a".repeat(161) }).success).toBe(false);
    expect(FormField.safeParse({ ...valid, placeholder: null }).success).toBe(true); // nullable
  });
});

describe("FormFieldInput — key is optional before creation (kills partial{key:true} → {key:false})", () => {
  it("accepts a field with no key yet", () => {
    expect(FormFieldInput.safeParse({ label: "Your email", type: "email" }).success).toBe(true);
  });
  it("still accepts one that carries a key", () => {
    expect(FormFieldInput.safeParse({ key: "email", label: "Your email", type: "email" }).success).toBe(true);
  });
  it("still requires label and type", () => {
    expect(FormFieldInput.safeParse({ type: "email" }).success).toBe(false);
  });
});

describe("CreateFormInput shape, constraints and defaults", () => {
  it("defaults description, status and fields when omitted", () => {
    const parsed = CreateFormInput.parse({ title: "Signup" });
    expect(parsed.description).toBe(""); // kills description default("") drop
    expect(parsed.status).toBe("draft"); // kills status default("draft")
    expect(parsed.fields).toEqual([]); // kills fields default([]) → ["Stryker was here"]
  });

  it("requires a title of 1..160 chars", () => {
    expect(CreateFormInput.safeParse({ title: "" }).success).toBe(false); // min(1)
    expect(CreateFormInput.safeParse({ title: "a".repeat(160) }).success).toBe(true);
    expect(CreateFormInput.safeParse({ title: "a".repeat(161) }).success).toBe(false); // max(160) → min(160) mutant rejects 160
  });

  it("caps description at 500 chars", () => {
    expect(CreateFormInput.safeParse({ title: "t", description: "a".repeat(500) }).success).toBe(true);
    expect(CreateFormInput.safeParse({ title: "t", description: "a".repeat(501) }).success).toBe(false);
  });

  it("accepts a valid slug, an empty slug, and rejects illegal slug characters (kills the regex anchors)", () => {
    expect(CreateFormInput.safeParse({ title: "t", slug: "my-form_1.v2" }).success).toBe(true);
    expect(CreateFormInput.safeParse({ title: "t", slug: "" }).success).toBe(true); // .or(z.literal(""))
    expect(CreateFormInput.safeParse({ title: "t", slug: "bad slug!" }).success).toBe(false); // space + !
    expect(CreateFormInput.safeParse({ title: "t", slug: "no/slash" }).success).toBe(false);
    expect(CreateFormInput.safeParse({ title: "t", slug: "@lead" }).success).toBe(false); // leading bad char → ^ anchor
  });

  it("caps fields at 50", () => {
    const fields = (n: number) => Array.from({ length: n }, () => ({ label: "l", type: "text" as const }));
    expect(CreateFormInput.safeParse({ title: "t", fields: fields(50) }).success).toBe(true);
    expect(CreateFormInput.safeParse({ title: "t", fields: fields(51) }).success).toBe(false);
  });
});

describe("UpdateFormInput — omits slug and makes the rest optional", () => {
  it("accepts an empty patch (all optional)", () => {
    expect(UpdateFormInput.safeParse({}).success).toBe(true);
  });
  it("drops slug from the output even when supplied (kills omit({slug:true}) → omit({}))", () => {
    const parsed = UpdateFormInput.parse({ slug: "ignored", title: "New title" });
    expect("slug" in parsed).toBe(false);
    expect(parsed.title).toBe("New title");
  });
  it("still validates a supplied title", () => {
    expect(UpdateFormInput.safeParse({ title: "" }).success).toBe(false);
  });
});

describe("Form / FormResponse / FormResponseList / PublicForm shapes (kills shape → {} mutants)", () => {
  const field = { key: "email", label: "Email", type: "email" as const };
  const validForm = {
    id: "f1",
    slug: "signup",
    title: "Signup",
    description: "",
    status: "live" as const,
    fields: [field],
    responseCount: 3,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };

  it("Form requires every field with its type", () => {
    expect(Form.parse(validForm).responseCount).toBe(3);
    expect(Form.safeParse({ ...validForm, responseCount: "three" }).success).toBe(false);
    expect(Form.safeParse({ ...validForm, status: "archived" }).success).toBe(false);
    const { id: _id, ...noId } = validForm;
    expect(Form.safeParse(noId).success).toBe(false);
  });

  it("FormResponse keys answers by string and requires id + submittedAt", () => {
    const parsed = FormResponse.parse({ id: "r1", answers: { email: "a@b.com" }, submittedAt: "2026-01-01" });
    expect(parsed.answers.email).toBe("a@b.com");
    expect(FormResponse.safeParse({ id: "r1", submittedAt: "x" }).success).toBe(false); // no answers
    expect(FormResponse.safeParse({ id: "r1", answers: { n: 5 }, submittedAt: "x" }).success).toBe(false); // non-string answer
  });

  it("FormResponseList requires items, total and columns", () => {
    const parsed = FormResponseList.parse({ items: [], total: 0, columns: ["email"] });
    expect(parsed.columns).toEqual(["email"]);
    expect(FormResponseList.safeParse({ items: [], total: 0 }).success).toBe(false); // no columns
    expect(FormResponseList.safeParse({ items: [], total: "0", columns: [] }).success).toBe(false);
  });

  it("PublicForm carries the workspace name and visible fields, not counts/timestamps", () => {
    const parsed = PublicForm.parse({ slug: "s", title: "t", description: "", fields: [field], workspace: "Acme" });
    expect(parsed.workspace).toBe("Acme");
    expect(PublicForm.safeParse({ slug: "s", title: "t", description: "", fields: [field] }).success).toBe(false); // no workspace
  });
});

describe("SubmitFormInput / SubmitFormResult shapes", () => {
  it("SubmitFormInput requires an answers record", () => {
    expect(SubmitFormInput.parse({ answers: { a: 1 } }).answers).toEqual({ a: 1 }); // values are unknown
    expect(SubmitFormInput.safeParse({}).success).toBe(false);
  });
  it("SubmitFormResult requires ok and defaults errors to an empty map", () => {
    const parsed = SubmitFormResult.parse({ ok: true });
    expect(parsed.ok).toBe(true);
    expect(parsed.errors).toEqual({}); // kills errors default({}) → {}-shape drop
    expect(SubmitFormResult.safeParse({ ok: "yes" }).success).toBe(false);
    expect(SubmitFormResult.safeParse({ ok: true, errors: { f: 5 } }).success).toBe(false); // errors are strings
  });
});

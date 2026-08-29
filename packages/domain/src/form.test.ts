import { describe, expect, it } from "vitest";
import { exportColumns, fieldKeyFrom, validateSubmission, withFieldKeys, type FormFieldDef } from "./form.js";

const field = (over: Partial<FormFieldDef> & { key: string; label: string }): FormFieldDef => ({
  type: "text",
  required: false,
  ...over,
});

describe("fieldKeyFrom", () => {
  it("slugifies a label", () => {
    expect(fieldKeyFrom("Your full name")).toBe("your_full_name");
    expect(fieldKeyFrom("E-mail address!")).toBe("e_mail_address");
  });

  it("falls back rather than producing an empty key", () => {
    expect(fieldKeyFrom("???")).toBe("field");
    expect(fieldKeyFrom("")).toBe("field");
  });

  it("disambiguates a label used twice instead of colliding", () => {
    // Two "Address" fields must not overwrite each other's answers.
    expect(fieldKeyFrom("Address", new Set(["address"]))).toBe("address_2");
    expect(fieldKeyFrom("Address", new Set(["address", "address_2"]))).toBe("address_3");
  });
});

describe("withFieldKeys", () => {
  it("assigns keys only to fields that lack one", () => {
    const out = withFieldKeys([
      { key: "frozen", label: "Renamed Since", type: "text", required: false },
      { label: "New Field", type: "text", required: false },
    ]);
    // The existing key survives a label that no longer matches it — which is
    // the entire point: the label is what the form says, the key is what its
    // history means.
    expect(out[0]!.key).toBe("frozen");
    expect(out[1]!.key).toBe("new_field");
  });

  it("does not let a new field take an existing key", () => {
    const out = withFieldKeys([
      { key: "name", label: "Name", type: "text", required: false },
      { label: "Name", type: "text", required: false },
    ]);
    expect(out[1]!.key).toBe("name_2");
  });
});

describe("validateSubmission", () => {
  const fields = [
    field({ key: "name", label: "Name", required: true }),
    field({ key: "email", label: "Email", type: "email" }),
    field({ key: "age", label: "Age", type: "number" }),
    field({ key: "plan", label: "Plan", type: "select", options: ["Free", "Pro"] }),
  ];

  it("accepts a good submission and trims it", () => {
    const r = validateSubmission(fields, { name: "  Ada  ", email: "ada@example.com" });
    expect(r.ok).toBe(true);
    expect(r.answers).toEqual({ name: "Ada", email: "ada@example.com" });
  });

  it("requires what is marked required, and blank does not count", () => {
    expect(validateSubmission(fields, {}).errors.name).toContain("required");
    expect(validateSubmission(fields, { name: "   " }).errors.name).toContain("required");
  });

  it("keys errors by field key so the UI can place them", () => {
    const r = validateSubmission(fields, { name: "Ada", email: "not-an-email" });
    expect(r.ok).toBe(false);
    expect(Object.keys(r.errors)).toEqual(["email"]);
  });

  it("rejects a select value that is not one of the choices", () => {
    // Otherwise a dropdown stores free text and every report on it is wrong.
    expect(validateSubmission(fields, { name: "Ada", plan: "Enterprise" }).ok).toBe(false);
    expect(validateSubmission(fields, { name: "Ada", plan: "Pro" }).ok).toBe(true);
  });

  it("rejects a non-numeric number", () => {
    expect(validateSubmission(fields, { name: "Ada", age: "old" }).ok).toBe(false);
    expect(validateSubmission(fields, { name: "Ada", age: "41" }).ok).toBe(true);
  });

  it("drops undeclared keys instead of storing them", () => {
    // A stale tab must not be able to write unbounded junk into the answers.
    const r = validateSubmission(fields, { name: "Ada", sneaky: "x".repeat(10) });
    expect(r.ok).toBe(true);
    expect(r.answers.sneaky).toBeUndefined();
  });

  it("ignores non-string values rather than coercing them", () => {
    const r = validateSubmission(fields, { name: { toString: () => "Ada" } as unknown as string });
    expect(r.ok).toBe(false);
  });

  it("refuses an answer past the length cap", () => {
    expect(validateSubmission(fields, { name: "x".repeat(4001) }).ok).toBe(false);
  });
});

describe("exportColumns", () => {
  const fields = [field({ key: "name", label: "Name" }), field({ key: "email", label: "Email" })];

  it("lists the current fields in order", () => {
    expect(exportColumns(fields, [])).toEqual(["name", "email"]);
  });

  it("includes a key from a since-deleted field", () => {
    // Deleting a field must not quietly destroy the answers people gave it in
    // the one artefact meant to be the durable record.
    const responses = [{ answers: { name: "Ada", phone: "123" } }];
    expect(exportColumns(fields, responses)).toEqual(["name", "email", "phone"]);
  });

  it("never repeats a column", () => {
    const responses = [{ answers: { name: "A", phone: "1" } }, { answers: { phone: "2" } }];
    expect(exportColumns(fields, responses)).toEqual(["name", "email", "phone"]);
  });
});

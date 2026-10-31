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

  it("trims a leading or trailing separator", () => {
    expect(fieldKeyFrom("  Name  ")).toBe("name");
    expect(fieldKeyFrom("__a__")).toBe("a");
    expect(fieldKeyFrom("_")).toBe("field");
    expect(fieldKeyFrom(`a${"_".repeat(50_000)}!${"_".repeat(50_000)}b`)).toBe("a_b");
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


/* #894 — mutation testing. These pin the key-trimming boundary, the exact
   validation messages, and the email regex anchors that the suite above left
   unasserted. */
describe("fieldKeyFrom — trimming boundary", () => {
  it("keeps a single interior character rather than trimming it away", () => {
    // A one-char label must not be sliced to empty by the trailing-underscore
    // slice (underscored.length > 1 guard). "A" -> "a", not "field".
    expect(fieldKeyFrom("A")).toBe("a");
    expect(fieldKeyFrom("Z!")).toBe("z");
  });

  it("caps the base at 40 characters", () => {
    expect(fieldKeyFrom("a".repeat(50))).toBe("a".repeat(40));
  });

  it("suffixes a Date-based key only after exhausting _2.._999", () => {
    // Build a taken set of base plus base_2..base_999 and confirm the fallback
    // is base_<digits>, proving the loop bound is 1000, not smaller.
    const taken = new Set<string>(["dup"]);
    for (let n = 2; n < 1000; n++) taken.add(`dup_${n}`);
    const key = fieldKeyFrom("Dup", taken);
    expect(key).toMatch(/^dup_\d{10,}$/); // a timestamp, not dup_2
  });
});

describe("validateSubmission — exact messages and boundaries", () => {
  const fields = [
    field({ key: "name", label: "Name", required: true }),
    field({ key: "email", label: "Email", type: "email" }),
    field({ key: "plan", label: "Plan", type: "select", options: ["Free", "Pro"] }),
  ];

  it("uses the field label verbatim in each message", () => {
    expect(validateSubmission(fields, {}).errors.name).toBe("Name is required.");
    expect(validateSubmission(fields, { name: "A", email: "nope" }).errors.email).toBe(
      "Email needs to look like an email address.",
    );
    expect(validateSubmission(fields, { name: "A", plan: "Team" }).errors.plan).toBe("Plan isn't one of the choices.");
    expect(validateSubmission(fields, { name: "x".repeat(4001) }).errors.name).toBe("Name is too long.");
  });

  it("accepts exactly 4000 chars and rejects 4001 (the length boundary)", () => {
    expect(validateSubmission(fields, { name: "x".repeat(4000) }).ok).toBe(true);
    expect(validateSubmission(fields, { name: "x".repeat(4001) }).ok).toBe(false);
  });

  it("anchors the email regex at both ends", () => {
    // Leading/trailing junk around an otherwise-valid address must be rejected
    // — kills the `^`-drop and `$`-drop regex mutants.
    expect(validateSubmission(fields, { name: "A", email: "ada@example.com" }).ok).toBe(true);
    expect(validateSubmission(fields, { name: "A", email: "x ada@example.com" }).errors.email).toBeDefined();
    expect(validateSubmission(fields, { name: "A", email: "ada@example.com y" }).errors.email).toBeDefined();
  });

  it("only constrains a select that actually declares options", () => {
    // A select with no options accepts any non-empty value (kills the
    // `field.options?.length` short-circuit and optional-chaining mutants).
    const open = [field({ key: "note", label: "Note", type: "select" })];
    expect(validateSubmission(open, { note: "anything at all" }).ok).toBe(true);
    const empty = [field({ key: "note", label: "Note", type: "select", options: [] })];
    expect(validateSubmission(empty, { note: "anything at all" }).ok).toBe(true);
  });
});


/* #894 — mutation testing, second pass. */
describe("withFieldKeys — new keyless fields are deduped against each other", () => {
  it("gives two keyless fields with the same label distinct keys", () => {
    // If the `taken` set were not seeded from existing keys, or a new key were
    // not added back to it, both would collapse to the same key and the second
    // field's answers would overwrite the first's.
    const out = withFieldKeys([
      { label: "Address", type: "text", required: false },
      { label: "Address", type: "text", required: false },
    ]);
    expect(out[0]!.key).toBe("address");
    expect(out[1]!.key).toBe("address_2");
    expect(out[0]!.key).not.toBe(out[1]!.key);
  });

  it("seeds the taken set from pre-existing keys so a generated key avoids them", () => {
    const out = withFieldKeys([
      { key: "address", label: "Frozen", type: "text", required: false },
      { label: "Address", type: "text", required: false },
    ]);
    expect(out[1]!.key).toBe("address_2");
  });
});

describe("validateSubmission — number field message", () => {
  const fields = [field({ key: "age", label: "Age", type: "number", required: false })];
  it("uses the exact 'needs to be a number' copy", () => {
    expect(validateSubmission(fields, { age: "not-a-number" }).errors.age).toBe("Age needs to be a number.");
    expect(validateSubmission(fields, { age: "42" }).ok).toBe(true);
    expect(validateSubmission(fields, { age: "3.14" }).ok).toBe(true);
  });
});


/* #894 — mutation testing, third pass: the select-only option check must not
   fire for a non-select field, even one that happens to carry options. */
describe("validateSubmission — option check is gated on type === select", () => {
  it("accepts any value for a non-select field even when it declares options", () => {
    // The `field.type === "select"` guard must hold: a text field with options
    // present must NOT have its value constrained to those options. Forcing the
    // guard true would reject "freeform" here.
    const fields = [field({ key: "note", label: "Note", type: "text", options: ["A", "B"] })];
    expect(validateSubmission(fields, { note: "freeform value" }).ok).toBe(true);
  });

  it("still constrains a genuine select to its options", () => {
    const fields = [field({ key: "plan", label: "Plan", type: "select", options: ["Free", "Pro"] })];
    expect(validateSubmission(fields, { plan: "Enterprise" }).ok).toBe(false);
    expect(validateSubmission(fields, { plan: "Pro" }).ok).toBe(true);
  });
});

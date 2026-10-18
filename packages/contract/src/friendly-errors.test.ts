import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  AddDomainInput,
  CreateWebhookInput,
  CreateLinkInput,
  PasswordResetRequestInput,
  RegisterInput,
  dedupeIssuesByField,
  fieldLabel,
  friendlyApiMessage,
  issuesToSentence,
} from "./index.js";

/* #792 — raw zod English ("Too big: expected string to have <=80 characters")
   reached users. Every assertion drives REAL invalid input through a contract
   schema and checks the words a person would read.

   Oracle: the issue's acceptance criteria — no `field:` prefix, no zod default
   English, one message per field, and an empty required field says it is
   required rather than "Invalid". */

const messages = (schema: z.ZodType, input: unknown): string[] => {
  const r = schema.safeParse(input);
  if (r.success) throw new Error("expected the input to be rejected");
  return r.error.issues.map((i) => i.message);
};

const ZOD_ENGLISH = /Too big|Too small|Invalid input|Invalid email|Invalid option|Invalid string|Invalid URL|expected .* to have/;

describe("default validation copy", () => {
  it("names the limit for an over-long name (the exact case from the issue)", () => {
    const m = messages(RegisterInput, { name: "x".repeat(81), email: "a@example.com", password: "a-long-enough-password" });
    expect(m).toEqual(["Name must be 80 characters or fewer"]);
  });

  it("says an empty email is required, not invalid", () => {
    expect(messages(PasswordResetRequestInput, { email: "" })).toEqual(["Email is required"]);
  });

  it("says a missing field is required", () => {
    expect(messages(RegisterInput, {})).toEqual(["Name is required", "Email is required", "Password is required"]);
  });

  it("still calls a non-empty malformed email invalid", () => {
    expect(messages(PasswordResetRequestInput, { email: "nope" })).toEqual(["Enter a valid email address"]);
  });

  it("treats a whitespace-only name as required (trim runs before min)", () => {
    expect(messages(RegisterInput.pick({ name: true }), { name: "   " })).toEqual(["Name is required"]);
  });

  it("reports the boundary exactly: 80 is fine, 81 is not", () => {
    expect(RegisterInput.pick({ name: true }).safeParse({ name: "x".repeat(80) }).success).toBe(true);
    expect(RegisterInput.pick({ name: true }).safeParse({ name: "x".repeat(81) }).success).toBe(false);
  });

  it("uses the singular for a limit of one", () => {
    const S = z.object({ code: z.string().max(1) });
    expect(messages(S, { code: "ab" })).toEqual(["Code must be 1 character or fewer"]);
  });

  it("explains number problems in words", () => {
    const S = z.object({ retentionYears: z.number().int().min(1).max(100), tries: z.number() });
    expect(messages(S, { retentionYears: 0, tries: 1 })).toEqual(["Retention must be at least 1"]);
    expect(messages(S, { retentionYears: 101, tries: 1 })).toEqual(["Retention must be 100 or less"]);
    expect(messages(S, { retentionYears: 1.5, tries: 1 })).toEqual(["Retention must be a whole number"]);
    expect(messages(S, { retentionYears: 2, tries: "3" })).toEqual(["Tries must be a number"]);
  });

  it("explains list problems", () => {
    expect(messages(CreateWebhookInput, { endpoint: "https://example.com/h", events: [] })).toEqual([
      "Events needs at least one item",
    ]);
    expect(messages(z.object({ tags: z.array(z.string()).max(2) }), { tags: ["a", "b", "c"] })).toEqual([
      "Tags can have at most 2 items",
    ]);
  });

  it("explains an unknown enum choice", () => {
    expect(messages(z.object({ role: z.enum(["editor", "viewer"]) }), { role: "boss" })).toEqual([
      "Choose a valid option for role",
    ]);
  });

  it("never emits zod's default English for any of the above", () => {
    const all = [
      ...messages(RegisterInput, {}),
      ...messages(RegisterInput, { name: 7, email: 7, password: 7 }),
      ...messages(CreateWebhookInput, { endpoint: "", events: [] }),
      ...messages(CreateLinkInput, { destination: "not a url", domain: "" }),
      ...messages(AddDomainInput, { domain: "" }),
    ];
    for (const m of all) expect(m, m).not.toMatch(ZOD_ENGLISH);
  });

  it("leaves hand-written schema messages alone", () => {
    expect(messages(RegisterInput.pick({ password: true }), { password: "short" })).toEqual([
      "Use at least 12 characters — length beats complexity",
    ]);
    expect(messages(CreateWebhookInput, { endpoint: "http://127.0.0.1/x", events: ["link.created"] })).toEqual([
      "That host isn't allowed (private, loopback or link-local address)",
    ]);
  });

  it("applies to schemas defined outside the contract too (one zod instance in the app)", () => {
    expect(messages(z.object({ name: z.string().max(5) }), { name: "toolong" })).toEqual([
      "Name must be 5 characters or fewer",
    ]);
  });
});

describe("fieldLabel", () => {
  it("uses the product's word for the field", () => {
    expect(fieldLabel(["slug"])).toBe("Back-half");
    expect(fieldLabel(["endpoint"])).toBe("Endpoint URL");
  });
  it("humanises an unlisted camelCase key", () => {
    expect(fieldLabel(["displayName"])).toBe("Display name");
  });
  it("numbers list items from one", () => {
    expect(fieldLabel(["tags", 2])).toBe("Tags item 3");
  });
  it("is empty for a root-level issue", () => {
    expect(fieldLabel([])).toBe("");
  });
});

describe("one message per field", () => {
  it("collapses the three contradictory messages a mistyped destination used to produce", () => {
    const r = CreateLinkInput.safeParse({ destination: "not-a-url", domain: "snap.example" });
    expect(r.success).toBe(false);
    if (r.success) return;
    // Before the fix the raw issue list held several entries for `destination`.
    expect(r.error.issues.filter((i) => i.path[0] === "destination").length).toBeGreaterThan(1);
    const deduped = dedupeIssuesByField(r.error.issues);
    expect(deduped).toEqual([{ path: "destination", message: "Enter an absolute http(s) URL" }]);
    expect(issuesToSentence(r.error.issues)).toBe("Enter an absolute http(s) URL.");
  });

  it("keeps the first-reported order across different fields", () => {
    const r = RegisterInput.safeParse({});
    if (r.success) throw new Error("rejected expected");
    expect(dedupeIssuesByField(r.error.issues).map((i) => i.path)).toEqual(["name", "email", "password"]);
    expect(issuesToSentence(r.error.issues)).toBe("Name is required. Email is required. Password is required.");
  });
});

describe("friendlyApiMessage — messages from a server that predates this change", () => {
  it.each([
    ["name: Too big: expected string to have <=80 characters", "Name must be 80 characters or fewer"],
    ["name: Too small: expected string to have >=1 characters", "Name is required"],
    ["email: Invalid input: expected string, received undefined", "Email is required"],
    ["email: Invalid email address", "Enter a valid email address"],
    ["events: Too small: expected array to have >=1 items", "Events needs at least one item"],
    ["tags: Too big: expected array to have <=5 items", "Tags can have at most 5 items"],
    ["retentionYears: Too small: expected number to be >=1", "Retention must be at least 1"],
    ["destination: Enter an absolute http(s) URL", "Enter an absolute http(s) URL"],
    ["endpoint: That host isn't allowed (private, loopback or link-local address)", "That host isn't allowed (private, loopback or link-local address)"],
    ["Too big: expected string to have <=80 characters", "This field must be 80 characters or fewer"],
  ])("%s", (raw, expected) => {
    expect(friendlyApiMessage(raw)).toBe(expected);
  });

  it("returns every other message untouched", () => {
    for (const m of [
      "Row 1 already asks for /spring in this batch.",
      "Error: something broke",
      "That password isn't right.",
      "Unauthorized",
      "",
    ]) {
      expect(friendlyApiMessage(m)).toBe(m);
    }
  });
});

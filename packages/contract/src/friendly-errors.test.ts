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
  friendlyIssueMessage,
  installFriendlyValidationMessages,
  issuesToSentence,
} from "./index.js";
import type { RawIssue } from "./friendly-errors.js";

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
      "Events must have at least one item",
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

/* Review of PR #837: a strict object rejects an unknown key at the ROOT, whose
   zod path is empty. Dropping "which key" makes AnalyticsQuery's `rnge` typo
   (its documented invariant: "a 400 naming the offending key") undiscoverable
   to an API-key client. The key must survive in the sentence AND in issues[]. */
describe("strict objects keep the offending key", () => {
  const Strict = z.object({ range: z.string().optional() }).strict();
  const parse = (schema: z.ZodType, input: unknown) => {
    const r = schema.safeParse(input);
    if (r.success) throw new Error("rejected expected");
    return r.error.issues;
  };

  it("names the unknown key in the sentence and exposes it as issues[].path", () => {
    expect(dedupeIssuesByField(parse(Strict, { rnge: "7d" }))).toEqual([
      { path: "rnge", message: "“rnge” isn't a field we recognise", code: "unrecognized_key" },
    ]);
  });

  it("reports every unknown key, one issue each", () => {
    expect(dedupeIssuesByField(parse(Strict, { from: "a", to: "b" })).map((i) => i.path)).toEqual(["from", "to"]);
  });

  it("addresses a nested unknown key by its full path", () => {
    const Nested = z.object({ filter: z.object({ a: z.string().optional() }).strict() });
    expect(dedupeIssuesByField(parse(Nested, { filter: { bad: 1 } })).map((i) => i.path)).toEqual(["filter.bad"]);
  });

  it("does not collapse two different root-level problems into one", () => {
    const Two = z.object({}).superRefine((_v, ctx) => {
      ctx.addIssue({ code: "custom", message: "First root problem" });
      ctx.addIssue({ code: "custom", message: "Second root problem" });
    });
    expect(dedupeIssuesByField(parse(Two, {})).map((i) => i.message)).toEqual(["First root problem", "Second root problem"]);
  });

  it("keeps the key in the sentence from friendlyIssueMessage and in a legacy server message", () => {
    expect(friendlyIssueMessage({ code: "unrecognized_keys", keys: ["rnge"], path: [] })).toBe("“rnge” isn't a field we recognise");
    expect(friendlyApiMessage('Unrecognized key: "rnge"')).toBe("“rnge” isn't a field we recognise");
  });

  it("does not echo an enormous key back unbounded in the sentence", () => {
    const [issue] = dedupeIssuesByField(parse(Strict, { ["k".repeat(500)]: 1 }));
    expect(issue!.message.length).toBeLessThan(120);
  });
});

describe("list-length copy is grammatical for a plural subject", () => {
  it("says 'must have at least one item', not 'Events needs'", () => {
    expect(messages(CreateWebhookInput, { endpoint: "https://example.com/h", events: [] })).toEqual([
      "Events must have at least one item",
    ]);
  });
});

describe("friendlyApiMessage — messages from a server that predates this change", () => {
  it.each([
    ["name: Too big: expected string to have <=80 characters", "Name must be 80 characters or fewer"],
    ["name: Too small: expected string to have >=1 characters", "Name is required"],
    ["email: Invalid input: expected string, received undefined", "Email is required"],
    ["email: Invalid email address", "Enter a valid email address"],
    ["events: Too small: expected array to have >=1 items", "Events must have at least one item"],
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


/* #895: the branches of this module mutation testing showed uncovered —
   driven directly on friendlyIssueMessage / fieldLabel / fromZodDefault via
   friendlyApiMessage. Each assertion names the exact wording a reader sees, so
   a weakened branch (a dropped switch case, a flipped bound, a broken regex)
   turns this red. */

describe("fieldLabel — nested list items (numeric path recursion)", () => {
  it("labels a nested list item through its parent (kills the path.length>1 branch)", () => {
    // rules[2] → "Redirect URL item 3"? No — `then` is the URL; here a bare numeric tail.
    expect(fieldLabel(["tags", 2])).toBe("Tags item 3"); // last+1 (kills the +1 unary/arith mutant)
    expect(fieldLabel(["rules", 0, "then"])).toBe("Redirect URL"); // last is a known key, not numeric
    // A number at the root with no parent falls back to "Item" (kills the `${parent || "Item"}` + /^Item item/).
    expect(fieldLabel([0])).toBe("Item 1");
    // Two numeric levels: parent is itself a list item.
    expect(fieldLabel(["blocks", 1, 0])).toBe("Blocks item 2 item 1");
  });
});

describe("friendlyIssueMessage — every invalid_type branch", () => {
  const t = (expected: string) => friendlyIssueMessage({ code: "invalid_type", expected, input: 123, path: ["f"] });
  it("maps each expected type to its own sentence", () => {
    expect(t("int")).toBe("F must be a whole number");
    expect(t("number")).toBe("F must be a number");
    expect(t("nan")).toBe("F must be a number");
    expect(t("string")).toBe("F must be text");
    expect(t("boolean")).toBe("F must be yes or no"); // kills the boolean case drop
    expect(t("array")).toBe("F must be a list"); // kills the array case drop
    expect(t("bigint")).toBe("F isn't valid"); // default branch
  });
  it("an absent/blank value is 'required' whatever shape it also breaks", () => {
    expect(friendlyIssueMessage({ code: "invalid_type", expected: "string", input: undefined, path: ["f"] })).toBe("F is required");
    expect(friendlyIssueMessage({ code: "invalid_format", format: "email", input: "", path: ["f"] })).toBe("F is required"); // kills the L120 && chain
    // a non-empty invalid_format is NOT treated as required
    expect(friendlyIssueMessage({ code: "invalid_format", format: "email", input: "nope", path: ["f"] })).toBe("Enter a valid email address");
  });
});

describe("friendlyIssueMessage — too_small / too_big exclusive bounds and set origin", () => {
  it("inclusive vs exclusive string minimum (kills the inclusive===false and min+1 arithmetic)", () => {
    // inclusive min(5): "at least 5 characters"
    expect(friendlyIssueMessage({ code: "too_small", origin: "string", minimum: 5, inclusive: true, path: ["f"] })).toBe(
      "F must be at least 5 characters",
    );
    // exclusive min(5) means the value must be > 5, i.e. at least 6 characters
    expect(friendlyIssueMessage({ code: "too_small", origin: "string", minimum: 5, inclusive: false, path: ["f"] })).toBe(
      "F must be at least 6 characters",
    );
  });
  it("array/set minimum uses item wording with the exclusive bump", () => {
    expect(friendlyIssueMessage({ code: "too_small", origin: "array", minimum: 1, inclusive: true, path: ["f"] })).toBe(
      "F must have at least one item",
    );
    expect(friendlyIssueMessage({ code: "too_small", origin: "set", minimum: 2, inclusive: true, path: ["f"] })).toBe(
      "F must have at least 2 items",
    );
    // exclusive min(1) on a set → at least 2 items (kills the n<=1 branch + min+1)
    expect(friendlyIssueMessage({ code: "too_small", origin: "set", minimum: 1, inclusive: false, path: ["f"] })).toBe(
      "F must have at least 2 items",
    );
  });
  it("non-string/array origin minimum (a number) reads greater-than vs at-least", () => {
    expect(friendlyIssueMessage({ code: "too_small", origin: "number", minimum: 3, inclusive: true, path: ["f"] })).toBe(
      "F must be at least 3",
    );
    expect(friendlyIssueMessage({ code: "too_small", origin: "number", minimum: 3, inclusive: false, path: ["f"] })).toBe(
      "F must be greater than 3",
    );
  });
  it("too_big for string / array / number, inclusive and exclusive (kills max-1 arithmetic)", () => {
    expect(friendlyIssueMessage({ code: "too_big", origin: "string", maximum: 80, inclusive: true, path: ["f"] })).toBe(
      "F must be 80 characters or fewer",
    );
    expect(friendlyIssueMessage({ code: "too_big", origin: "string", maximum: 80, inclusive: false, path: ["f"] })).toBe(
      "F must be 79 characters or fewer",
    );
    expect(friendlyIssueMessage({ code: "too_big", origin: "array", maximum: 5, inclusive: true, path: ["f"] })).toBe(
      "F can have at most 5 items",
    );
    expect(friendlyIssueMessage({ code: "too_big", origin: "set", maximum: 5, inclusive: false, path: ["f"] })).toBe(
      "F can have at most 4 items",
    );
    expect(friendlyIssueMessage({ code: "too_big", origin: "number", maximum: 100, inclusive: true, path: ["f"] })).toBe(
      "F must be 100 or less",
    );
    expect(friendlyIssueMessage({ code: "too_big", origin: "number", maximum: 100, inclusive: false, path: ["f"] })).toBe(
      "F must be less than 100",
    );
  });
});

describe("friendlyIssueMessage — invalid_format, invalid_value, not_multiple_of, unrecognized_keys", () => {
  it("maps each format to its own sentence (kills the url/uuid/guid/default cases)", () => {
    expect(friendlyIssueMessage({ code: "invalid_format", format: "email", input: "x", path: ["f"] })).toBe("Enter a valid email address");
    expect(friendlyIssueMessage({ code: "invalid_format", format: "url", input: "x", path: ["f"] })).toBe("Enter a valid URL");
    expect(friendlyIssueMessage({ code: "invalid_format", format: "uuid", input: "x", path: ["f"] })).toBe("F isn't a valid ID");
    expect(friendlyIssueMessage({ code: "invalid_format", format: "guid", input: "x", path: ["f"] })).toBe("F isn't a valid ID");
    expect(friendlyIssueMessage({ code: "invalid_format", format: "regex", input: "x", path: ["f"] })).toBe("F isn't in a valid format");
  });
  it("invalid_value reads differently with vs without a label", () => {
    expect(friendlyIssueMessage({ code: "invalid_value", path: ["role"] })).toBe("Choose a valid option for role");
    expect(friendlyIssueMessage({ code: "invalid_value", path: [] })).toBe("Choose one of the available options");
  });
  it("not_multiple_of names the divisor (kills the case drop)", () => {
    expect(friendlyIssueMessage({ code: "not_multiple_of", divisor: 5, path: ["f"] })).toBe("F must be a multiple of 5");
  });
  it("unrecognized_keys is singular vs plural and empty-safe (kills keys.length>0 / ===1 branches)", () => {
    expect(friendlyIssueMessage({ code: "unrecognized_keys", keys: ["a"], path: [] })).toBe("“a” isn't a field we recognise");
    expect(friendlyIssueMessage({ code: "unrecognized_keys", keys: ["a", "b"], path: [] })).toBe("“a”, “b” aren't fields we recognise");
    expect(friendlyIssueMessage({ code: "unrecognized_keys", keys: [], path: [] })).toBe("That request included something we don't recognise");
  });
  it("an unknown code falls through to the generic sentence", () => {
    expect(friendlyIssueMessage({ code: "invalid_union", path: ["f"] })).toBe("F isn't valid");
  });
});

describe("fromZodDefault (via friendlyApiMessage) — legacy server message shapes", () => {
  it("recognises each default zod string and rewrites it (kills the L287-302 regexes + {} objects)", () => {
    expect(friendlyApiMessage("f: Invalid input: expected string, received null")).toBe("F is required"); // null → blank
    expect(friendlyApiMessage("f: Invalid input: expected number, received string")).toBe("F must be a number");
    expect(friendlyApiMessage("f: Invalid URL")).toBe("Enter a valid URL"); // kills the "Invalid URL" {} object
    expect(friendlyApiMessage("f: Invalid string: must match pattern")).toBe("F isn't in a valid format"); // regex format
    expect(friendlyApiMessage("f: Invalid option: expected one of x")).toBe("Choose a valid option for f"); // invalid_value
    expect(friendlyApiMessage("f: Invalid input")).toBe("F isn't valid"); // custom code
    expect(friendlyApiMessage('Unrecognized key: "rnge"')).toBe("“rnge” isn't a field we recognise");
    expect(friendlyApiMessage('Unrecognized keys: "a", "b"')).toBe("“a”, “b” aren't fields we recognise");
  });
  it("a numeric path segment in a legacy prefix becomes a list-item label (kills the /^\\d+$/ regex)", () => {
    // `tags.2: Too small…` → the `2` is parsed as an index, so the label is "Tags item 3".
    expect(friendlyApiMessage("tags.2: Too small: expected string to have >=1 characters")).toBe("Tags item 3 is required");
  });
  it("leaves a message that matches no known shape untouched, keeping only its prefix stripped", () => {
    expect(friendlyApiMessage("field: A perfectly human sentence.")).toBe("A perfectly human sentence.");
    expect(friendlyApiMessage("No prefix, no known shape")).toBe("No prefix, no known shape");
  });
});

describe("issuesToSentence — trailing punctuation (kills the /[.!?]$/ regex)", () => {
  it("adds a full stop only when the message lacks terminal punctuation", () => {
    const withPeriod: RawIssue[] = [{ code: "custom", path: [], message: "Already ends." } as unknown as RawIssue];
    // issuesToSentence takes DedupeInput; build messages that already end in punctuation vs not.
    expect(issuesToSentence([{ path: [], message: "Ends with a period." }])).toBe("Ends with a period.");
    expect(issuesToSentence([{ path: [], message: "No terminal mark" }])).toBe("No terminal mark.");
    expect(issuesToSentence([{ path: [], message: "Bang!" }])).toBe("Bang!");
    expect(issuesToSentence([{ path: [], message: "Really?" }])).toBe("Really?");
    void withPeriod;
  });
});

describe("installFriendlyValidationMessages — idempotent (kills the `installed` guard mutants)", () => {
  it("can be called again without throwing and leaves the fallback in place", () => {
    expect(() => installFriendlyValidationMessages()).not.toThrow();
    expect(() => installFriendlyValidationMessages()).not.toThrow();
    // the fallback still produces friendly copy for a schema with no own message
    expect(messages(z.object({ name: z.string().max(3) }), { name: "toolong" })).toEqual(["Name must be 3 characters or fewer"]);
  });
});


/* #895: the remaining friendly-errors branches, pinned by direct calls so each
   predicate, regex anchor and fallback is exercised. */
describe("friendly-errors residual-branch kills", () => {
  it("humanise splits camelCase and collapses _ and - runs (kills the replace-chain mutants)", () => {
    expect(fieldLabel(["someLongKey"])).toBe("Some long key"); // camelCase split
    expect(fieldLabel(["snake_case_key"])).toBe("Snake case key"); // _ runs → spaces
    expect(fieldLabel(["kebab-case-key"])).toBe("Kebab case key"); // - runs → spaces
    expect(fieldLabel(["a__b--c"])).toBe("A b c"); // runs of mixed separators collapse to one space
  });

  it("fieldLabel numeric recursion: with vs without a parent (kills path.length>1 and >=1)", () => {
    expect(fieldLabel([3])).toBe("Item 4"); // no parent → "Item"
    expect(fieldLabel(["tags", 3])).toBe("Tags item 4"); // parent present
    expect(fieldLabel(["a", "b", 0])).toBe("B item 1"); // parent is the label of the last non-numeric segment
  });

  it("isBlank distinguishes blank from present (kills the || clause and the v.trim mutant)", () => {
    // via friendlyIssueMessage: a blank string input on invalid_type → required;
    // a whitespace-only string is blank; a non-empty string is NOT blank.
    expect(friendlyIssueMessage({ code: "invalid_type", expected: "string", input: "   ", path: ["f"] })).toBe("F is required");
    expect(friendlyIssueMessage({ code: "invalid_type", expected: "string", input: null, path: ["f"] })).toBe("F is required");
    // a present (non-blank) wrong-typed value is NOT "required" — it is the type sentence
    expect(friendlyIssueMessage({ code: "invalid_type", expected: "number", input: "abc", path: ["f"] })).toBe("F must be a number");
  });

  it("quoteKey truncates only an over-long key (kills the > vs >= boundary)", () => {
    // 40 chars: exactly at MAX_ECHOED_KEY, NOT truncated (no ellipsis)
    const at = "k".repeat(40);
    const m40 = friendlyIssueMessage({ code: "unrecognized_keys", keys: [at], path: [] });
    expect(m40).toBe(`“${at}” isn't a field we recognise`);
    expect(m40).not.toContain("…");
    // 41 chars: truncated with an ellipsis
    const over = "k".repeat(41);
    const m41 = friendlyIssueMessage({ code: "unrecognized_keys", keys: [over], path: [] });
    expect(m41).toContain("…");
  });

  it("dedupeIssuesByField only expands unrecognized_keys that actually carry keys (kills the && chain and keys.length>0)", () => {
    // code matches but keys empty → NOT expanded, falls through to a plain push
    expect(dedupeIssuesByField([{ path: ["x"], message: "m", code: "unrecognized_keys", keys: [] }])).toEqual([
      { path: "x", message: "m" },
    ]);
    // code matches with keys → expanded one-per-key
    expect(
      dedupeIssuesByField([{ path: [], message: "ignored", code: "unrecognized_keys", keys: ["a", "b"] }]).map((i) => i.path),
    ).toEqual(["a", "b"]);
  });

  it("friendlyApiMessage legacy regexes are anchored at the start (kills the ^-drop mutants)", () => {
    // junk before a known shape must NOT be rewritten (the ^ keeps it pinned)
    expect(friendlyApiMessage("junk Invalid URL")).toBe("junk Invalid URL");
    expect(friendlyApiMessage("junk Invalid input: expected string, received undefined")).toBe(
      "junk Invalid input: expected string, received undefined",
    );
    // the exact shapes ARE rewritten
    expect(friendlyApiMessage("Invalid URL")).toBe("Enter a valid URL"); // url format
    expect(friendlyApiMessage("Invalid string: x")).toBe("This field isn't in a valid format"); // regex format, no path
    expect(friendlyApiMessage("Invalid option: x")).toBe("Choose one of the available options");
  });

  it("friendlyApiMessage numeric path segment: multi-digit index vs non-numeric key (kills the /^\\d+$/ anchors)", () => {
    // multi-digit index "12" → list item 13 (kills the /^\d$/ single-digit mutant)
    expect(friendlyApiMessage("tags.12: Invalid input: expected string, received undefined")).toBe("Tags item 13 is required");
    // a segment that only STARTS with digits is NOT an index (kills the $-drop)
    expect(friendlyApiMessage("a1b: Invalid input: expected string, received undefined")).toBe("A1b is required");
  });
});


describe("friendly-errors residual-branch kills, round 2 (#895)", () => {
  it("the invalid_format 'empty means required' rule needs ALL THREE conditions (kills the L120 force-true / || mutants)", () => {
    // empty string + invalid_format → required
    expect(friendlyIssueMessage({ code: "invalid_format", format: "email", input: "", path: ["f"] })).toBe("F is required");
    // non-empty string → NOT required (the input === "" clause matters)
    expect(friendlyIssueMessage({ code: "invalid_format", format: "email", input: "x@", path: ["f"] })).toBe("Enter a valid email address");
    // non-string input → NOT required (the typeof === "string" clause matters)
    expect(friendlyIssueMessage({ code: "invalid_format", format: "email", input: 123, path: ["f"] })).toBe("Enter a valid email address");
    // a different code with empty string → NOT this rule (the code === "invalid_format" clause matters)
    expect(friendlyIssueMessage({ code: "not_multiple_of", divisor: 5, input: "", path: ["f"] })).toBe("F must be a multiple of 5");
  });

  it("fromZodDefault only treats an Unrecognized message as keys when it actually quotes some (kills L305 >0)", () => {
    // no quoted keys → not recognised as unrecognized_keys → returned untouched
    expect(friendlyApiMessage("Unrecognized keys: ")).toBe("Unrecognized keys: ");
    // quoted keys → rewritten
    expect(friendlyApiMessage('Unrecognized keys: "a"')).toBe("“a” isn't a field we recognise");
  });

  it("every legacy regex stays anchored at the start (kills the remaining ^-drop mutants)", () => {
    for (const junk of [
      "xxInvalid input: expected string, received undefined",
      "xxToo big: expected string to have <=80 characters",
      'xxUnrecognized keys: "a"',
    ]) {
      expect(friendlyApiMessage(junk)).toBe(junk); // unchanged — the ^ anchor refuses a mid-string match
    }
  });

  it("dedupeIssuesByField requires the code AND an array of keys AND non-empty (kills the L249 && chain)", () => {
    // code matches, keys is NOT an array → falls through to a plain push
    expect(dedupeIssuesByField([{ path: ["x"], message: "m", code: "unrecognized_keys", keys: "notarray" as unknown as unknown[] }])).toEqual([
      { path: "x", message: "m" },
    ]);
    // code does NOT match but keys present → plain push, not expanded
    expect(dedupeIssuesByField([{ path: ["x"], message: "m", code: "too_small", keys: ["a"] }])).toEqual([
      { path: "x", message: "m" },
    ]);
  });
});

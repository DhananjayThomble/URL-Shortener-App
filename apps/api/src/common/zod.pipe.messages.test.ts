import { describe, expect, it } from "vitest";
import { BadRequestException } from "@nestjs/common";
import {
  AddDomainInput,
  BulkCreateLinksInput,
  CreateWebhookInput,
  PasswordResetRequestInput,
  RegisterInput,
} from "@snapurl/contract";
import { ZodValidationPipe, type ValidationErrorBody } from "./zod.pipe.js";
import { LinksService } from "../links/links.service.js";
import { toActor } from "./activity.js";

/* #792 — the words a person reads when the API rejects their input.

   Each case sends the exact invalid input QA used through the real pipe (the
   one every @Body(zodBody(...)) decorator runs) and asserts the response body:
   plain sentences, no `field:` path in front, one per field, and the field
   path kept separately in `issues` for clients that attach it to an input.

   Oracle: the issue's acceptance criteria, plus the surfaces it lists —
   /register, bulk create, /developers webhooks, /forgot-password. */

function rejection<T>(schema: import("zod").ZodType<T>, input: unknown): ValidationErrorBody {
  try {
    new ZodValidationPipe(schema).transform(input);
  } catch (err) {
    expect(err).toBeInstanceOf(BadRequestException);
    return (err as BadRequestException).getResponse() as ValidationErrorBody;
  }
  throw new Error("expected the pipe to reject this input");
}

const RAW = /Too big|Too small|Invalid input|Invalid email|Invalid option|expected .* to have/;
const FIELD_PREFIX = /^[a-z][\w.]*: /;

function expectHuman(body: ValidationErrorBody) {
  expect(body.statusCode).toBe(400);
  for (const m of body.message) {
    expect(m, m).not.toMatch(RAW);
    expect(m, m).not.toMatch(FIELD_PREFIX);
  }
}

describe("validation errors reach people as plain sentences", () => {
  it("/register: an over-long name", () => {
    const body = rejection(RegisterInput, { name: "n".repeat(81), email: "a@example.com", password: "a-long-enough-password" });
    expect(body.message).toEqual(["Name must be 80 characters or fewer"]);
    expect(body.issues).toEqual([{ path: "name", message: "Name must be 80 characters or fewer" }]);
    expectHuman(body);
  });

  it("/register: an empty body names every missing field once", () => {
    const body = rejection(RegisterInput, {});
    expect(body.message).toEqual(["Name is required", "Email is required", "Password is required"]);
    expectHuman(body);
  });

  it("/forgot-password: an empty email is required, not 'Invalid email address'", () => {
    const body = rejection(PasswordResetRequestInput, { email: "" });
    expect(body.message).toEqual(["Email is required"]);
    expectHuman(body);
  });

  it("/developers: a private webhook endpoint loses its 'endpoint:' prefix", () => {
    const body = rejection(CreateWebhookInput, { endpoint: "http://10.0.0.5/hook", events: ["link.created"] });
    expect(body.message).toEqual(["That host isn't allowed (private, loopback or link-local address)"]);
    expect(body.issues[0]!.path).toBe("endpoint");
    expectHuman(body);
  });

  it("/developers: no events selected", () => {
    const body = rejection(CreateWebhookInput, { endpoint: "https://example.com/hook", events: [] });
    expect(body.message).toEqual(["Events needs at least one item"]);
    expectHuman(body);
  });

  it("/domains: an empty domain", () => {
    const body = rejection(AddDomainInput, { domain: "" });
    expect(body.message).toHaveLength(1);
    expectHuman(body);
  });

  it("bulk envelope: no rows, too many rows", () => {
    expect(rejection(BulkCreateLinksInput, { links: [] }).message).toEqual(["Add at least one link."]);
    expect(rejection(BulkCreateLinksInput, { links: Array.from({ length: 101 }, () => ({})) }).message).toEqual([
      "100 links per batch.",
    ]);
  });

  it("a mistyped value is one message even when several rules trip over it", () => {
    const body = rejection(CreateWebhookInput, { endpoint: "not-a-url", events: ["link.created"] });
    expect(body.message).toHaveLength(1);
    expect(body.issues).toHaveLength(1);
    expectHuman(body);
  });
});

/* Bulk create parses each pasted row itself (see BulkCreateLinksInput), so the
   pipe never sees a bad row. Every row below fails validation before any
   query, so the database is a stub whose transaction has nothing to insert. */
describe("LinksService.bulkCreate — per-row validation copy", () => {
  const db = { transaction: async (fn: (tx: unknown) => unknown) => fn({}) };
  const service = new LinksService(db as never, db as never, {} as never, {} as never, {} as never);
  const actor = toActor({ userId: null, label: "test" });
  const row = (over: Record<string, unknown>) => ({ domain: "snap.example", ...over });

  it("one bad destination line is one sentence, with no 'destination:' prefix or repeats", async () => {
    const res = await service.bulkCreate("00000000-0000-4000-8000-000000000000", actor, {
      links: [row({ destination: "not-a-url" })],
    } as never);
    expect(res.failed).toBe(1);
    const r = res.results[0]!;
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("Enter an absolute http(s) URL.");
  });

  it("a row with several bad fields gets one sentence per field", async () => {
    const res = await service.bulkCreate("00000000-0000-4000-8000-000000000000", actor, {
      links: [row({ destination: "", comment: "c".repeat(281) })],
    } as never);
    const r = res.results[0]!;
    if (r.ok) throw new Error("expected a failure");
    expect(r.error).toBe("Where should this link go? Comment must be 280 characters or fewer.");
    expect(r.error).not.toMatch(FIELD_PREFIX);
    expect(r.error).not.toMatch(RAW);
  });

  it("a row missing its domain says what is missing", async () => {
    const res = await service.bulkCreate("00000000-0000-4000-8000-000000000000", actor, {
      links: [{ destination: "https://example.com/ok" }],
    } as never);
    const r = res.results[0]!;
    if (r.ok) throw new Error("expected a failure");
    expect(r.error).toBe("Domain is required.");
  });
});

/**
 * #792 — what the web client shows when a request is rejected for its content.
 *
 * Oracle: the issue's acceptance criteria. No user-facing string may carry a
 * `field:` prefix or zod's default English, one problem is one line, and an
 * empty required field reads as required. The API now sends plain sentences;
 * these tests also cover an OLDER API (deploy skew, a cached tab), which still
 * sends `name: Too big: expected string to have <=80 characters`, so the
 * client must never put that on screen either.
 */

import { describe, expect, it } from "vitest";
import { z } from "zod";
import { PasswordResetRequestInput, RegisterInput } from "@snapurl/contract";
import { toApiError } from "./client";

const bad = (message: string | string[], status = 400) =>
  new Response(JSON.stringify({ statusCode: status, error: "Bad Request", message }), {
    status,
    statusText: "Bad Request",
    headers: { "Content-Type": "application/json" },
  });

describe("toApiError — validation responses", () => {
  it("passes a current API's plain sentences through unchanged", async () => {
    const err = await toApiError(bad(["Name must be 80 characters or fewer"]), "/auth/register");
    expect(err.message).toBe("Name must be 80 characters or fewer");
  });

  it("rewrites the exact register string from the issue when an older API sends it", async () => {
    const err = await toApiError(bad(["name: Too big: expected string to have <=80 characters"]), "/auth/register");
    expect(err.message).toBe("Name must be 80 characters or fewer");
  });

  it("rewrites the webhook string from the issue", async () => {
    const err = await toApiError(bad(["endpoint: That host isn't allowed"]), "/webhooks");
    expect(err.message).toBe("That host isn't allowed");
  });

  it("shows one line, not three contradictory ones, for a repeated problem", async () => {
    const err = await toApiError(
      bad([
        "destination: Enter an absolute http(s) URL",
        "destination: Enter an absolute http(s) URL",
        "destination: Enter an absolute http(s) URL",
      ]),
      "/links",
    );
    expect(err.message).toBe("Enter an absolute http(s) URL");
  });

  it("says an empty field is required when an older API reports it as invalid input", async () => {
    const err = await toApiError(
      bad(["email: Invalid input: expected string, received undefined"]),
      "/auth/password-reset/request",
    );
    expect(err.message).toBe("Email is required");
  });

  it("keeps the raw body on .detail so a form can still read issues[]", async () => {
    const body = { message: ["Name is required"], issues: [{ path: "name", message: "Name is required" }] };
    const err = await toApiError(
      new Response(JSON.stringify(body), { status: 400, headers: { "Content-Type": "application/json" } }),
      "/auth/register",
    );
    expect((err.detail as typeof body).issues[0]!.path).toBe("name");
  });

  it("does not touch messages that merely contain a colon", async () => {
    const err = await toApiError(bad("Row 2: already exists"), "/links/bulk");
    expect(err.message).toBe("Row 2: already exists");
  });
});

describe("the web's own form validation uses the same words", () => {
  const messageFor = (schema: z.ZodType, input: unknown) => {
    const r = schema.safeParse(input);
    if (r.success) throw new Error("expected rejection");
    return r.error.issues[0]!.message;
  };

  it("/forgot-password, submitted empty, says the email is required (not 'Invalid email address')", () => {
    expect(messageFor(PasswordResetRequestInput, { email: "" })).toBe("Email is required");
  });

  it("a schema declared in the web app, with no message of its own, gets plain English", () => {
    // Same shape as the register page's schema: if the web's zod were a
    // different instance from the contract's, this would fall back to zod's
    // default English and the central mapping would silently not apply here.
    const Local = z.object({ name: z.string().max(80) });
    expect(messageFor(Local, { name: "n".repeat(81) })).toBe("Name must be 80 characters or fewer");
    expect(messageFor(RegisterInput.pick({ name: true }), { name: "n".repeat(81) })).toBe(
      "Name must be 80 characters or fewer",
    );
  });
});

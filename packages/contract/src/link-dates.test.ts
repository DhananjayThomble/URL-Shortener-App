import { describe, expect, it } from "vitest";
import { CreateLinkInput, Link, UpdateLinkInput } from "./link.js";

/* Issue #754 — `expiresAt` / `activatesAt` were bare `z.string()`, so a value
   that is not a date at all ("not-a-date") passed the contract and reached
   `new Date(value)` in the API, where Postgres rejected the Invalid Date and the
   caller got a 500 instead of a 400 naming the field.

   The tightening is INPUT-ONLY: the `Link` response schema is unchanged, so a
   row already stored with any value still loads. Whether a date is in the past
   is not decided here (that needs "now" and, on edit, the stored value — see
   validateExpiry in packages/domain). */

const base = { destination: "https://example.com/x", domain: "snap.to" };

describe("expiresAt / activatesAt on CreateLinkInput / UpdateLinkInput (#754)", () => {
  it.each([
    ["2026-01-01T00:00:00.000Z"],
    ["2026-01-01T00:00:00Z"],
    ["2026-01-01T05:30:00+05:30"],
    ["2026-01-01"],
    ["9999-12-31T23:59:59.999Z"],
  ])("accepts the date %s (past dates too — that is a domain rule, not a shape rule)", (value) => {
    for (const field of ["expiresAt", "activatesAt"] as const) {
      expect(CreateLinkInput.safeParse({ ...base, [field]: value }).success).toBe(true);
      expect(UpdateLinkInput.safeParse({ [field]: value }).success).toBe(true);
    }
  });

  it("keeps null (clear) and omitted (leave alone) valid and distinct", () => {
    for (const field of ["expiresAt", "activatesAt"] as const) {
      const cleared = UpdateLinkInput.safeParse({ [field]: null });
      expect(cleared.success && cleared.data[field]).toBeNull();
      const omitted = UpdateLinkInput.safeParse({});
      expect(omitted.success && omitted.data[field]).toBeUndefined();
    }
  });

  it.each([["not-a-date"], ["2026-13-45"], ["tomorrow"], [" "]])("refuses %j with a human message on the field", (value) => {
    for (const field of ["expiresAt", "activatesAt"] as const) {
      for (const parsed of [CreateLinkInput.safeParse({ ...base, [field]: value }), UpdateLinkInput.safeParse({ [field]: value })]) {
        expect(parsed.success).toBe(false);
        if (parsed.success) continue;
        expect(parsed.error.issues[0]?.path).toEqual([field]);
        expect(parsed.error.issues[0]?.message).toMatch(/valid date/i);
      }
    }
  });

  it("an empty string still means 'no date' (what an untouched field used to send), not an error", () => {
    expect(CreateLinkInput.safeParse({ ...base, expiresAt: "" }).success).toBe(true);
    expect(UpdateLinkInput.safeParse({ activatesAt: "" }).success).toBe(true);
  });

  it("the Link response schema is NOT tightened: an odd stored value still loads", () => {
    const row = {
      id: "l1", domain: "snap.to", slug: "s", destination: "https://example.com", status: "expired", clicks: 0,
      safeBrowsing: { status: "clean", checkedAt: "2026-01-01T00:00:00.000Z" }, createdAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "not-a-date", activatesAt: "whenever",
    };
    expect(Link.safeParse(row).success).toBe(true);
  });
});

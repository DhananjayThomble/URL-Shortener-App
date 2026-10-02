import { describe, expect, it } from "vitest";
import { RegisterInput } from "./auth.js";

/* Issue #637: registration accepted a whitespace-only name because validation
   ran on the untrimmed value (min(1) is satisfied by " ") and the service only
   trimmed afterwards, so an all-whitespace name was persisted as "". The fix is
   .trim() ahead of .min()/.max() in the contract — the single source of truth
   for this payload — so the untrimmed value never reaches a passing parse. */

describe("RegisterInput.name", () => {
  it("rejects a whitespace-only name", () => {
    expect(RegisterInput.safeParse({ name: "   ", email: "a@example.com", password: "a-long-enough-password" }).success).toBe(
      false,
    );
  });

  it("rejects a single tab character", () => {
    expect(RegisterInput.safeParse({ name: "\t", email: "a@example.com", password: "a-long-enough-password" }).success).toBe(
      false,
    );
  });

  it("still rejects an empty name", () => {
    expect(RegisterInput.safeParse({ name: "", email: "a@example.com", password: "a-long-enough-password" }).success).toBe(
      false,
    );
  });

  it("trims surrounding whitespace from an otherwise-valid name", () => {
    const result = RegisterInput.safeParse({
      name: "  Priya Raman  ",
      email: "a@example.com",
      password: "a-long-enough-password",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Priya Raman");
    }
  });

  it("accepts a normal name unchanged", () => {
    const result = RegisterInput.safeParse({
      name: "Priya Raman",
      email: "a@example.com",
      password: "a-long-enough-password",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Priya Raman");
    }
  });
});

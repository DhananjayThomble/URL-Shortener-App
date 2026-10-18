import { describe, expect, it } from "vitest";
import { CLICK_LIMIT_MAX, CreateLinkInput, UpdateLinkInput } from "./link.js";

/* Oracle (#758): `clickLimit` is stored in a Postgres `integer` column and the
   API expires a link when `clicks >= clickLimit`. So the only values that mean
   anything are `null` / omitted (no limit) and a whole number from 1 to
   2,147,483,647. Before this the contract accepted any number, so 0 (an instantly
   expired link), -5, 2.5 and 3e9 (an integer overflow in the database) were all
   "valid" payloads. */

const base = { destination: "https://example.com/x", domain: "snap.to" };

describe("clickLimit on CreateLinkInput / UpdateLinkInput", () => {
  it("CLICK_LIMIT_MAX is the largest Postgres integer", () => {
    expect(CLICK_LIMIT_MAX).toBe(2 ** 31 - 1);
  });

  it.each([[1], [2], [500], [CLICK_LIMIT_MAX]])("accepts %d", (clickLimit) => {
    expect(CreateLinkInput.safeParse({ ...base, clickLimit }).success).toBe(true);
    expect(UpdateLinkInput.safeParse({ clickLimit }).success).toBe(true);
  });

  it("keeps null (no limit) and omitted (leave alone / no limit) distinct and valid", () => {
    const withNull = CreateLinkInput.safeParse({ ...base, clickLimit: null });
    expect(withNull.success && withNull.data.clickLimit).toBeNull();
    const omitted = CreateLinkInput.safeParse(base);
    expect(omitted.success && omitted.data.clickLimit).toBeUndefined();
    expect(UpdateLinkInput.safeParse({ clickLimit: null }).success).toBe(true);
    expect(UpdateLinkInput.safeParse({}).success).toBe(true);
  });

  it.each([
    [0, "at least 1"],
    [-1, "at least 1"],
    [-5, "at least 1"],
    [CLICK_LIMIT_MAX + 1, "more than"],
    [3_000_000_000, "more than"],
    [1.5, "whole number"],
    [2.0000001, "whole number"],
    [Number.NaN, "whole number"],
    [Number.POSITIVE_INFINITY, "whole number"],
    ["5", "whole number"],
    ["", "whole number"],
    [true, "whole number"],
  ])("rejects %j with a readable message", (clickLimit, wording) => {
    for (const parsed of [
      CreateLinkInput.safeParse({ ...base, clickLimit }),
      UpdateLinkInput.safeParse({ clickLimit }),
    ]) {
      expect(parsed.success).toBe(false);
      if (!parsed.success) {
        const issue = parsed.error.issues.find((i) => i.path[0] === "clickLimit");
        expect(issue?.message).toContain(wording);
        expect(issue?.message).not.toMatch(/Invalid input|Expected|received/);
      }
    }
  });
});

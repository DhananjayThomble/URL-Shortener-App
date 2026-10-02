import { describe, expect, it } from "vitest";
import { RegisterInput } from "@snapurl/contract";
import { ZodValidationPipe } from "../common/zod.pipe.js";

/* Regression for #637 — the register endpoint's zod pipe (the same path the
   controller's @Body(zodBody(RegisterInput)) decorator exercises) must reject
   a whitespace-only name with 400, rather than letting it pass validation on
   the untrimmed value and have the service persist "" after trimming later.
   Oracle: packages/contract RegisterInput is the declared truth for this
   payload; this test drives the real pipe, not a re-implementation of it. */

describe("RegisterInput validation at the controller boundary", () => {
  const pipe = new ZodValidationPipe(RegisterInput);
  const base = { email: "a@example.com", password: "a-long-enough-password" };

  it("rejects a whitespace-only name", () => {
    expect(() => pipe.transform({ ...base, name: "   " })).toThrow();
  });

  it("rejects a single tab character as a name", () => {
    expect(() => pipe.transform({ ...base, name: "\t" })).toThrow();
  });

  it("still rejects an empty name", () => {
    expect(() => pipe.transform({ ...base, name: "" })).toThrow();
  });

  it("accepts and trims a name with surrounding whitespace", () => {
    const result = pipe.transform({ ...base, name: "  Priya Raman  " });
    expect(result.name).toBe("Priya Raman");
  });
});

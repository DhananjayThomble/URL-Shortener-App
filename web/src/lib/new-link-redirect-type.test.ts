import { describe, expect, it } from "vitest";
import { seededRedirectType } from "./new-link-redirect-type";

describe("seededRedirectType (#753)", () => {
  it("seeds every redirect type the workspace can be set to", () => {
    for (const t of ["301", "302", "307"] as const) expect(seededRedirectType(t, false)).toBe(t);
  });

  it("never overwrites a type the user already chose in this drawer", () => {
    expect(seededRedirectType("301", true)).toBeNull();
  });

  it("seeds nothing before the workspace loads, or for a value this build does not know", () => {
    for (const v of [undefined, null, "", "308", "abc", 301, " 301"]) expect(seededRedirectType(v, false)).toBeNull();
  });
});

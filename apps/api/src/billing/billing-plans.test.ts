import { describe, expect, it } from "vitest";
import { parsePlanIds, planLookupKey, resolvePlanId } from "./billing-plans.js";

/* #986 — the (plan key, interval) → provider plan id resolver. Oracle: a KEY
   plus an interval resolves to the configured provider id, an unconfigured one
   resolves to undefined, and a malformed config entry is dropped rather than
   crashing the boot. */

describe("planLookupKey", () => {
  it("joins key and interval with a colon", () => {
    expect(planLookupKey("pro", "monthly")).toBe("pro:monthly");
    expect(planLookupKey("team", "yearly")).toBe("team:yearly");
  });
});

describe("parsePlanIds", () => {
  it("parses a well-formed comma-separated list", () => {
    const map = parsePlanIds("pro:monthly=plan_A,pro:yearly=plan_B,team:monthly=plan_C");
    expect(map.get("pro:monthly")).toBe("plan_A");
    expect(map.get("pro:yearly")).toBe("plan_B");
    expect(map.get("team:monthly")).toBe("plan_C");
    expect(map.size).toBe(3);
  });

  it("returns an empty map for undefined or empty input", () => {
    expect(parsePlanIds(undefined).size).toBe(0);
    expect(parsePlanIds("").size).toBe(0);
    expect(parsePlanIds("   ").size).toBe(0);
  });

  it("tolerates surrounding whitespace and a trailing comma", () => {
    const map = parsePlanIds("  pro:monthly = plan_A ,  team:yearly=plan_B , ");
    expect(map.get("pro:monthly")).toBe("plan_A");
    expect(map.get("team:yearly")).toBe("plan_B");
    expect(map.size).toBe(2);
  });

  it("drops a malformed entry (no '=', empty key, or empty id) rather than throwing", () => {
    const map = parsePlanIds("garbage,=plan_X,pro:monthly=,pro:yearly=plan_OK");
    expect(map.size).toBe(1);
    expect(map.get("pro:yearly")).toBe("plan_OK");
  });

  it("keeps only the first '=' as the separator", () => {
    const map = parsePlanIds("pro:monthly=plan=with=equals");
    expect(map.get("pro:monthly")).toBe("plan=with=equals");
  });
});

describe("resolvePlanId", () => {
  const map = parsePlanIds("pro:monthly=plan_A,pro:yearly=plan_B");

  it("resolves a configured (key, interval) pair", () => {
    expect(resolvePlanId(map, "pro", "monthly")).toBe("plan_A");
    expect(resolvePlanId(map, "pro", "yearly")).toBe("plan_B");
  });

  it("returns undefined for an unconfigured pair", () => {
    expect(resolvePlanId(map, "team", "monthly")).toBeUndefined();
    expect(resolvePlanId(map, "starter", "yearly")).toBeUndefined();
  });
});

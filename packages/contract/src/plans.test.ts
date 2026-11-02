import { describe, expect, it } from "vitest";
import {
  baselineEntitlements,
  CreatePlanInput,
  exceedsLimit,
  FEATURE_LABELS,
  FEATURE_NAMES,
  FeatureMatrix,
  isUnlimited,
  LIMIT_LABELS,
  LIMIT_NAMES,
  LimitMatrix,
  LimitValue,
  MigrateWorkspaceVersionInput,
  OverrideKind,
  PlanVisibility,
  resolveEntitlements,
  UsageWarning,
  SetOverrideInput,
  UpdatePlanInput,
  UpdatePlanMatrixInput,
  usageBand,
  usagePercent,
  USAGE_FULL_PERCENT,
  USAGE_WARN_PERCENT,
  type ResolvableOverride,
  type ResolvableVersion,
} from "./plans.js";

describe("baselineEntitlements", () => {
  it("has every feature off and every limit zero", () => {
    const base = baselineEntitlements();
    for (const f of FEATURE_NAMES) expect(base.features[f]).toBe(false);
    for (const l of LIMIT_NAMES) expect(base.limits[l]).toBe(0);
  });

  it("returns a fresh object each call (no shared mutation)", () => {
    const a = baselineEntitlements();
    a.features.customDomains = true;
    const b = baselineEntitlements();
    expect(b.features.customDomains).toBe(false);
  });

  it("covers exactly the known names, nothing extra", () => {
    expect(Object.keys(baselineEntitlements().features).sort()).toEqual([...FEATURE_NAMES].sort());
    expect(Object.keys(baselineEntitlements().limits).sort()).toEqual([...LIMIT_NAMES].sort());
  });
});

describe("resolveEntitlements", () => {
  const version: ResolvableVersion = {
    features: { customDomains: true, forms: true, webhooks: false },
    limits: { links: 100, customDomains: 5, clicksPerMonth: null },
  };

  it("null version yields the fail-closed baseline", () => {
    const r = resolveEntitlements(null);
    for (const f of FEATURE_NAMES) expect(r.features[f]).toBe(false);
    for (const l of LIMIT_NAMES) expect(r.limits[l]).toBe(0);
  });

  it("applies a version's stated features and leaves omitted ones off", () => {
    const r = resolveEntitlements(version);
    expect(r.features.customDomains).toBe(true);
    expect(r.features.forms).toBe(true);
    expect(r.features.webhooks).toBe(false);
    // omitted in the version -> stays off
    expect(r.features.apiKeys).toBe(false);
  });

  it("applies a version's stated limits, null = unlimited, omitted = 0", () => {
    const r = resolveEntitlements(version);
    expect(r.limits.links).toBe(100);
    expect(r.limits.customDomains).toBe(5);
    expect(r.limits.clicksPerMonth).toBe(null);
    // omitted -> 0
    expect(r.limits.teamMembers).toBe(0);
  });

  it("a feature override beats the plan (grant and remove)", () => {
    const grant: ResolvableOverride[] = [{ kind: "feature", name: "apiKeys", value: true }];
    expect(resolveEntitlements(version, grant).features.apiKeys).toBe(true);

    const remove: ResolvableOverride[] = [{ kind: "feature", name: "customDomains", value: false }];
    expect(resolveEntitlements(version, remove).features.customDomains).toBe(false);
  });

  it("a limit override beats the plan, including raising and unlimited", () => {
    const raise: ResolvableOverride[] = [{ kind: "limit", name: "links", value: 999 }];
    expect(resolveEntitlements(version, raise).limits.links).toBe(999);

    const unlimited: ResolvableOverride[] = [{ kind: "limit", name: "links", value: null }];
    expect(resolveEntitlements(version, unlimited).limits.links).toBe(null);
  });

  it("ignores overrides with a mismatched value type for their kind", () => {
    const bad: ResolvableOverride[] = [
      { kind: "feature", name: "forms", value: 5 }, // feature needs boolean
      { kind: "limit", name: "links", value: true }, // limit needs number|null
    ];
    const r = resolveEntitlements(version, bad);
    expect(r.features.forms).toBe(true); // unchanged by the bad override
    expect(r.limits.links).toBe(100); // unchanged
  });

  it("ignores overrides naming an unknown feature/limit", () => {
    const bad: ResolvableOverride[] = [
      { kind: "feature", name: "teleportation", value: true },
      { kind: "limit", name: "galaxies", value: 3 },
    ];
    const r = resolveEntitlements(version, bad);
    expect(Object.keys(r.features).sort()).toEqual([...FEATURE_NAMES].sort());
    expect(Object.keys(r.limits).sort()).toEqual([...LIMIT_NAMES].sort());
  });

  it("ignores version matrix keys that are not known names or wrong types", () => {
    const weird = {
      features: { customDomains: true, bogus: true } as Record<string, boolean>,
      limits: { links: 10, bogus: 7 } as Record<string, number | null>,
    };
    const r = resolveEntitlements(weird);
    expect(r.features.customDomains).toBe(true);
    expect((r.features as Record<string, unknown>).bogus).toBeUndefined();
    expect(r.limits.links).toBe(10);
    expect((r.limits as Record<string, unknown>).bogus).toBeUndefined();
  });

  it("overrides apply AFTER the version (override on a feature the version set)", () => {
    // version turns customDomains ON; override turns it OFF -> override wins.
    const r = resolveEntitlements(version, [{ kind: "feature", name: "customDomains", value: false }]);
    expect(r.features.customDomains).toBe(false);
  });

  it("defaults the overrides argument to an empty list", () => {
    expect(resolveEntitlements(version).features.customDomains).toBe(true);
  });
});

describe("isUnlimited", () => {
  it("is true only for null", () => {
    expect(isUnlimited(null)).toBe(true);
    expect(isUnlimited(0)).toBe(false);
    expect(isUnlimited(1)).toBe(false);
  });
});

describe("exceedsLimit", () => {
  it("unlimited is never exceeded", () => {
    expect(exceedsLimit(null, 0)).toBe(false);
    expect(exceedsLimit(null, 1_000_000)).toBe(false);
  });

  it("count below the limit has room", () => {
    expect(exceedsLimit(5, 4)).toBe(false);
  });

  it("count equal to the limit has no room for one more", () => {
    expect(exceedsLimit(5, 5)).toBe(true);
  });

  it("count above the limit is exceeded", () => {
    expect(exceedsLimit(5, 6)).toBe(true);
  });

  it("a zero limit is exceeded by any count", () => {
    expect(exceedsLimit(0, 0)).toBe(true);
    expect(exceedsLimit(0, 1)).toBe(true);
  });
});

describe("usagePercent", () => {
  it("unlimited is null", () => {
    expect(usagePercent(10, null)).toBe(null);
  });

  it("zero limit is 100 when used, 0 when unused", () => {
    expect(usagePercent(1, 0)).toBe(100);
    expect(usagePercent(0, 0)).toBe(0);
  });

  it("is the rounded ratio as a percentage", () => {
    expect(usagePercent(50, 100)).toBe(50);
    expect(usagePercent(80, 100)).toBe(80);
    expect(usagePercent(1, 3)).toBe(33);
  });

  it("can exceed 100 when over a lowered limit", () => {
    expect(usagePercent(150, 100)).toBe(150);
  });
});

describe("usageBand", () => {
  it("unlimited never warns", () => {
    expect(usageBand(1_000_000, null)).toBe("none");
  });

  it("below 80% is none", () => {
    expect(usageBand(79, 100)).toBe("none");
  });

  it("exactly at the warn threshold is warn", () => {
    expect(usageBand(USAGE_WARN_PERCENT, 100)).toBe("warn");
  });

  it("between 80 and 99 is warn", () => {
    expect(usageBand(99, 100)).toBe("warn");
  });

  it("exactly at full is full", () => {
    expect(usageBand(USAGE_FULL_PERCENT, 100)).toBe("full");
  });

  it("over full stays full", () => {
    expect(usageBand(200, 100)).toBe("full");
  });
});

describe("the thresholds", () => {
  it("warn is 80 and full is 100", () => {
    expect(USAGE_WARN_PERCENT).toBe(80);
    expect(USAGE_FULL_PERCENT).toBe(100);
  });
});

describe("label maps", () => {
  it("name every feature and every limit", () => {
    for (const f of FEATURE_NAMES) expect(typeof FEATURE_LABELS[f]).toBe("string");
    for (const l of LIMIT_NAMES) expect(typeof LIMIT_LABELS[l]).toBe("string");
  });
});

describe("FeatureMatrix / LimitMatrix schemas", () => {
  it("accept a partial map of known keys", () => {
    expect(FeatureMatrix.safeParse({ customDomains: true }).success).toBe(true);
    expect(LimitMatrix.safeParse({ links: 100, clicksPerMonth: null }).success).toBe(true);
    expect(FeatureMatrix.safeParse({}).success).toBe(true);
  });

  it("reject a non-boolean feature value", () => {
    expect(FeatureMatrix.safeParse({ customDomains: "yes" }).success).toBe(false);
  });

  it("reject a negative or fractional limit", () => {
    expect(LimitMatrix.safeParse({ links: -1 }).success).toBe(false);
    expect(LimitMatrix.safeParse({ links: 1.5 }).success).toBe(false);
  });

  it("LimitValue accepts a non-negative int or null, rejects the rest", () => {
    expect(LimitValue.safeParse(0).success).toBe(true);
    expect(LimitValue.safeParse(null).success).toBe(true);
    expect(LimitValue.safeParse(-1).success).toBe(false);
    expect(LimitValue.safeParse(1.5).success).toBe(false);
  });
});

describe("PlanVisibility / OverrideKind", () => {
  it("accept only their members", () => {
    for (const v of ["public", "hidden", "archived"]) expect(PlanVisibility.safeParse(v).success).toBe(true);
    expect(PlanVisibility.safeParse("deleted").success).toBe(false);
    for (const k of ["feature", "limit"]) expect(OverrideKind.safeParse(k).success).toBe(true);
    expect(OverrideKind.safeParse("both").success).toBe(false);
  });
});

describe("CreatePlanInput", () => {
  it("accepts a minimal plan and defaults the optional fields", () => {
    const parsed = CreatePlanInput.parse({ key: "pro", displayName: "Pro" });
    expect(parsed.description).toBe("");
    expect(parsed.highlightBadge).toBe(null);
    expect(parsed.sortOrder).toBe(0);
    expect(parsed.visibility).toBe("public");
    expect(parsed.features).toEqual({});
    expect(parsed.limits).toEqual({});
  });

  it("trims the key and rejects an empty or bad-charset key", () => {
    expect(CreatePlanInput.safeParse({ key: "", displayName: "X" }).success).toBe(false);
    expect(CreatePlanInput.safeParse({ key: "a b", displayName: "X" }).success).toBe(false);
    expect(CreatePlanInput.parse({ key: "  pro ", displayName: "Pro" }).key).toBe("pro");
  });

  it("rejects a missing display name", () => {
    expect(CreatePlanInput.safeParse({ key: "pro", displayName: "" }).success).toBe(false);
  });
});

describe("UpdatePlanInput", () => {
  it("is all-optional and accepts an empty patch", () => {
    expect(UpdatePlanInput.parse({})).toEqual({});
  });

  it("allows clearing the badge with null", () => {
    expect(UpdatePlanInput.parse({ highlightBadge: null }).highlightBadge).toBe(null);
  });

  it("rejects a bad visibility", () => {
    expect(UpdatePlanInput.safeParse({ visibility: "gone" }).success).toBe(false);
  });
});

describe("UpdatePlanMatrixInput", () => {
  it("requires both matrices", () => {
    expect(UpdatePlanMatrixInput.safeParse({ features: {} }).success).toBe(false);
    expect(UpdatePlanMatrixInput.safeParse({ features: {}, limits: {} }).success).toBe(true);
  });
});

describe("SetOverrideInput", () => {
  it("accepts a feature grant with a boolean value", () => {
    const parsed = SetOverrideInput.parse({ kind: "feature", name: "customDomains", value: true });
    expect(parsed.expiresAt).toBe(null);
  });

  it("accepts a limit override with a number or null", () => {
    expect(SetOverrideInput.safeParse({ kind: "limit", name: "links", value: 500 }).success).toBe(true);
    expect(SetOverrideInput.safeParse({ kind: "limit", name: "links", value: null }).success).toBe(true);
  });

  it("rejects a feature override whose value is not boolean", () => {
    expect(SetOverrideInput.safeParse({ kind: "feature", name: "customDomains", value: 5 }).success).toBe(false);
  });

  it("rejects a limit override whose value is boolean", () => {
    expect(SetOverrideInput.safeParse({ kind: "limit", name: "links", value: true }).success).toBe(false);
  });

  it("rejects an unknown feature or limit name", () => {
    expect(SetOverrideInput.safeParse({ kind: "feature", name: "nope", value: true }).success).toBe(false);
    expect(SetOverrideInput.safeParse({ kind: "limit", name: "nope", value: 1 }).success).toBe(false);
  });

  it("accepts an ISO expiry and rejects a non-datetime", () => {
    expect(
      SetOverrideInput.safeParse({
        kind: "feature",
        name: "forms",
        value: true,
        expiresAt: "2026-12-31T00:00:00.000Z",
      }).success,
    ).toBe(true);
    expect(SetOverrideInput.safeParse({ kind: "feature", name: "forms", value: true, expiresAt: "soon" }).success).toBe(
      false,
    );
  });
});

describe("UsageWarning", () => {
  it("accepts a warn/full band on a known limit", () => {
    expect(UsageWarning.safeParse({ limitName: "links", label: "links", band: "warn" }).success).toBe(true);
    expect(UsageWarning.safeParse({ limitName: "forms", label: "forms", band: "full" }).success).toBe(true);
  });

  it("rejects a none band or an unknown limit", () => {
    expect(UsageWarning.safeParse({ limitName: "links", label: "links", band: "none" }).success).toBe(false);
    expect(UsageWarning.safeParse({ limitName: "galaxies", label: "x", band: "warn" }).success).toBe(false);
  });
});

describe("MigrateWorkspaceVersionInput", () => {
  it("accepts a positive version or null (unpin)", () => {
    expect(MigrateWorkspaceVersionInput.safeParse({ version: 2 }).success).toBe(true);
    expect(MigrateWorkspaceVersionInput.safeParse({ version: null }).success).toBe(true);
  });

  it("rejects a zero or negative version", () => {
    expect(MigrateWorkspaceVersionInput.safeParse({ version: 0 }).success).toBe(false);
    expect(MigrateWorkspaceVersionInput.safeParse({ version: -1 }).success).toBe(false);
  });
});

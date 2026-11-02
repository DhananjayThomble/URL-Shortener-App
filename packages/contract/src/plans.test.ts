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
  OverrideView,
  PlanList,
  PlanView,
  PlanVisibility,
  PricingPlan,
  PricingTable,
  resolveEntitlements,
  UsageRow,
  UsageWarning,
  SetOverrideInput,
  UpdatePlanInput,
  UpdatePlanMatrixInput,
  WorkspaceUsage,
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

  it("ignores a version feature value that is not a real boolean", () => {
    // A known feature name whose value is truthy but NOT a boolean must be
    // ignored (the typeof === "boolean" guard), leaving the baseline (off).
    const weird = {
      features: { customDomains: 1 as unknown as boolean, forms: true },
      limits: {},
    };
    const r = resolveEntitlements(weird);
    expect(r.features.customDomains).toBe(false); // ignored (not a boolean)
    expect(r.features.forms).toBe(true); // a real boolean applies
  });

  it("ignores a version limit value that is neither a number nor null", () => {
    const weird = {
      features: {},
      limits: { links: "10" as unknown as number, forms: 5 },
    };
    const r = resolveEntitlements(weird);
    expect(r.limits.links).toBe(0); // ignored (string, not number/null) -> baseline
    expect(r.limits.forms).toBe(5); // a real number applies
  });

  it("ignores an override feature value that is not a boolean, and a limit value that is a boolean", () => {
    const base: ResolvableVersion = { features: { forms: true }, limits: { links: 5 } };
    const r = resolveEntitlements(base, [
      { kind: "feature", name: "forms", value: 0 as unknown as boolean }, // not boolean -> ignored
      { kind: "limit", name: "links", value: true as unknown as number }, // boolean -> ignored
    ]);
    expect(r.features.forms).toBe(true); // override ignored, version value stands
    expect(r.limits.links).toBe(5); // override ignored, version value stands
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


/* ── wire-schema constraints (mutation coverage for the input/output shapes) ── */

describe("CreatePlanInput constraints", () => {
  it("rejects a display name over 80 chars and a description over 280", () => {
    expect(CreatePlanInput.safeParse({ key: "k", displayName: "x".repeat(81) }).success).toBe(false);
    expect(CreatePlanInput.safeParse({ key: "k", displayName: "X", description: "d".repeat(281) }).success).toBe(false);
    expect(CreatePlanInput.safeParse({ key: "k", displayName: "X", description: "d".repeat(280) }).success).toBe(true);
  });

  it("rejects a key over 40 chars", () => {
    expect(CreatePlanInput.safeParse({ key: "a".repeat(41), displayName: "X" }).success).toBe(false);
    expect(CreatePlanInput.safeParse({ key: "a".repeat(40), displayName: "X" }).success).toBe(true);
  });

  it("rejects a highlight badge over 40 chars but accepts null", () => {
    expect(CreatePlanInput.safeParse({ key: "k", displayName: "X", highlightBadge: "b".repeat(41) }).success).toBe(false);
    expect(CreatePlanInput.parse({ key: "k", displayName: "X", highlightBadge: null }).highlightBadge).toBe(null);
  });

  it("bounds sortOrder to 0..10000", () => {
    expect(CreatePlanInput.safeParse({ key: "k", displayName: "X", sortOrder: -1 }).success).toBe(false);
    expect(CreatePlanInput.safeParse({ key: "k", displayName: "X", sortOrder: 10_001 }).success).toBe(false);
    expect(CreatePlanInput.safeParse({ key: "k", displayName: "X", sortOrder: 10_000 }).success).toBe(true);
  });

  it("rejects a fractional sortOrder (int only)", () => {
    expect(CreatePlanInput.safeParse({ key: "k", displayName: "X", sortOrder: 1.5 }).success).toBe(false);
  });

  it("rejects a bad visibility value", () => {
    expect(CreatePlanInput.safeParse({ key: "k", displayName: "X", visibility: "secret" }).success).toBe(false);
  });
});

describe("UpdatePlanInput constraints", () => {
  it("rejects an empty display name and one over 80", () => {
    expect(UpdatePlanInput.safeParse({ displayName: "" }).success).toBe(false);
    expect(UpdatePlanInput.safeParse({ displayName: "x".repeat(81) }).success).toBe(false);
    expect(UpdatePlanInput.safeParse({ displayName: "ok" }).success).toBe(true);
  });

  it("rejects a description over 280", () => {
    expect(UpdatePlanInput.safeParse({ description: "d".repeat(281) }).success).toBe(false);
    expect(UpdatePlanInput.safeParse({ description: "d".repeat(280) }).success).toBe(true);
  });

  it("bounds sortOrder to 0..10000 and rejects fractional", () => {
    expect(UpdatePlanInput.safeParse({ sortOrder: -1 }).success).toBe(false);
    expect(UpdatePlanInput.safeParse({ sortOrder: 10_001 }).success).toBe(false);
    expect(UpdatePlanInput.safeParse({ sortOrder: 2.5 }).success).toBe(false);
    expect(UpdatePlanInput.safeParse({ sortOrder: 5 }).success).toBe(true);
  });

  it("trims the display name", () => {
    expect(UpdatePlanInput.parse({ displayName: "  Pro  " }).displayName).toBe("Pro");
  });

  it("rejects a highlight badge over 40 but accepts null", () => {
    expect(UpdatePlanInput.safeParse({ highlightBadge: "b".repeat(41) }).success).toBe(false);
    expect(UpdatePlanInput.parse({ highlightBadge: null }).highlightBadge).toBe(null);
  });
});

describe("SetOverrideInput constraints", () => {
  it("rejects a name over 40 chars and an empty name", () => {
    expect(SetOverrideInput.safeParse({ kind: "feature", name: "", value: true }).success).toBe(false);
    // A 41-char name is rejected before the superRefine's unknown-name check.
    expect(SetOverrideInput.safeParse({ kind: "feature", name: "a".repeat(41), value: true }).success).toBe(false);
  });

  it("rejects a negative limit value and a fractional one", () => {
    expect(SetOverrideInput.safeParse({ kind: "limit", name: "links", value: -1 }).success).toBe(false);
    expect(SetOverrideInput.safeParse({ kind: "limit", name: "links", value: 1.5 }).success).toBe(false);
    expect(SetOverrideInput.safeParse({ kind: "limit", name: "links", value: 0 }).success).toBe(true);
  });

  it("trims the name", () => {
    const parsed = SetOverrideInput.parse({ kind: "feature", name: "  customDomains  ", value: true });
    expect(parsed.name).toBe("customDomains");
  });

  it("defaults expiresAt to null and accepts an ISO datetime", () => {
    expect(SetOverrideInput.parse({ kind: "limit", name: "links", value: 5 }).expiresAt).toBe(null);
  });
});

describe("MigrateWorkspaceVersionInput constraints", () => {
  it("rejects a fractional version", () => {
    expect(MigrateWorkspaceVersionInput.safeParse({ version: 1.5 }).success).toBe(false);
  });
});

describe("OverrideView", () => {
  it("parses a full feature override view and a limit one", () => {
    expect(
      OverrideView.safeParse({ id: "o1", kind: "feature", name: "forms", value: true, expiresAt: null, createdBy: "a@b.c", createdAt: "2026-01-01T00:00:00.000Z" }).success,
    ).toBe(true);
    expect(
      OverrideView.safeParse({ id: "o2", kind: "limit", name: "links", value: 5, expiresAt: "2026-02-01T00:00:00.000Z", createdBy: null, createdAt: "2026-01-01T00:00:00.000Z" }).success,
    ).toBe(true);
  });

  it("accepts a null value (unlimited limit override) and rejects a missing field", () => {
    expect(OverrideView.safeParse({ id: "o", kind: "limit", name: "links", value: null, expiresAt: null, createdBy: null, createdAt: "x" }).success).toBe(true);
    expect(OverrideView.safeParse({ id: "o", kind: "limit", name: "links", value: 1, expiresAt: null, createdBy: null }).success).toBe(false);
  });

  it("rejects a bad kind", () => {
    expect(OverrideView.safeParse({ id: "o", kind: "both", name: "x", value: 1, expiresAt: null, createdBy: null, createdAt: "x" }).success).toBe(false);
  });
});

describe("PlanView / PlanList", () => {
  const view = {
    id: "p1",
    key: "pro",
    displayName: "Pro",
    description: "",
    highlightBadge: null,
    sortOrder: 2,
    visibility: "public" as const,
    version: 3,
    features: Object.fromEntries(FEATURE_NAMES.map((f) => [f, true])),
    limits: Object.fromEntries(LIMIT_NAMES.map((l) => [l, 10])),
  };

  it("parses a complete plan view", () => {
    expect(PlanView.safeParse(view).success).toBe(true);
  });

  it("rejects a non-int version and a bad visibility", () => {
    expect(PlanView.safeParse({ ...view, version: 1.5 }).success).toBe(false);
    expect(PlanView.safeParse({ ...view, visibility: "gone" }).success).toBe(false);
  });

  it("PlanList wraps an array of views", () => {
    expect(PlanList.safeParse({ items: [view] }).success).toBe(true);
    expect(PlanList.safeParse({ items: "nope" }).success).toBe(false);
  });
});

describe("PricingPlan / PricingTable", () => {
  const plan = {
    key: "pro",
    displayName: "Pro",
    description: "d",
    highlightBadge: "Most popular",
    features: Object.fromEntries(FEATURE_NAMES.map((f) => [f, false])),
    limits: Object.fromEntries(LIMIT_NAMES.map((l) => [l, null])),
  };

  it("parses a pricing plan with a null badge too", () => {
    expect(PricingPlan.safeParse(plan).success).toBe(true);
    expect(PricingPlan.safeParse({ ...plan, highlightBadge: null }).success).toBe(true);
  });

  it("rejects a missing field", () => {
    const { description, ...rest } = plan;
    void description;
    expect(PricingPlan.safeParse(rest).success).toBe(false);
  });

  it("PricingTable carries the plans and the feature/limit order", () => {
    const table = { plans: [plan], featureOrder: [...FEATURE_NAMES], limitOrder: [...LIMIT_NAMES] };
    expect(PricingTable.safeParse(table).success).toBe(true);
    expect(PricingTable.safeParse({ ...table, featureOrder: ["bogus"] }).success).toBe(false);
  });
});

describe("UsageRow / WorkspaceUsage", () => {
  const row = { name: "links" as const, label: "links", used: 3, limit: 10, percent: 30 };

  it("parses a usage row, incl. unlimited (null limit, null percent)", () => {
    expect(UsageRow.safeParse(row).success).toBe(true);
    expect(UsageRow.safeParse({ ...row, limit: null, percent: null }).success).toBe(true);
  });

  it("rejects a negative used, a negative percent and a bad limit name", () => {
    expect(UsageRow.safeParse({ ...row, used: -1 }).success).toBe(false);
    expect(UsageRow.safeParse({ ...row, percent: -1 }).success).toBe(false);
    expect(UsageRow.safeParse({ ...row, name: "galaxies" }).success).toBe(false);
  });

  it("WorkspaceUsage carries planKey, rows and warnings", () => {
    const usage = {
      planKey: "pro",
      rows: [row],
      warnings: [{ limitName: "links" as const, label: "links", band: "warn" as const }],
    };
    expect(WorkspaceUsage.safeParse(usage).success).toBe(true);
    expect(WorkspaceUsage.safeParse({ ...usage, warnings: "nope" }).success).toBe(false);
  });
});

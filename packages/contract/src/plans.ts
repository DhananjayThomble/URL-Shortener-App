import { z } from "zod";

/* ============================================================
   #970 — the plans / entitlements engine contract (admin panel 3/7).

   The wire + logic shapes for admin-editable plans. #966 put a static plan
   table here; this generalises it to a feature MATRIX and a LIMIT set per plan,
   a per-workspace OVERRIDE, and a pure RESOLVER that folds them into the
   effective entitlements a workspace has right now. The DB (packages/database
   schema/plans.ts) stores these; the API's PlansService reads them through a
   short cache and hands a ResolvedEntitlements to the single enforcement check.

   Everything here is pure data + pure functions so it can be unit-tested to the
   mutation threshold and reused by the web (/pricing, Settings usage) without a
   server round-trip.
   ============================================================ */

/* ── Feature names ──────────────────────────────────────────

   Every gated feature is a named entitlement. The admin turns each on or off
   per plan in the matrix. Adding a name here makes it a new column in the grid;
   a plan version that does not mention it is treated as "off" (fail closed). */
export const FEATURE_NAMES = [
  "customDomains",
  "passwordProtectedLinks",
  "linkExpiry",
  "routingRules",
  "conversions",
  "bioPages",
  "forms",
  "apiKeys",
  "webhooks",
  "csvExport",
  "cookielessAnalytics",
  "qrCustomisation",
] as const;
export type FeatureName = (typeof FEATURE_NAMES)[number];

/* ── Limit names ────────────────────────────────────────────

   Each limit is a count; `null` means unlimited. A limit absent from a version's
   map resolves to 0 (nothing allowed) so a forgotten limit fails closed. */
export const LIMIT_NAMES = [
  "links",
  "clicksPerMonth",
  "customDomains",
  "teamMembers",
  "apiKeys",
  "bioPages",
  "forms",
  "retentionYears",
] as const;
export type LimitName = (typeof LIMIT_NAMES)[number];

/** Human labels for the named feature/limit, used in 403 messages and on
 *  /pricing so the UI and the API agree on wording. */
export const FEATURE_LABELS: Record<FeatureName, string> = {
  customDomains: "custom domains",
  passwordProtectedLinks: "password-protected links",
  linkExpiry: "link expiry",
  routingRules: "routing rules",
  conversions: "conversion tracking",
  bioPages: "bio pages",
  forms: "forms",
  apiKeys: "API keys",
  webhooks: "webhooks",
  csvExport: "CSV export",
  cookielessAnalytics: "cookieless analytics",
  qrCustomisation: "QR customisation",
};

export const LIMIT_LABELS: Record<LimitName, string> = {
  links: "links",
  clicksPerMonth: "clicks tracked per month",
  customDomains: "custom domains",
  teamMembers: "team members",
  apiKeys: "API keys",
  bioPages: "bio pages",
  forms: "forms",
  retentionYears: "years of data retention",
};

/* ── Matrices ───────────────────────────────────────────────

   A FeatureMatrix is a partial map of feature -> boolean; a LimitMatrix a
   partial map of limit -> (number | null). Partial because a version only needs
   to state what differs from the fail-closed default (feature off, limit 0), and
   because a version written by an older/newer deploy must still parse. Unknown
   keys are stripped so a hand-edited row can never inject a bogus entitlement. */
export const FeatureMatrix = z.partialRecord(z.enum(FEATURE_NAMES), z.boolean());
export type FeatureMatrix = Partial<Record<FeatureName, boolean>>;

/** A limit value: a non-negative integer cap, or null for unlimited. */
export const LimitValue = z.number().int().min(0).nullable();
export type LimitValue = number | null;

export const LimitMatrix = z.partialRecord(z.enum(LIMIT_NAMES), LimitValue);
export type LimitMatrix = Partial<Record<LimitName, LimitValue>>;

/* ── Prices (#987) ──────────────────────────────────────────

   A plan VERSION carries its prices, so editing a price makes a new version and
   existing subscribers keep theirs (grandfathering, same rule as the feature
   matrix). Money is stored in the currency's MINOR unit as an integer (paise for
   INR, cents for USD) — never a float — so a price is exact and no rounding
   creeps in. A version holds a price per (interval, currency); INR ships first,
   an admin may add USD. The "primary" currency is the one /pricing and checkout
   default to when the caller does not ask for a specific one. */

/** The currencies a price may be quoted in. INR first; USD is admin-addable.
 *  A fixed enum (not a free string) so a hand-edited row cannot inject a bogus
 *  currency and the UI/formatter always knows the minor-unit scale. */
export const PRICE_CURRENCIES = ["INR", "USD"] as const;
export const PriceCurrency = z.enum(PRICE_CURRENCIES);
export type PriceCurrency = (typeof PRICE_CURRENCIES)[number];

/** Billing intervals a price is quoted for. Mirrors #986's BILLING_INTERVALS;
 *  duplicated here (not imported) so the plans contract has no dependency on the
 *  billing contract and the mutation suite can test it standalone. */
export const PRICE_INTERVALS = ["monthly", "yearly"] as const;
export const PriceInterval = z.enum(PRICE_INTERVALS);
export type PriceInterval = (typeof PRICE_INTERVALS)[number];

/** How many minor units make one major unit, per currency. Both of ours are
 *  2-decimal currencies (100 paise = ₹1, 100 cents = $1); kept as a table so
 *  adding a 0- or 3-decimal currency later is a one-line change here. */
export const CURRENCY_MINOR_UNITS: Record<PriceCurrency, number> = {
  INR: 100,
  USD: 100,
};

/** A single amount: a non-negative integer in the currency's MINOR unit. Capped
 *  at a sane ceiling so a typo cannot store an absurd amount; 0 is allowed (a
 *  free interval). */
export const PriceAmountMinor = z.number().int().min(0).max(100_000_000);
export type PriceAmountMinor = z.infer<typeof PriceAmountMinor>;

/** The prices for ONE interval: an amount per currency. At least the version's
 *  primary currency is expected to be present; a currency absent here is simply
 *  not offered in that currency. */
export const IntervalPrices = z.partialRecord(PriceCurrency, PriceAmountMinor);
export type IntervalPrices = Partial<Record<PriceCurrency, PriceAmountMinor>>;

/**
 * A plan version's full price set. `primaryCurrency` is what /pricing and
 * checkout default to; `amounts` holds the minor-unit amount per interval per
 * currency. Partial per interval/currency so a version may price only what it
 * offers — an unpriced (interval, currency) resolves to "not available" rather
 * than a guessed amount. A version with no prices at all is a free/unpriced
 * plan (e.g. the `free` tier), which is valid.
 */
export const PlanPrices = z.object({
  primaryCurrency: PriceCurrency.default("INR"),
  amounts: z.partialRecord(PriceInterval, IntervalPrices).default({}),
});
export type PlanPrices = z.infer<typeof PlanPrices>;

/** An empty (unpriced) price set — the free-plan / no-price default the resolver
 *  and views start from, so a caller never handles an absent price object. */
export function emptyPlanPrices(): PlanPrices {
  return { primaryCurrency: "INR", amounts: {} };
}

/**
 * The minor-unit amount for a (interval, currency) on a price set, or null when
 * that pair is not priced. `currency` defaults to the set's primary. Pure so
 * /pricing, checkout and the admin view all read a price the same way.
 */
export function priceFor(
  prices: PlanPrices | null | undefined,
  interval: PriceInterval,
  currency?: PriceCurrency,
): number | null {
  if (!prices) return null;
  const cur = currency ?? prices.primaryCurrency;
  const forInterval = prices.amounts[interval];
  const amount = forInterval?.[cur];
  return typeof amount === "number" ? amount : null;
}

/** Format a minor-unit amount as a display string in its currency, e.g.
 *  (5900, "INR") → "₹59". Whole amounts drop the decimals; a fractional amount
 *  shows two. Symbol-first for both our currencies. Used by the UI and kept in
 *  the contract so the server and web format a price identically. */
export function formatPrice(amountMinor: number, currency: PriceCurrency): string {
  const minor = CURRENCY_MINOR_UNITS[currency];
  const major = amountMinor / minor;
  const symbol = currency === "INR" ? "₹" : "$";
  const hasFraction = amountMinor % minor !== 0;
  const body = hasFraction
    ? major.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : major.toLocaleString("en-IN");
  return `${symbol}${body}`;
}

/* ── Visibility, override kinds ─────────────────────────────── */

/** public — on /pricing, open sign-up. hidden — admin-assignable only (custom
 *  deals). archived — closed to new sign-ups, existing workspaces keep it. */
export const PLAN_VISIBILITIES = ["public", "hidden", "archived"] as const;
export const PlanVisibility = z.enum(PLAN_VISIBILITIES);
export type PlanVisibility = (typeof PLAN_VISIBILITIES)[number];

export const OVERRIDE_KINDS = ["feature", "limit"] as const;
export const OverrideKind = z.enum(OVERRIDE_KINDS);
export type OverrideKind = (typeof OVERRIDE_KINDS)[number];

/* ── Resolved entitlements ──────────────────────────────────

   What the enforcement check reads: the complete, defaulted feature + limit
   maps for a workspace right now, after version and overrides are folded in.
   Every feature name is present (defaulted off) and every limit name is present
   (defaulted 0) so a caller never has to handle "absent". */
export type ResolvedEntitlements = {
  features: Record<FeatureName, boolean>;
  limits: Record<LimitName, LimitValue>;
};

/** A plan version as the resolver needs it: its feature + limit matrices. */
export interface ResolvableVersion {
  features: FeatureMatrix;
  limits: LimitMatrix;
}

/** A single non-expired override to fold in. */
export interface ResolvableOverride {
  kind: OverrideKind;
  name: string;
  value: boolean | number | null;
}

/** The fail-closed baseline: every feature off, every limit 0. The resolver
 *  starts here so a version that omits a name never grants it. */
export function baselineEntitlements(): ResolvedEntitlements {
  const features = Object.fromEntries(FEATURE_NAMES.map((f) => [f, false])) as Record<FeatureName, boolean>;
  const limits = Object.fromEntries(LIMIT_NAMES.map((l) => [l, 0])) as Record<LimitName, LimitValue>;
  return { features, limits };
}

function isFeatureName(name: string): name is FeatureName {
  return (FEATURE_NAMES as readonly string[]).includes(name);
}
function isLimitName(name: string): name is LimitName {
  return (LIMIT_NAMES as readonly string[]).includes(name);
}

/**
 * Fold a plan version and a workspace's non-expired overrides into the effective
 * entitlements. Pure: callers pass already-expiry-filtered overrides (the
 * service drops expired rows before calling, so the clock lives in one place).
 *
 * Order:
 *   1. start from the fail-closed baseline (everything off / 0).
 *   2. apply the version's matrices (a stated feature/limit replaces the
 *      baseline; an omitted one keeps the baseline).
 *   3. apply overrides last, so an override always beats the plan — a feature
 *      grant/removal flips the boolean, a limit override sets the cap (including
 *      to null = unlimited, or raising a number).
 *
 * A `null` version (unknown plan with no resolvable version) yields the baseline
 * plus overrides — fail closed, never a paid default.
 */
export function resolveEntitlements(
  version: ResolvableVersion | null,
  overrides: ResolvableOverride[] = [],
): ResolvedEntitlements {
  const resolved = baselineEntitlements();

  if (version) {
    for (const [name, on] of Object.entries(version.features)) {
      if (isFeatureName(name) && typeof on === "boolean") resolved.features[name] = on;
    }
    for (const [name, cap] of Object.entries(version.limits)) {
      if (isLimitName(name) && (cap === null || typeof cap === "number")) resolved.limits[name] = cap;
    }
  }

  for (const ov of overrides) {
    if (ov.kind === "feature" && isFeatureName(ov.name) && typeof ov.value === "boolean") {
      resolved.features[ov.name] = ov.value;
    } else if (ov.kind === "limit" && isLimitName(ov.name) && (ov.value === null || typeof ov.value === "number")) {
      resolved.limits[ov.name] = ov.value;
    }
  }

  return resolved;
}

/** Is a limit value unlimited (null)? A named predicate so call sites read as
 *  the question they ask rather than an inline `=== null`. */
export function isUnlimited(limit: LimitValue): boolean {
  return limit === null;
}

/**
 * Would `count` exceed `limit`? Unlimited (null) is never exceeded. A count
 * EQUAL to the limit is at the cap, not over it — callers check this BEFORE
 * creating the next item, so `count` is the current number and `count >= limit`
 * means "no room for one more".
 */
export function exceedsLimit(limit: LimitValue, count: number): boolean {
  if (limit === null) return false;
  return count >= limit;
}

/* ── Admin + public wire shapes ─────────────────────────────── */

/** A plan as the admin grid and the public pricing read it. `features`/`limits`
 *  are the plan's CURRENT version's matrices, fully defaulted. */
export const PlanView = z.object({
  id: z.string(),
  key: z.string(),
  displayName: z.string(),
  description: z.string(),
  highlightBadge: z.string().nullable(),
  sortOrder: z.number().int(),
  visibility: PlanVisibility,
  version: z.number().int(),
  features: z.record(z.enum(FEATURE_NAMES), z.boolean()),
  limits: z.record(z.enum(LIMIT_NAMES), LimitValue),
  /** The current version's prices (#987). Empty amounts for an unpriced plan. */
  prices: PlanPrices,
});
export type PlanView = z.infer<typeof PlanView>;

export const PlanList = z.object({ items: z.array(PlanView) });
export type PlanList = z.infer<typeof PlanList>;

/** Create a plan. The first version's matrices come with it so a plan is never
 *  versionless. Key is trimmed + lower-cased by the service. */
export const CreatePlanInput = z.object({
  key: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .regex(/^[a-z0-9][a-z0-9-]*$/i, "A plan key is letters, digits and hyphens."),
  displayName: z.string().trim().min(1).max(80),
  description: z.string().max(280).default(""),
  highlightBadge: z.string().trim().max(40).nullable().default(null),
  sortOrder: z.number().int().min(0).max(10_000).default(0),
  visibility: PlanVisibility.default("public"),
  features: FeatureMatrix.default({}),
  limits: LimitMatrix.default({}),
});
export type CreatePlanInput = z.infer<typeof CreatePlanInput>;

/** Edit a plan's metadata (not its matrices — that is UpdatePlanMatrixInput,
 *  which versions). Every field optional; an omitted field is unchanged. */
export const UpdatePlanInput = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  description: z.string().max(280).optional(),
  highlightBadge: z.string().trim().max(40).nullable().optional(),
  sortOrder: z.number().int().min(0).max(10_000).optional(),
  visibility: PlanVisibility.optional(),
});
export type UpdatePlanInput = z.infer<typeof UpdatePlanInput>;

/** Edit a live plan's feature matrix and/or limits. Applying this creates a NEW
 *  version and moves the plan's current version forward; existing workspaces
 *  stay on their old version until migrated. Both maps are the FULL intended
 *  matrices for the new version (not a patch). */
export const UpdatePlanMatrixInput = z.object({
  features: FeatureMatrix,
  limits: LimitMatrix,
});
export type UpdatePlanMatrixInput = z.infer<typeof UpdatePlanMatrixInput>;

/** Edit a live plan's PRICES (#987). Applying this creates a NEW version (same
 *  feature matrix + limits as the outgoing version, new prices) and moves the
 *  plan's current version forward, so a price change applies to NEW subscriptions
 *  only and existing subscribers keep the version they are on — grandfathering,
 *  exactly like a matrix edit. `prices` is the FULL intended price set for the
 *  new version, not a patch. */
export const UpdatePlanPricesInput = z.object({
  prices: PlanPrices,
});
export type UpdatePlanPricesInput = z.infer<typeof UpdatePlanPricesInput>;

/** Set (or clear) a per-workspace override. `value` is a boolean for a feature,
 *  a number or null for a limit; the service validates value-by-kind. A null
 *  `expiresAt` means no expiry. */
export const SetOverrideInput = z
  .object({
    kind: OverrideKind,
    name: z.string().trim().min(1).max(40),
    value: z.union([z.boolean(), z.number().int().min(0), z.null()]),
    expiresAt: z.string().datetime().nullable().default(null),
  })
  .superRefine((v, ctx) => {
    if (v.kind === "feature" && typeof v.value !== "boolean") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A feature override's value must be true or false." });
    }
    if (v.kind === "limit" && typeof v.value === "boolean") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A limit override's value must be a number or null." });
    }
    if (v.kind === "feature" && !(FEATURE_NAMES as readonly string[]).includes(v.name)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Unknown feature "${v.name}".` });
    }
    if (v.kind === "limit" && !(LIMIT_NAMES as readonly string[]).includes(v.name)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Unknown limit "${v.name}".` });
    }
  });
export type SetOverrideInput = z.infer<typeof SetOverrideInput>;

/** An override as the admin reads it back. */
export const OverrideView = z.object({
  id: z.string(),
  kind: OverrideKind,
  name: z.string(),
  value: z.union([z.boolean(), z.number(), z.null()]),
  expiresAt: z.string().nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
});
export type OverrideView = z.infer<typeof OverrideView>;

/** Pin (or unpin) a workspace to a specific plan version — the grandfather
 *  migration control. A null `version` unpins (follow the plan's current). */
export const MigrateWorkspaceVersionInput = z.object({
  version: z.number().int().min(1).nullable(),
});
export type MigrateWorkspaceVersionInput = z.infer<typeof MigrateWorkspaceVersionInput>;

/* ── Public pricing + usage ─────────────────────────────────── */

/** One plan on the public /pricing comparison table. Carries the LIVE prices
 *  (#987) so /pricing shows an admin's price change with no redeploy. */
export const PricingPlan = z.object({
  key: z.string(),
  displayName: z.string(),
  description: z.string(),
  highlightBadge: z.string().nullable(),
  features: z.record(z.enum(FEATURE_NAMES), z.boolean()),
  limits: z.record(z.enum(LIMIT_NAMES), LimitValue),
  /** The plan's current prices (#987). Empty amounts for an unpriced plan. */
  prices: PlanPrices,
});
export type PricingPlan = z.infer<typeof PricingPlan>;

export const PricingTable = z.object({
  plans: z.array(PricingPlan),
  featureOrder: z.array(z.enum(FEATURE_NAMES)),
  limitOrder: z.array(z.enum(LIMIT_NAMES)),
});
export type PricingTable = z.infer<typeof PricingTable>;

/** One row of a workspace's usage-against-limits view in Settings. `limit` null
 *  = unlimited; `percent` is null when unlimited (no ratio to show). */
export const UsageRow = z.object({
  name: z.enum(LIMIT_NAMES),
  label: z.string(),
  used: z.number().int().min(0),
  limit: LimitValue,
  percent: z.number().min(0).nullable(),
});
export type UsageRow = z.infer<typeof UsageRow>;

/** An active owner warning on a limit at or above 80%, for the in-app banner. */
export const UsageWarning = z.object({
  limitName: z.enum(LIMIT_NAMES),
  label: z.string(),
  band: z.enum(["warn", "full"]),
});
export type UsageWarning = z.infer<typeof UsageWarning>;

export const WorkspaceUsage = z.object({
  planKey: z.string(),
  rows: z.array(UsageRow),
  /** Limits the workspace is at or above 80% on, newest-crossed first. The
   *  Settings page shows these as a banner; empty when nothing is near a limit. */
  warnings: z.array(UsageWarning),
});
export type WorkspaceUsage = z.infer<typeof WorkspaceUsage>;

/**
 * The usage percent for a used/limit pair: null when unlimited, else used/limit
 * as a percentage (can exceed 100 when a workspace is over a limit that was
 * lowered under it). Rounded to a whole number for display.
 */
export function usagePercent(used: number, limit: LimitValue): number | null {
  if (limit === null) return null;
  if (limit === 0) return used > 0 ? 100 : 0;
  return Math.round((used / limit) * 100);
}

/** The warning band a usage ratio falls in: none (<80%), warn (80–99%), or
 *  full (>=100%). Owners are warned at the warn and full thresholds. Unlimited
 *  never warns. */
export const USAGE_WARN_PERCENT = 80;
export const USAGE_FULL_PERCENT = 100;
export type UsageBand = "none" | "warn" | "full";

export function usageBand(used: number, limit: LimitValue): UsageBand {
  const pct = usagePercent(used, limit);
  if (pct === null) return "none";
  if (pct >= USAGE_FULL_PERCENT) return "full";
  if (pct >= USAGE_WARN_PERCENT) return "warn";
  return "none";
}

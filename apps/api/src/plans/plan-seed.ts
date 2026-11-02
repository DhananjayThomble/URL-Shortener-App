import type { FeatureMatrix, LimitMatrix, PlanPrices, PlanVisibility } from "@snapurl/contract";

/* ============================================================
   #970 — the seed plan catalogue.

   The plans a fresh deploy starts with. PlansService seeds these once, when the
   plans table is empty, so a new database (and the stack test DB) has a working
   catalogue without a separate script, and an existing database an admin has
   already edited is NEVER overwritten (the seed is skipped when any plan row
   exists).

   Keys align with #986's PLAN_KEYS (free/starter/pro/team) plus `enterprise`,
   which #966's stack principals already use. `free` reproduces today's
   behaviour: no custom domains, the limits the product shipped with.

   These are sensible starting splits the admin is expected to change from the
   panel — they are defaults, not policy. Each plan's first version is built
   from its `features`/`limits` here; editing from the admin panel creates new
   versions and never touches this file.
   ============================================================ */

export interface SeedPlan {
  key: string;
  displayName: string;
  description: string;
  highlightBadge: string | null;
  sortOrder: number;
  visibility: PlanVisibility;
  features: FeatureMatrix;
  limits: LimitMatrix;
  /** #987 — the plan's starting prices (minor units, INR). Omitted for an
   *  unpriced plan (free, enterprise). An admin edits these from the panel,
   *  which creates a new version and never touches this file. */
  prices?: PlanPrices;
}

/* #987 — the operator's default prices (2026-11-02), in paise (₹1 = 100 paise).
   Yearly is 10× monthly (two months free). All editable from the admin panel.

     Starter  ₹59/mo   ₹590/yr
     Pro      ₹199/mo  ₹1,990/yr
     Team     ₹299/mo  ₹2,990/yr                                              */
const inrPrices = (monthlyRupees: number, yearlyRupees: number): PlanPrices => ({
  primaryCurrency: "INR",
  amounts: {
    monthly: { INR: monthlyRupees * 100 },
    yearly: { INR: yearlyRupees * 100 },
  },
});

export const SEED_PLANS: SeedPlan[] = [
  {
    key: "free",
    displayName: "Free",
    description: "Everything you need to start shortening links on the shared snapurl.in domain.",
    highlightBadge: null,
    sortOrder: 0,
    visibility: "public",
    // Today's behaviour: the shared domain only, the limits the product shipped
    // with. No custom domains — the one feature #966 already gated.
    features: {
      customDomains: false,
      passwordProtectedLinks: false,
      linkExpiry: true,
      routingRules: false,
      conversions: false,
      bioPages: true,
      forms: false,
      apiKeys: true,
      webhooks: false,
      csvExport: false,
      cookielessAnalytics: true,
      qrCustomisation: false,
    },
    limits: {
      links: 50,
      clicksPerMonth: 1_000_000,
      customDomains: 0,
      teamMembers: 1,
      apiKeys: 1,
      bioPages: 1,
      forms: 0,
      retentionYears: 1,
    },
  },
  {
    key: "starter",
    displayName: "Starter",
    description: "Your own domain and the essentials for a growing side project.",
    highlightBadge: null,
    sortOrder: 1,
    visibility: "public",
    features: {
      customDomains: true,
      passwordProtectedLinks: true,
      linkExpiry: true,
      routingRules: false,
      conversions: false,
      bioPages: true,
      forms: true,
      apiKeys: true,
      webhooks: false,
      csvExport: true,
      cookielessAnalytics: true,
      qrCustomisation: true,
    },
    limits: {
      links: 500,
      clicksPerMonth: 5_000_000,
      customDomains: 1,
      teamMembers: 3,
      apiKeys: 3,
      bioPages: 3,
      forms: 3,
      retentionYears: 2,
    },
    prices: inrPrices(59, 590),
  },
  {
    key: "pro",
    displayName: "Pro",
    description: "Routing, conversions and webhooks for teams running real campaigns.",
    highlightBadge: "Most popular",
    sortOrder: 2,
    visibility: "public",
    features: {
      customDomains: true,
      passwordProtectedLinks: true,
      linkExpiry: true,
      routingRules: true,
      conversions: true,
      bioPages: true,
      forms: true,
      apiKeys: true,
      webhooks: true,
      csvExport: true,
      cookielessAnalytics: true,
      qrCustomisation: true,
    },
    limits: {
      links: 10_000,
      clicksPerMonth: 25_000_000,
      customDomains: 5,
      teamMembers: 10,
      apiKeys: 10,
      bioPages: 25,
      forms: 25,
      retentionYears: 3,
    },
    prices: inrPrices(199, 1_990),
  },
  {
    key: "team",
    displayName: "Team",
    description: "Higher limits and more domains for a whole marketing team.",
    highlightBadge: null,
    sortOrder: 3,
    visibility: "public",
    features: {
      customDomains: true,
      passwordProtectedLinks: true,
      linkExpiry: true,
      routingRules: true,
      conversions: true,
      bioPages: true,
      forms: true,
      apiKeys: true,
      webhooks: true,
      csvExport: true,
      cookielessAnalytics: true,
      qrCustomisation: true,
    },
    limits: {
      links: 100_000,
      clicksPerMonth: 100_000_000,
      customDomains: 25,
      teamMembers: 50,
      apiKeys: 50,
      bioPages: 100,
      forms: 100,
      retentionYears: 5,
    },
    prices: inrPrices(299, 2_990),
  },
  {
    key: "enterprise",
    displayName: "Enterprise",
    // Hidden: assigned by an admin on a custom deal, never shown on /pricing.
    description: "Custom limits and a dedicated agreement. Talk to us.",
    highlightBadge: null,
    sortOrder: 4,
    visibility: "hidden",
    features: {
      customDomains: true,
      passwordProtectedLinks: true,
      linkExpiry: true,
      routingRules: true,
      conversions: true,
      bioPages: true,
      forms: true,
      apiKeys: true,
      webhooks: true,
      csvExport: true,
      cookielessAnalytics: true,
      qrCustomisation: true,
    },
    // Unlimited (null) where an enterprise deal is open-ended; a large finite
    // domain cap matching #966's ENTERPRISE_ENTITLEMENTS so the custom-domain
    // behaviour is unchanged for Enterprise workspaces.
    limits: {
      links: null,
      clicksPerMonth: null,
      customDomains: 1000,
      teamMembers: null,
      apiKeys: null,
      bioPages: null,
      forms: null,
      retentionYears: 7,
    },
  },
];

/** The default plan key a workspace falls back to — the fail-closed tier. */
export const DEFAULT_PLAN_KEY = "free";

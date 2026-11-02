import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  baselineEntitlements,
  emptyPlanPrices,
  FEATURE_NAMES,
  FeatureMatrix,
  LIMIT_NAMES,
  LimitMatrix,
  PlanPrices,
  priceFor,
  resolveEntitlements,
  type FeatureName,
  type LimitName,
  type LimitValue,
  type PricingTable,
  type ResolvableOverride,
  type ResolvableVersion,
  type ResolvedEntitlements,
} from "@snapurl/contract";
import {
  and,
  eq,
  gt,
  isNull,
  or,
  planVersions,
  plans,
  sql,
  workspacePlanOverrides,
  workspaces,
  type Database,
} from "@snapurl/database";
import { DB } from "../database/database.module.js";
import { DEFAULT_PLAN_KEY, SEED_PLANS, type SeedPlan } from "./plan-seed.js";

/** The compiled-in seed matrices keyed by plan key, used as the fallback when a
 *  plan is not in the DB catalogue (an unseeded database, or a test that writes
 *  workspaces.plan directly). A known seed key resolves to its compiled-in
 *  matrices; a key that is neither in the DB nor here falls through to `free`
 *  (fail closed). The DB catalogue, once seeded, always takes precedence. */
const SEED_BY_KEY = new Map<string, SeedPlan>(SEED_PLANS.map((p) => [p.key.toLowerCase(), p]));

/* ============================================================
   #970 — the DB-backed plans read path.

   ONE place resolves a workspace's effective entitlements from the stored plan
   catalogue, and it does so without a per-request database hit. The entitlement
   check runs on hot paths (every domain add, every API-key create, every link
   create), so this mirrors PlatformSettingsService (#972): read the whole small
   catalogue once, hold it for a short window, reload after that; a workspace's
   own plan + overrides are read per resolve but keyed into a short cache too.

   An unknown / unrecognised plan key resolves to `free` — fail closed. This is
   the #970 behaviour change: a plan key that is not in the catalogue is a
   mistake (a typo, a deleted plan, a stale value) and must never grant a paid
   feature.

   Admin writes live in PlansAdminService; this service is the READ model it and
   everything else share, plus the idempotent boot seed.
   ============================================================ */

/** A plan with its current version's matrices, as the cache holds it. */
export interface CatalogPlan {
  id: string;
  key: string;
  displayName: string;
  description: string;
  highlightBadge: string | null;
  sortOrder: number;
  visibility: "public" | "hidden" | "archived";
  currentVersionId: string | null;
  currentVersion: number;
  features: FeatureMatrix;
  limits: LimitMatrix;
  /** #987 — the current version's prices. An empty price set for an unpriced
   *  plan (free, enterprise) so callers never handle "absent". */
  prices: PlanPrices;
  /** #992 — the plan's trial length in days (0 = no trial) and whether a card
   *  is required up front. Checkout reads these to start a trial subscription.
   *  Defaults 0 / true, so a plan with no trial configured behaves as before. */
  trialDays: number;
  trialRequiresCard: boolean;
}

/** Parse a stored `pricing` jsonb into a PlanPrices, falling back to the empty
 *  (unpriced) set when it is null or malformed — a bad price never crashes a
 *  hot read, it just reads as "not priced". */
export function parsePricing(raw: unknown): PlanPrices {
  if (raw === null || raw === undefined) return emptyPlanPrices();
  const parsed = PlanPrices.safeParse(raw);
  return parsed.success ? parsed.data : emptyPlanPrices();
}

/** How long the loaded catalogue is served before the next read reloads it.
 *  Same "about a minute" window as the platform settings store. */
export const PLANS_CACHE_TTL_MS = 60_000;

@Injectable()
export class PlansService {
  private readonly logger = new Logger(PlansService.name);

  /** The whole plan catalogue, keyed by lower-cased plan key, cached. */
  private catalog: Map<string, CatalogPlan> | null = null;
  /** Every plan's version rows, keyed by `${planId}:${version}` → matrices, so a
   *  grandfathered workspace can resolve against an OLD version cheaply. */
  private versionsByKey: Map<string, ResolvableVersion> | null = null;
  private loadedAtMs = 0;

  /** The clock the cache window is measured against. A plain field (NOT a ctor
   *  param) so Nest never tries to resolve it as a provider; a test swaps it. */
  private now: () => number = Date.now;

  constructor(@Inject(DB) private readonly db: Database) {}

  /** Test-only: drive the cache window deterministically. */
  setClockForTesting(now: () => number): void {
    this.now = now;
  }

  /** Drop the cached catalogue so the next read reloads. Called by the admin
   *  write path after any plan/version change on this instance; other instances
   *  pick the change up within the cache window. */
  invalidate(): void {
    this.catalog = null;
    this.versionsByKey = null;
    this.loadedAtMs = 0;
  }

  /**
   * Seed the default catalogue when the plans table is empty. Idempotent: if ANY
   * plan row exists the seed does nothing, so an admin-edited catalogue is never
   * clobbered and a second boot is a no-op. Safe to call on every boot.
   */
  async seedIfEmpty(): Promise<void> {
    const [{ n }] = await this.db.select({ n: sql<number>`count(*)::int` }).from(plans);
    if ((n ?? 0) > 0) return;

    await this.db.transaction(async (tx) => {
      for (const seed of SEED_PLANS) {
        const [plan] = await tx
          .insert(plans)
          .values({
            key: seed.key.toLowerCase(),
            displayName: seed.displayName,
            description: seed.description,
            highlightBadge: seed.highlightBadge,
            sortOrder: seed.sortOrder,
            visibility: seed.visibility,
          })
          .returning({ id: plans.id });
        const [version] = await tx
          .insert(planVersions)
          .values({
            planId: plan!.id,
            version: 1,
            features: FeatureMatrix.parse(seed.features),
            limits: LimitMatrix.parse(seed.limits),
            // #987 — the plan's starting prices. A seed without prices (free,
            // enterprise) stores null; the read side reads that as unpriced.
            pricing: seed.prices ? PlanPrices.parse(seed.prices) : null,
          })
          .returning({ id: planVersions.id });
        await tx.update(plans).set({ currentVersionId: version!.id }).where(eq(plans.id, plan!.id));
      }
    });
    this.invalidate();
    this.logger.log(`Seeded ${SEED_PLANS.length} default plans.`);
  }

  /** The whole catalogue (cached), ordered by sortOrder then key. When the DB
   *  has no plans yet (unseeded), the compiled-in seed catalogue stands in so
   *  reads, the pricing table and the upgrade hints work before the boot seed
   *  has run. */
  async listCatalog(): Promise<CatalogPlan[]> {
    const { catalog } = await this.snapshot();
    const source = catalog.size > 0 ? [...catalog.values()] : this.seedCatalog();
    return source.sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key));
  }

  /** One plan by key (cached), case-insensitive, or null if unknown in both the
   *  DB and the seed. */
  async getByKey(key: string): Promise<CatalogPlan | null> {
    const { catalog } = await this.snapshot();
    const k = key.trim().toLowerCase();
    const fromDb = catalog.get(k);
    if (fromDb) return fromDb;
    if (catalog.size > 0) return null; // DB is seeded and does not have it
    return this.seedCatalog().find((p) => p.key.toLowerCase() === k) ?? null;
  }

  /** The public pricing table, built from the public-visible plans' current
   *  matrices. Hidden and archived plans are excluded — /pricing shows only what
   *  a visitor can sign up for. Ordered by sortOrder. */
  async pricingTable(): Promise<PricingTable> {
    const catalog = await this.listCatalog();
    const plansOut = catalog
      .filter((p) => p.visibility === "public")
      .map((p) => {
        const matrices = toResolvedMatrices(p.features, p.limits);
        return {
          key: p.key,
          displayName: p.displayName,
          description: p.description,
          highlightBadge: p.highlightBadge,
          features: matrices.features,
          limits: matrices.limits,
          // #987 — the plan's LIVE prices, so /pricing reflects an admin edit
          // within the cache window with no redeploy.
          prices: p.prices,
        };
      });
    return { plans: plansOut, featureOrder: [...FEATURE_NAMES], limitOrder: [...LIMIT_NAMES] };
  }

  /** #987 — the LIVE price for a (plan key, interval, currency) from the cached
   *  catalogue, or null when the plan or that (interval, currency) is not
   *  priced. Checkout reads this so a price edit takes effect within the cache
   *  window with no redeploy. `currency` defaults to the plan's primary. */
  async livePriceMinor(
    planKey: string,
    interval: "monthly" | "yearly",
    currency?: "INR" | "USD",
  ): Promise<number | null> {
    const plan = await this.getByKey(planKey);
    if (!plan) return null;
    return priceFor(plan.prices, interval, currency);
  }

  /** The compiled-in seed plans shaped as CatalogPlan, for the unseeded-DB
   *  fallback. Version is 1 (the seed's first version); ids are the seed key so
   *  the shape is complete without a DB row. */
  private seedCatalog(): CatalogPlan[] {
    return SEED_PLANS.map((s) => ({
      id: `seed:${s.key}`,
      key: s.key,
      displayName: s.displayName,
      description: s.description,
      highlightBadge: s.highlightBadge,
      sortOrder: s.sortOrder,
      visibility: s.visibility,
      currentVersionId: null,
      currentVersion: 1,
      features: s.features,
      limits: s.limits,
      prices: s.prices ?? emptyPlanPrices(),
      // #992 — the compiled-in seed has no trial configured; an admin sets one
      // on the live plan row, which the DB catalogue then carries.
      trialDays: 0,
      trialRequiresCard: true,
    }));
  }

  /**
   * The effective entitlements for a workspace RIGHT NOW: its plan's version (or
   * its grandfathered version if pinned), with its non-expired overrides folded
   * in. The single read every enforcement check uses.
   *
   * Fail closed: an empty/unknown plan key, or a plan with no resolvable
   * version, yields the `free` plan's entitlements if `free` exists, else the
   * bare baseline (everything off / 0) — never a paid default.
   */
  async resolveForWorkspace(workspaceId: string): Promise<ResolvedEntitlements> {
    const [ws] = await this.db
      .select({ plan: workspaces.plan, planVersionId: workspaces.planVersionId })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);
    if (!ws) return this.freeOrBaseline();

    const { catalog, versionsByKey } = await this.snapshot();
    const key = (ws.plan ?? "").trim().toLowerCase();

    // The DB catalogue is authoritative; a DB plan carries its current (or the
    // workspace's grandfathered) version. A key absent from the DB falls back to
    // the compiled-in seed matrices, and a key that is neither resolves to
    // `free` — fail closed, never a paid default.
    const dbPlan = key ? catalog.get(key) : undefined;
    let version: ResolvableVersion | null;
    if (dbPlan) {
      version = { features: dbPlan.features, limits: dbPlan.limits };
      if (ws.planVersionId) {
        const pinned = this.versionById(versionsByKey, dbPlan.id, ws.planVersionId);
        if (pinned) version = pinned;
      }
    } else {
      version = this.seedVersionFor(key);
    }

    const overrides = await this.loadActiveOverrides(workspaceId);
    return resolveEntitlements(version, overrides);
  }

  /* ── internals ── */

  /** The `free` plan's entitlements, or the bare baseline if `free` is absent
   *  from both the DB and the seed. */
  private async freeOrBaseline(): Promise<ResolvedEntitlements> {
    const free = await this.getByKey(DEFAULT_PLAN_KEY);
    if (free) return resolveEntitlements({ features: free.features, limits: free.limits });
    const seedFree = SEED_BY_KEY.get(DEFAULT_PLAN_KEY);
    if (seedFree) return resolveEntitlements({ features: seedFree.features, limits: seedFree.limits });
    return baselineEntitlements();
  }

  /** The compiled-in version matrices for a plan key not in the DB catalogue: a
   *  known seed key uses its matrices, anything else (including empty) falls
   *  back to the `free` seed — fail closed. Returns null only if `free` itself
   *  is somehow absent from the seed, which the resolver then reads as the bare
   *  baseline. */
  private seedVersionFor(key: string): ResolvableVersion | null {
    const seed = SEED_BY_KEY.get(key) ?? SEED_BY_KEY.get(DEFAULT_PLAN_KEY);
    if (!seed) return null;
    return { features: seed.features, limits: seed.limits };
  }

  /** A pinned version by its row id, confirmed to belong to the given plan. */
  private versionById(
    versionsByKey: Map<string, ResolvableVersion>,
    planId: string,
    versionId: string,
  ): ResolvableVersion | null {
    return versionsByKey.get(`id:${planId}:${versionId}`) ?? null;
  }

  /** A workspace's overrides that have not expired, as the resolver wants them.
   *  The expiry filter lives here (one clock) — the pure resolver takes an
   *  already-filtered list. Not cached per workspace: overrides are rare and a
   *  stale grant/removal is a correctness risk, so this is a small indexed read
   *  on the resolve path. */
  private async loadActiveOverrides(workspaceId: string): Promise<ResolvableOverride[]> {
    const rows = await this.db
      .select({
        kind: workspacePlanOverrides.kind,
        name: workspacePlanOverrides.name,
        value: workspacePlanOverrides.value,
      })
      .from(workspacePlanOverrides)
      .where(
        and(
          eq(workspacePlanOverrides.workspaceId, workspaceId),
          // not expired: null expiry, or an expiry still in the future.
          or(isNull(workspacePlanOverrides.expiresAt), gt(workspacePlanOverrides.expiresAt, new Date())),
        ),
      );
    return rows.map((r) => ({
      kind: r.kind === "limit" ? "limit" : "feature",
      name: r.name,
      value: r.value as boolean | number | null,
    }));
  }

  /** The cached catalogue + version map, reloading when stale. */
  private async snapshot(): Promise<{ catalog: Map<string, CatalogPlan>; versionsByKey: Map<string, ResolvableVersion> }> {
    if (this.catalog && this.versionsByKey && this.now() - this.loadedAtMs < PLANS_CACHE_TTL_MS) {
      return { catalog: this.catalog, versionsByKey: this.versionsByKey };
    }
    const loaded = await this.load();
    this.catalog = loaded.catalog;
    this.versionsByKey = loaded.versionsByKey;
    this.loadedAtMs = this.now();
    return loaded;
  }

  /** Read the whole catalogue + every version row and build the lookup maps. A
   *  version row whose matrices fail their schema is coerced to the empty
   *  (fail-closed) matrices rather than crashing the hot path. */
  private async load(): Promise<{
    catalog: Map<string, CatalogPlan>;
    versionsByKey: Map<string, ResolvableVersion>;
  }> {
    const planRows = await this.db
      .select({
        id: plans.id,
        key: plans.key,
        displayName: plans.displayName,
        description: plans.description,
        highlightBadge: plans.highlightBadge,
        sortOrder: plans.sortOrder,
        visibility: plans.visibility,
        currentVersionId: plans.currentVersionId,
        trialDays: plans.trialDays,
        trialRequiresCard: plans.trialRequiresCard,
      })
      .from(plans);

    const versionRows = await this.db
      .select({
        id: planVersions.id,
        planId: planVersions.planId,
        version: planVersions.version,
        features: planVersions.features,
        limits: planVersions.limits,
        pricing: planVersions.pricing,
      })
      .from(planVersions);

    const versionsByKey = new Map<string, ResolvableVersion>();
    const byId = new Map<
      string,
      { version: number; features: FeatureMatrix; limits: LimitMatrix; prices: PlanPrices }
    >();
    for (const v of versionRows) {
      const matrices: ResolvableVersion = {
        features: FeatureMatrix.safeParse(v.features).data ?? {},
        limits: LimitMatrix.safeParse(v.limits).data ?? {},
      };
      // Reachable both by (planId, version number) and by (planId, row id).
      versionsByKey.set(`num:${v.planId}:${v.version}`, matrices);
      versionsByKey.set(`id:${v.planId}:${v.id}`, matrices);
      byId.set(v.id, { version: v.version, ...matrices, prices: parsePricing(v.pricing) });
    }

    const catalog = new Map<string, CatalogPlan>();
    for (const p of planRows) {
      const current = p.currentVersionId ? byId.get(p.currentVersionId) : undefined;
      catalog.set(p.key.toLowerCase(), {
        id: p.id,
        key: p.key,
        displayName: p.displayName,
        description: p.description,
        highlightBadge: p.highlightBadge,
        sortOrder: p.sortOrder,
        visibility: (p.visibility as CatalogPlan["visibility"]) ?? "public",
        currentVersionId: p.currentVersionId,
        currentVersion: current?.version ?? 0,
        features: current?.features ?? {},
        limits: current?.limits ?? {},
        prices: current?.prices ?? emptyPlanPrices(),
        // #992 — trial config off the plan row (NOT NULL, defaults 0/1).
        trialDays: p.trialDays,
        trialRequiresCard: p.trialRequiresCard === 1,
      });
    }

    return { catalog, versionsByKey };
  }
}

/** Fully-default a plan's current-version matrices into a complete feature/limit
 *  map (every name present), for the admin/pricing views. Kept here so the view
 *  shape is derived in one place. */
export function toResolvedMatrices(features: FeatureMatrix, limits: LimitMatrix): {
  features: Record<FeatureName, boolean>;
  limits: Record<LimitName, LimitValue>;
} {
  const base = baselineEntitlements();
  for (const f of FEATURE_NAMES) if (typeof features[f] === "boolean") base.features[f] = features[f]!;
  for (const l of LIMIT_NAMES) {
    const v = limits[l];
    if (v === null || typeof v === "number") base.limits[l] = v;
  }
  return base;
}

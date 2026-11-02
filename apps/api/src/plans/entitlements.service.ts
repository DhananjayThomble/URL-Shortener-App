import { ForbiddenException, Injectable } from "@nestjs/common";
import {
  exceedsLimit,
  FEATURE_LABELS,
  isUnlimited,
  LIMIT_LABELS,
  type FeatureName,
  type LimitName,
  type LimitValue,
} from "@snapurl/contract";
import { PlansService } from "./plans.service.js";

/* ============================================================
   #970 — the ONE entitlement check every API path uses.

   Enforcement §6: "one entitlement check used by every API path. Exceeding a
   limit or using a feature not in the plan returns a 403 that names the feature
   or limit and the plan that includes it."

   assertFeature / assertWithinLimit read the workspace's resolved entitlements
   (through PlansService's cache) and throw a ForbiddenException whose message
   names the feature/limit and the cheapest plan that would grant it, so the
   error is actionable ("upgrade to Pro") rather than a bare 403.

   The cheapest-plan hint is derived from the live catalogue, so it stays right
   as an admin edits plans — there is no hard-coded "upgrade to X" anywhere.
   ============================================================ */

@Injectable()
export class EntitlementsService {
  constructor(private readonly plans: PlansService) {}

  /** May this workspace use the feature right now? A plain boolean read, for a
   *  caller that wants to branch rather than throw (e.g. hide a UI affordance). */
  async hasFeature(workspaceId: string, feature: FeatureName): Promise<boolean> {
    const resolved = await this.plans.resolveForWorkspace(workspaceId);
    return resolved.features[feature] === true;
  }

  /** The effective limit for a workspace, or null for unlimited. */
  async limitFor(workspaceId: string, limit: LimitName): Promise<LimitValue> {
    const resolved = await this.plans.resolveForWorkspace(workspaceId);
    return resolved.limits[limit];
  }

  /**
   * Refuse the action unless the workspace's plan includes `feature`. The 403
   * names the feature and the cheapest plan that includes it.
   */
  async assertFeature(workspaceId: string, feature: FeatureName): Promise<void> {
    if (await this.hasFeature(workspaceId, feature)) return;
    const label = FEATURE_LABELS[feature];
    const upgrade = await this.cheapestPlanWithFeature(feature);
    throw new ForbiddenException(
      upgrade
        ? `${capitalise(label)} ${isPlural(label) ? "are" : "is"} not included in your plan. The ${upgrade} plan includes ${isPlural(label) ? "them" : "it"} — upgrade to use ${isPlural(label) ? "them" : "it"}.`
        : `${capitalise(label)} ${isPlural(label) ? "are" : "is"} not included in your plan.`,
    );
  }

  /**
   * Refuse creating one more of `limit` when the workspace is already at its
   * cap. `currentCount` is the number it has NOW; the next item is refused when
   * currentCount >= the limit. Unlimited never refuses. The 403 names the limit,
   * the cap and the cheapest plan with a higher (or unlimited) cap.
   */
  async assertWithinLimit(workspaceId: string, limit: LimitName, currentCount: number): Promise<void> {
    const cap = await this.limitFor(workspaceId, limit);
    if (!exceedsLimit(cap, currentCount)) return;
    const label = LIMIT_LABELS[limit];
    const upgrade = await this.cheapestPlanWithHigherLimit(limit, cap ?? 0);
    const capText = cap === null ? "unlimited" : String(cap);
    throw new ForbiddenException(
      upgrade
        ? `You've reached your plan's limit of ${capText} ${label}. The ${upgrade} plan allows more — upgrade for a higher limit.`
        : `You've reached your plan's limit of ${capText} ${label}.`,
    );
  }

  /* ── internals: the upgrade hint, from the live catalogue ── */

  /** The display name of the cheapest (lowest sortOrder) plan whose current
   *  version includes the feature, or null if none does. */
  private async cheapestPlanWithFeature(feature: FeatureName): Promise<string | null> {
    const catalog = await this.plans.listCatalog();
    for (const plan of catalog) {
      if (plan.visibility === "archived") continue;
      if (plan.features[feature] === true) return plan.displayName;
    }
    return null;
  }

  /** The display name of the cheapest plan whose current version has a strictly
   *  higher (or unlimited) cap for the limit than `currentCap`. */
  private async cheapestPlanWithHigherLimit(limit: LimitName, currentCap: number): Promise<string | null> {
    const catalog = await this.plans.listCatalog();
    for (const plan of catalog) {
      if (plan.visibility === "archived") continue;
      const cap = plan.limits[limit];
      if (cap === undefined) continue;
      if (isUnlimited(cap) || (cap as number) > currentCap) return plan.displayName;
    }
    return null;
  }
}

function capitalise(s: string): string {
  return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

/** Crude English pluralisation check for the feature labels, which are already
 *  phrased as plurals where natural ("custom domains", "API keys"). Used only to
 *  pick "is/are" + "it/them" in the 403 copy. */
function isPlural(label: string): boolean {
  return label.endsWith("s");
}

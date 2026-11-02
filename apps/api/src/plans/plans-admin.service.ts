import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { FeatureMatrix, LimitMatrix, PlanPrices, PRICE_INTERVALS } from "@snapurl/contract";
import type {
  CreatePlanInput,
  MigrateWorkspaceVersionInput,
  OverrideView,
  PaidPlanKey,
  PlanList,
  PlanView,
  PriceCurrency,
  SetOverrideInput,
  UpdatePlanInput,
  UpdatePlanMatrixInput,
  UpdatePlanPricesInput,
} from "@snapurl/contract";
import {
  and,
  asc,
  desc,
  eq,
  planVersions,
  plans,
  sql,
  workspacePlanOverrides,
  workspaces,
  writeAdminAuditEntry,
  type Database,
} from "@snapurl/database";
import { DB } from "../database/database.module.js";
import type { AdminActor } from "../admin/admin-management.service.js";
import { BILLING_PROVIDER, type BillingProvider } from "../billing/billing-provider.js";
import { PlansService, parsePricing, toResolvedMatrices } from "./plans.service.js";

/** The paid plan keys whose price edits are pushed to the billing provider. A
 *  key outside this set (free, enterprise, an admin-added key) is still priced
 *  and audited; it just has no provider plan to sync. */
const PROVIDER_SYNCED_KEYS = new Set<string>(["starter", "pro", "team"]);

/* ============================================================
   #970 — the admin write path for plans, versions and overrides.

   Every write records a before/after row in the platform audit log, in the same
   transaction as the change, exactly like PlatformSettingsService and the #969
   management service, and busts the shared PlansService cache so the change
   takes effect within the cache window (immediately on this instance).

   Versioning rule (§5 grandfathering): editing a LIVE plan's feature matrix or
   limits creates a NEW version and moves plans.currentVersionId to it. Existing
   workspaces stay on their pinned version (or, if unpinned, resolve to whatever
   is current — so to truly grandfather an unpinned workspace it must be pinned
   to its current version at edit time; the admin migrate control pins/unpins).
   To keep unpinned workspaces on the OLD matrix when a plan is edited, every
   workspace on that plan that is NOT already pinned is pinned to the outgoing
   current version as part of the edit, so "existing workspaces stay on the old
   one" holds without the admin doing anything.
   ============================================================ */

@Injectable()
export class PlansAdminService {
  private readonly logger = new Logger(PlansAdminService.name);

  constructor(
    @Inject(DB) private readonly db: Database,
    private readonly plansRead: PlansService,
    /** #987 — the billing provider, to push an edited price to the provider.
     *  Optional: when billing is off (BILLING_PROVIDER=none) the sync is a
     *  no-op, and a price edit still lands in the catalogue and the audit log.
     *  @Optional so the admin module works whether or not billing is wired. */
    @Optional() @Inject(BILLING_PROVIDER) private readonly billing?: BillingProvider,
  ) {}

  /* ── plans ── */

  /** Every plan with its current version's matrices, for the admin grid. */
  async list(): Promise<PlanList> {
    const rows = await this.loadPlanViews();
    return { items: rows };
  }

  /** Create a plan and its first version (version 1). The key is unique
   *  (case-insensitive); a clash is a 409. */
  async create(input: CreatePlanInput, actor: AdminActor): Promise<PlanView> {
    const key = input.key.trim().toLowerCase();
    const [clash] = await this.db
      .select({ id: plans.id })
      .from(plans)
      .where(sql`lower(${plans.key}) = ${key}`)
      .limit(1);
    if (clash) throw new ConflictException(`A plan with the key "${key}" already exists.`);

    const planId = await this.db.transaction(async (tx) => {
      const [plan] = await tx
        .insert(plans)
        .values({
          key,
          displayName: input.displayName,
          description: input.description,
          highlightBadge: input.highlightBadge,
          sortOrder: input.sortOrder,
          visibility: input.visibility,
          // #992 — per-plan trial config. The contract defaults these (0 days,
          // card required), so an existing create call is unchanged.
          trialDays: input.trialDays,
          trialRequiresCard: input.trialRequiresCard ? 1 : 0,
        })
        .returning({ id: plans.id });
      const [version] = await tx
        .insert(planVersions)
        .values({
          planId: plan!.id,
          version: 1,
          features: FeatureMatrix.parse(input.features),
          limits: LimitMatrix.parse(input.limits),
        })
        .returning({ id: planVersions.id });
      await tx.update(plans).set({ currentVersionId: version!.id }).where(eq(plans.id, plan!.id));

      await writeAdminAuditEntry(tx, {
        actorId: actor.admin.id,
        actorLabel: actor.admin.email,
        action: "admin.plan.create",
        targetType: "plan",
        targetId: plan!.id,
        before: null,
        after: { key, displayName: input.displayName, visibility: input.visibility, version: 1 },
        requestIp: actor.ip,
      });
      return plan!.id;
    });

    this.plansRead.invalidate();
    return this.requirePlanView(planId);
  }

  /** Edit a plan's metadata (name, description, badge, sort, visibility). Does
   *  NOT version — that is editMatrix. */
  async update(planId: string, input: UpdatePlanInput, actor: AdminActor): Promise<PlanView> {
    const before = await this.requirePlanRow(planId);

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.displayName !== undefined) patch.displayName = input.displayName;
    if (input.description !== undefined) patch.description = input.description;
    if (input.highlightBadge !== undefined) patch.highlightBadge = input.highlightBadge;
    if (input.sortOrder !== undefined) patch.sortOrder = input.sortOrder;
    if (input.visibility !== undefined) patch.visibility = input.visibility;
    // #992 — per-plan trial config, each applied only when the input names it.
    if (input.trialDays !== undefined) patch.trialDays = input.trialDays;
    if (input.trialRequiresCard !== undefined) patch.trialRequiresCard = input.trialRequiresCard ? 1 : 0;

    await this.db.transaction(async (tx) => {
      await tx.update(plans).set(patch).where(eq(plans.id, planId));
      await writeAdminAuditEntry(tx, {
        actorId: actor.admin.id,
        actorLabel: actor.admin.email,
        action: "admin.plan.update",
        targetType: "plan",
        targetId: planId,
        before: {
          displayName: before.displayName,
          description: before.description,
          highlightBadge: before.highlightBadge,
          sortOrder: before.sortOrder,
          visibility: before.visibility,
          trialDays: before.trialDays,
          trialRequiresCard: before.trialRequiresCard === 1,
        },
        after: {
          displayName: input.displayName ?? before.displayName,
          description: input.description ?? before.description,
          highlightBadge: input.highlightBadge === undefined ? before.highlightBadge : input.highlightBadge,
          sortOrder: input.sortOrder ?? before.sortOrder,
          visibility: input.visibility ?? before.visibility,
          trialDays: input.trialDays ?? before.trialDays,
          trialRequiresCard: input.trialRequiresCard ?? before.trialRequiresCard === 1,
        },
        requestIp: actor.ip,
      });
    });

    this.plansRead.invalidate();
    return this.requirePlanView(planId);
  }

  /**
   * Edit a live plan's feature matrix / limits. Creates a NEW version
   * (currentVersion + 1), moves plans.currentVersionId to it, and — so existing
   * workspaces stay on the OLD matrix (grandfathering, §5) — pins every
   * unpinned workspace currently on this plan to the OUTGOING version first.
   */
  async editMatrix(planId: string, input: UpdatePlanMatrixInput, actor: AdminActor): Promise<PlanView> {
    const before = await this.requirePlanRow(planId);

    const newVersionNumber = await this.db.transaction(async (tx) => {
      // The current (outgoing) version number + id.
      const [cur] = await tx
        .select({ id: planVersions.id, version: planVersions.version })
        .from(planVersions)
        .where(eq(planVersions.planId, planId))
        .orderBy(desc(planVersions.version))
        .limit(1);
      const outgoingVersionId = cur?.id ?? before.currentVersionId;
      const nextVersion = (cur?.version ?? 0) + 1;

      // Grandfather every unpinned workspace on this plan onto the outgoing
      // version so the edit never silently changes their entitlements.
      if (outgoingVersionId) {
        await tx.execute(sql`
          update workspaces
             set plan_version_id = ${outgoingVersionId}
           where lower(plan) = ${before.key.toLowerCase()}
             and plan_version_id is null
        `);
      }

      const [version] = await tx
        .insert(planVersions)
        .values({
          planId,
          version: nextVersion,
          features: FeatureMatrix.parse(input.features),
          limits: LimitMatrix.parse(input.limits),
        })
        .returning({ id: planVersions.id });
      await tx
        .update(plans)
        .set({ currentVersionId: version!.id, updatedAt: new Date() })
        .where(eq(plans.id, planId));

      await writeAdminAuditEntry(tx, {
        actorId: actor.admin.id,
        actorLabel: actor.admin.email,
        action: "admin.plan.version",
        targetType: "plan",
        targetId: planId,
        before: { version: cur?.version ?? 0 },
        after: { version: nextVersion, features: input.features, limits: input.limits },
        requestIp: actor.ip,
      });
      return nextVersion;
    });

    void newVersionNumber;
    this.plansRead.invalidate();
    return this.requirePlanView(planId);
  }

  /**
   * #987 — edit a live plan's PRICES. Creates a NEW version carrying the SAME
   * feature matrix + limits as the outgoing version but the new prices, moves
   * the plan's current version forward, and — exactly like editMatrix — pins
   * every unpinned workspace on this plan to the outgoing version first, so a
   * price change applies to NEW subscriptions only and existing subscribers keep
   * the price they are on (grandfathering, §2). The change is audited in the
   * same transaction, then the new price is pushed to the billing provider
   * (best-effort: a provider sync failure is logged, never rolls the edit back —
   * the catalogue is the source of truth, the provider is downstream).
   */
  async editPrices(planId: string, input: UpdatePlanPricesInput, actor: AdminActor): Promise<PlanView> {
    const before = await this.requirePlanRow(planId);
    const prices = PlanPrices.parse(input.prices);

    const outcome = await this.db.transaction(async (tx) => {
      // The current (outgoing) version: its number, and its matrices to carry
      // forward unchanged onto the new priced version.
      const [cur] = await tx
        .select({
          id: planVersions.id,
          version: planVersions.version,
          features: planVersions.features,
          limits: planVersions.limits,
          pricing: planVersions.pricing,
        })
        .from(planVersions)
        .where(eq(planVersions.planId, planId))
        .orderBy(desc(planVersions.version))
        .limit(1);
      const outgoingVersionId = cur?.id ?? before.currentVersionId;
      const nextVersion = (cur?.version ?? 0) + 1;

      // Grandfather every unpinned workspace on this plan onto the outgoing
      // version so the price change never silently reprices them.
      if (outgoingVersionId) {
        await tx.execute(sql`
          update workspaces
             set plan_version_id = ${outgoingVersionId}
           where lower(plan) = ${before.key.toLowerCase()}
             and plan_version_id is null
        `);
      }

      const [version] = await tx
        .insert(planVersions)
        .values({
          planId,
          version: nextVersion,
          // Carry the outgoing matrices forward unchanged — only the price moves.
          features: FeatureMatrix.parse(cur?.features ?? {}),
          limits: LimitMatrix.parse(cur?.limits ?? {}),
          pricing: prices,
        })
        .returning({ id: planVersions.id });
      await tx
        .update(plans)
        .set({ currentVersionId: version!.id, updatedAt: new Date() })
        .where(eq(plans.id, planId));

      await writeAdminAuditEntry(tx, {
        actorId: actor.admin.id,
        actorLabel: actor.admin.email,
        action: "admin.plan.price",
        targetType: "plan",
        targetId: planId,
        before: { version: cur?.version ?? 0, prices: parsePricing(cur?.pricing) },
        after: { version: nextVersion, prices },
        requestIp: actor.ip,
      });
      return { nextVersion };
    });

    void outcome;
    this.plansRead.invalidate();

    // Push the new prices to the billing provider, best-effort and OUTSIDE the
    // transaction (a provider call must never hold a DB transaction open).
    await this.syncPricesToProvider(before.key, prices);

    return this.requirePlanView(planId);
  }

  /** #987 — push every priced (interval, currency) of a paid plan to the
   *  billing provider. Best-effort: billing off, a provider with no price sync,
   *  or a provider error all leave the catalogue edit intact; the failure is
   *  logged, not raised. */
  private async syncPricesToProvider(planKey: string, prices: PlanPrices): Promise<void> {
    const key = planKey.toLowerCase();
    if (!PROVIDER_SYNCED_KEYS.has(key)) return;
    const provider = this.billing;
    if (!provider || !provider.enabled || !provider.syncPlanPrice) return;

    for (const interval of PRICE_INTERVALS) {
      const forInterval = prices.amounts[interval];
      if (!forInterval) continue;
      for (const [currency, amountMinor] of Object.entries(forInterval)) {
        if (typeof amountMinor !== "number") continue;
        try {
          const synced = await provider.syncPlanPrice({
            planKey: key as PaidPlanKey,
            interval,
            currency: currency as PriceCurrency,
            amountMinor,
          });
          const id = synced && "providerPlanId" in synced ? synced.providerPlanId : "(none)";
          this.logger.log(`Synced ${key} ${interval} ${currency} ${amountMinor} → provider plan ${id}`);
        } catch (err) {
          // Downstream, non-fatal: the catalogue holds the truth.
          this.logger.warn(
            `Provider price sync failed for ${key} ${interval} ${currency}: ${(err as Error).message}`,
          );
        }
      }
    }
  }

  /* ── per-workspace overrides ── */

  /** Set (upsert) a per-workspace override. One row per (workspace, kind, name):
   *  setting an override that already exists replaces it. */
  async setOverride(workspaceId: string, input: SetOverrideInput, actor: AdminActor): Promise<OverrideView> {
    await this.requireWorkspace(workspaceId);
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;

    const [before] = await this.db
      .select({ value: workspacePlanOverrides.value, expiresAt: workspacePlanOverrides.expiresAt })
      .from(workspacePlanOverrides)
      .where(
        and(
          eq(workspacePlanOverrides.workspaceId, workspaceId),
          eq(workspacePlanOverrides.kind, input.kind),
          eq(workspacePlanOverrides.name, input.name),
        ),
      )
      .limit(1);

    const row = await this.db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(workspacePlanOverrides)
        .values({
          workspaceId,
          kind: input.kind,
          name: input.name,
          value: input.value,
          expiresAt,
          createdById: actor.admin.id,
          createdByLabel: actor.admin.email,
        })
        .onConflictDoUpdate({
          target: [workspacePlanOverrides.workspaceId, workspacePlanOverrides.kind, workspacePlanOverrides.name],
          set: {
            value: input.value,
            expiresAt,
            createdById: actor.admin.id,
            createdByLabel: actor.admin.email,
            createdAt: new Date(),
          },
        })
        .returning();

      await writeAdminAuditEntry(tx, {
        actorId: actor.admin.id,
        actorLabel: actor.admin.email,
        action: "admin.workspace.override_set",
        targetType: "workspace",
        targetId: workspaceId,
        before: before ? { value: before.value, expiresAt: before.expiresAt?.toISOString() ?? null } : null,
        after: { kind: input.kind, name: input.name, value: input.value, expiresAt: expiresAt?.toISOString() ?? null },
        requestIp: actor.ip,
      });
      return inserted!;
    });

    this.plansRead.invalidate();
    return this.toOverrideView(row);
  }

  /** The overrides on a workspace (including expired ones, so an admin can see
   *  and clear them). */
  async listOverrides(workspaceId: string): Promise<{ items: OverrideView[] }> {
    await this.requireWorkspace(workspaceId);
    const rows = await this.db
      .select()
      .from(workspacePlanOverrides)
      .where(eq(workspacePlanOverrides.workspaceId, workspaceId))
      .orderBy(asc(workspacePlanOverrides.kind), asc(workspacePlanOverrides.name));
    return { items: rows.map((r) => this.toOverrideView(r)) };
  }

  /** Remove an override by id (scoped to the workspace). */
  async removeOverride(workspaceId: string, overrideId: string, actor: AdminActor): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [removed] = await tx
        .delete(workspacePlanOverrides)
        .where(and(eq(workspacePlanOverrides.id, overrideId), eq(workspacePlanOverrides.workspaceId, workspaceId)))
        .returning();
      if (!removed) throw new NotFoundException("No such override on this workspace.");
      await writeAdminAuditEntry(tx, {
        actorId: actor.admin.id,
        actorLabel: actor.admin.email,
        action: "admin.workspace.override_remove",
        targetType: "workspace",
        targetId: workspaceId,
        before: { kind: removed.kind, name: removed.name, value: removed.value },
        after: null,
        requestIp: actor.ip,
      });
    });
    this.plansRead.invalidate();
  }

  /* ── grandfather migration ── */

  /** Pin a workspace to a specific plan version (by version NUMBER on its
   *  current plan), or null to unpin (follow the plan's current version). */
  async migrateWorkspaceVersion(
    workspaceId: string,
    input: MigrateWorkspaceVersionInput,
    actor: AdminActor,
  ): Promise<void> {
    const [ws] = await this.db
      .select({ plan: workspaces.plan, planVersionId: workspaces.planVersionId })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);
    if (!ws) throw new NotFoundException("No such workspace.");

    let newVersionId: string | null = null;
    if (input.version !== null) {
      const [plan] = await this.db
        .select({ id: plans.id })
        .from(plans)
        .where(sql`lower(${plans.key}) = ${(ws.plan ?? "").trim().toLowerCase()}`)
        .limit(1);
      if (!plan) throw new BadRequestException("This workspace's plan is not a known plan, so it cannot be pinned to a version.");
      const [version] = await this.db
        .select({ id: planVersions.id })
        .from(planVersions)
        .where(and(eq(planVersions.planId, plan.id), eq(planVersions.version, input.version)))
        .limit(1);
      if (!version) throw new NotFoundException(`Version ${input.version} does not exist for this plan.`);
      newVersionId = version.id;
    }

    await this.db.transaction(async (tx) => {
      await tx.update(workspaces).set({ planVersionId: newVersionId, updatedAt: new Date() }).where(eq(workspaces.id, workspaceId));
      await writeAdminAuditEntry(tx, {
        actorId: actor.admin.id,
        actorLabel: actor.admin.email,
        action: "admin.workspace.migrate_version",
        targetType: "workspace",
        targetId: workspaceId,
        before: { planVersionId: ws.planVersionId },
        after: { planVersionId: newVersionId, version: input.version },
        requestIp: actor.ip,
      });
    });
    this.plansRead.invalidate();
  }

  /* ── internals ── */

  private async loadPlanViews(): Promise<PlanView[]> {
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
      .from(plans)
      .orderBy(asc(plans.sortOrder), asc(plans.key));

    const versionRows = await this.db
      .select({
        id: planVersions.id,
        version: planVersions.version,
        features: planVersions.features,
        limits: planVersions.limits,
        pricing: planVersions.pricing,
      })
      .from(planVersions);
    const byId = new Map(versionRows.map((v) => [v.id, v]));

    return planRows.map((p) => {
      const cur = p.currentVersionId ? byId.get(p.currentVersionId) : undefined;
      const matrices = toResolvedMatrices(
        (FeatureMatrix.safeParse(cur?.features).data ?? {}),
        (LimitMatrix.safeParse(cur?.limits).data ?? {}),
      );
      return {
        id: p.id,
        key: p.key,
        displayName: p.displayName,
        description: p.description,
        highlightBadge: p.highlightBadge,
        sortOrder: p.sortOrder,
        visibility: p.visibility as PlanView["visibility"],
        version: cur?.version ?? 0,
        features: matrices.features,
        limits: matrices.limits,
        prices: parsePricing(cur?.pricing),
        // #992 — the plan's trial config (trial_days = 0 means no trial). The
        // DB columns are NOT NULL with 0/1 defaults, so an existing plan reads
        // as "no trial, card required" until an admin sets it.
        trialDays: p.trialDays,
        trialRequiresCard: p.trialRequiresCard === 1,
      };
    });
  }

  private async requirePlanView(planId: string): Promise<PlanView> {
    const all = await this.loadPlanViews();
    const found = all.find((p) => p.id === planId);
    if (!found) throw new NotFoundException("No such plan.");
    return found;
  }

  private async requirePlanRow(planId: string) {
    const [row] = await this.db
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
      .from(plans)
      .where(eq(plans.id, planId))
      .limit(1);
    if (!row) throw new NotFoundException("No such plan.");
    return row;
  }

  private async requireWorkspace(workspaceId: string): Promise<void> {
    const [ws] = await this.db.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
    if (!ws) throw new NotFoundException("No such workspace.");
  }

  private toOverrideView(row: typeof workspacePlanOverrides.$inferSelect): OverrideView {
    return {
      id: row.id,
      kind: row.kind === "limit" ? "limit" : "feature",
      name: row.name,
      value: row.value as boolean | number | null,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      createdBy: row.createdByLabel ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

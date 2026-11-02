import { Global, Module, type OnApplicationBootstrap } from "@nestjs/common";
import { Logger } from "@nestjs/common";
import { PlansService } from "./plans.service.js";
import { EntitlementsService } from "./entitlements.service.js";
import { UsageService } from "./usage.service.js";

/* ============================================================
   #970 — the plans / entitlements engine as its own GLOBAL module.

   Global because the entitlement check runs on many unrelated hot paths — domain
   add, API-key create, link create, webhook create, the public /pricing read,
   the Settings usage read — and every one must share ONE PlansService cache, the
   same way PlatformSettingsModule (#972) is global for its single cache. A plain
   provider per importer would give each its own cache with its own TTL window,
   and the whole point is that there is one.

   On boot it seeds the default plan catalogue into an empty plans table
   (idempotent: a database that already has plans — an admin-edited catalogue —
   is never touched). It depends only on DB (global), so it introduces no module
   cycle.
   ============================================================ */
@Global()
@Module({
  providers: [PlansService, EntitlementsService, UsageService],
  exports: [PlansService, EntitlementsService, UsageService],
})
export class PlansModule implements OnApplicationBootstrap {
  private readonly logger = new Logger(PlansModule.name);

  constructor(private readonly plans: PlansService) {}

  /** Seed the default catalogue once the app is up and the DB is reachable.
   *  Idempotent and best-effort: a seeding failure (e.g. the migration has not
   *  run yet in a race) is logged, not fatal — the compiled-in seed fallback in
   *  PlansService keeps entitlement resolution correct until the next boot seeds
   *  the table. */
  async onApplicationBootstrap(): Promise<void> {
    try {
      await this.plans.seedIfEmpty();
    } catch (err) {
      this.logger.warn(`Plan seed skipped: ${(err as Error).message}`);
    }
  }
}

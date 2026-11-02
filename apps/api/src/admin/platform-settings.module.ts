import { Global, Module } from "@nestjs/common";
import { PlatformSettingsService } from "./platform-settings.service.js";
import { KillSwitchService } from "./kill-switch.service.js";

/* #972 — the runtime platform-settings store as its own GLOBAL module.
 *
 * Global because three unrelated places read the same single cache and must
 * share one instance: the admin controller (read/write), the throttler guard in
 * app.module (reads the rate limit per request), and the auth service (reads the
 * signup gate on register and OAuth sign-in). A plain provider inside AdminModule
 * would hand each importer its own instance — and the whole point of the cache is
 * that there is one, with one TTL window. It depends only on DB and ENV, both of
 * which are already global, so it introduces no module cycle. */
@Global()
@Module({
  providers: [PlatformSettingsService, KillSwitchService],
  exports: [PlatformSettingsService, KillSwitchService],
})
export class PlatformSettingsModule {}

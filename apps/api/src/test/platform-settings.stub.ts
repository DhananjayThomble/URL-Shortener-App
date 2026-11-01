import type { PlatformSettingsService } from "../admin/platform-settings.service.js";

/* #972 — a PlatformSettingsService stub for integration tests that construct
   AuthService / LinksService directly (not through Nest DI) and do not
   themselves exercise the settings feature.

   AuthService.register / oauthSignIn read the signup gate, and LinksService
   read the reserved-slug list, through this service on every call. A test that
   seeds accounts or creates links therefore needs SOME settings object or it
   hits `this.settings.getValues()` on undefined. This stub returns the default,
   open-everything values — signups open, the generous default rate limit, no
   reserved slugs, no flags, no banner — so those tests behave exactly as they
   did before #972 added the dependency. A test that is specifically about the
   settings feature uses the real service instead (see
   platform-settings.integration.test.ts). */
export function openPlatformSettingsStub(): PlatformSettingsService {
  const values = {
    signupMode: "open" as const,
    rateLimit: { limit: 120, ttlSeconds: 60 },
    reservedSlugs: [] as string[],
    featureFlags: {} as Record<string, boolean>,
    banner: { message: "", level: "info" as const },
  };
  return {
    getValues: async () => values,
    getBanner: async () => ({ message: "", level: "info" as const }),
  } as unknown as PlatformSettingsService;
}

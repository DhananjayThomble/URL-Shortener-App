import type { PlatformSettingsService } from "../admin/platform-settings.service.js";
import type { PlatformSettingsValues } from "@snapurl/contract";

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
   platform-settings.integration.test.ts).

   #993 — the stub now also carries the launch-readiness settings, with the same
   defaults the real service compiles in: new-account caps ON (7d/20/10), bot
   protection OFF, no disposable-email additions. A test that drives one of
   those features (a caps test tightening the limit, a disposable test adding a
   domain) passes an override; everything else keeps the hands-off defaults, so
   a plain seed-accounts/create-links test is unaffected. */
export function openPlatformSettingsStub(
  overrides: Partial<PlatformSettingsValues> = {},
): PlatformSettingsService {
  const values: PlatformSettingsValues = {
    signupMode: "open" as const,
    rateLimit: { limit: 120, ttlSeconds: 60 },
    reservedSlugs: [] as string[],
    featureFlags: {} as Record<string, boolean>,
    banner: { message: "", level: "info" as const },
    newAccountLimits: { windowDays: 7, perDay: 20, perHour: 10 },
    botProtection: { provider: "none" as const },
    disposableEmails: { extraDomains: [] as string[], allowDomains: [] as string[] },
    ...overrides,
  };
  return {
    getValues: async () => values,
    getBanner: async () => ({ message: "", level: "info" as const }),
  } as unknown as PlatformSettingsService;
}

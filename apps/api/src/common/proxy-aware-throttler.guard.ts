import { Inject, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import {
  ThrottlerGuard,
  ThrottlerModuleOptions,
  ThrottlerStorage,
  type ThrottlerRequest,
} from "@nestjs/throttler";
import { clientIpFromXff } from "@snapurl/domain";
import { ENV, type Env } from "../config/env.js";
import { PlatformSettingsService } from "../admin/platform-settings.service.js";

/* @nestjs/throttler's package index does NOT re-export its constants, so
   importing THROTTLER_LIMIT from "@nestjs/throttler" yields undefined. The
   metadata-key STRING the @Throttle decorator writes is stable public API
   (documented in throttler.constants.d.ts and unchanged across v5/v6), so we
   name it here. `@Throttle({ <name>: { limit } })` stores the limit under
   `${THROTTLER_LIMIT_META}${name}` on the handler/class. */
const THROTTLER_LIMIT_META = "THROTTLER:LIMIT";

/* @nestjs/throttler keys every limit on the value getTracker() returns, and the
   default returns req.ip. With Fastify's `trustProxy` that is the LEFTMOST
   X-Forwarded-For entry — a value the client types — so rotating the header
   hands out an unbounded budget on every throttled route.

   We override getTracker to derive the client IP the spoof-proof way: the
   (TRUSTED_PROXY_HOPS+1)th entry from the RIGHT of X-Forwarded-For (see
   clientIpFromXff in @snapurl/domain), falling back to the socket peer when
   there is no trusted entry. Anything the client prepends is ignored, so a
   rotating header can no longer reset a limit. */
@Injectable()
export class ProxyAwareThrottlerGuard extends ThrottlerGuard {
  constructor(
    options: ThrottlerModuleOptions,
    storageService: ThrottlerStorage,
    reflector: Reflector,
    @Inject(ENV) private readonly env: Env,
    // Explicit @Inject by token: the vitest esbuild transform does not emit
    // design:paramtypes, so without this Nest cannot resolve this param by type
    // in the stack tests and it arrives undefined (the ENV param above is fine
    // for the same reason — it is token-injected too).
    @Inject(PlatformSettingsService) private readonly settings: PlatformSettingsService,
  ) {
    super(options, storageService, reflector);
  }

  /* #972 — make the GLOBAL rate limit a runtime setting.

     The module binds the throttler to the THROTTLE_* env values at startup, so
     `requestProps.limit`/`.ttl` carry those static numbers. We override them per
     request with the cached platform setting (which itself falls back to the
     same env values when unset), so an operator can change the global limit from
     the admin panel and it applies within the cache window WITHOUT a restart.

     But ONLY for a route whose limit came from the module default. A route with
     its own @Throttle({ ... }) — the 5/min on /auth/login, /auth/register and
     /public/.../unlock — is a deliberate, security-specific limit that is NOT
     operator-tunable, so it is left exactly as declared. @Throttle writes
     route/class metadata under THROTTLER_LIMIT+name; when that metadata is
     present for this throttler we do not touch the request. The read is a cached
     field access, not a DB query, so the hot path is unchanged.

     If the settings read ever fails, fall back to the static limit the module
     already resolved rather than turning a throttle check into a 500 — a
     rate-limit lookup must never take the request down. */
  protected override async handleRequest(requestProps: ThrottlerRequest): Promise<boolean> {
    const name = requestProps.throttler.name ?? "default";
    const hasRouteLimit =
      this.reflector.getAllAndOverride(THROTTLER_LIMIT_META + name, [
        requestProps.context.getHandler(),
        requestProps.context.getClass(),
      ]) != null;

    if (hasRouteLimit) {
      return super.handleRequest(requestProps);
    }

    try {
      const { limit, ttlSeconds } = (await this.settings.getValues()).rateLimit;
      return super.handleRequest({ ...requestProps, limit, ttl: ttlSeconds * 1000 });
    } catch {
      return super.handleRequest(requestProps);
    }
  }

  protected override async getTracker(req: Record<string, any>): Promise<string> {
    /* Under @nestjs/platform-fastify `req` is the Fastify request. `req.raw` is
       the underlying Node request, whose socket carries the real peer address;
       `req.ip` is the safe fallback if the raw socket is somehow unavailable. */
    const socketIp: string = req?.raw?.socket?.remoteAddress ?? req?.ip ?? "";
    return clientIpFromXff({
      xff: req?.headers?.["x-forwarded-for"],
      socketIp,
      trustedHops: this.env.TRUSTED_PROXY_HOPS,
    });
  }
}

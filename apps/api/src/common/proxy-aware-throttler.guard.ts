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
    private readonly settings: PlatformSettingsService,
  ) {
    super(options, storageService, reflector);
  }

  /* #972 — make the GLOBAL rate limit a runtime setting.

     The module binds the throttler to the THROTTLE_* env values at startup, so
     `requestProps.limit`/`.ttl` carry those static numbers. We override the
     DEFAULT throttler's values per request with the cached platform setting
     (which itself falls back to the same env values when unset), so an operator
     can change the limit from the admin panel and it applies within the cache
     window WITHOUT a restart. A route with its own @Throttle({ ... }) (e.g. the
     5/min on /public/.../unlock, or /auth/login) carries a non-"default"
     throttler name and is left exactly as declared — those tight,
     security-specific limits are deliberate and not operator-tunable. The read
     is a cached field access, not a DB query, so the hot path is unchanged. */
  protected override async handleRequest(requestProps: ThrottlerRequest): Promise<boolean> {
    if (requestProps.throttler.name !== "default") {
      return super.handleRequest(requestProps);
    }
    const { limit, ttlSeconds } = (await this.settings.getValues()).rateLimit;
    return super.handleRequest({ ...requestProps, limit, ttl: ttlSeconds * 1000 });
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

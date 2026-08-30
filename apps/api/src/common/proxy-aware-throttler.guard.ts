import { Inject, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ThrottlerGuard, ThrottlerModuleOptions, ThrottlerStorage } from "@nestjs/throttler";
import { clientIpFromXff } from "@snapurl/domain";
import { ENV, type Env } from "../config/env.js";

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
  ) {
    super(options, storageService, reflector);
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

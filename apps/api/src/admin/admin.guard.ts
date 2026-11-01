import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
  createParamDecorator,
} from "@nestjs/common";
import { clientIpFromXff } from "@snapurl/domain";
import { ENV, type Env } from "../config/env.js";
import { AdminService, type AdminIdentity } from "./admin.service.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Set by AdminGuard once the caller is confirmed a platform admin. */
    admin?: AdminIdentity;
    /** The resolved client IP, attached by AdminGuard for the audit trail. */
    adminRequestIp?: string;
  }
}

/**
 * Guards every `/api/v1/admin/*` route.
 *
 * Runs AFTER the global AuthGuard (which authenticates and sets request.actor),
 * so by the time it runs the caller already holds a valid session. It then
 * applies the platform-admin check — verified allow-listed email AND 2FA — to
 * the LIVE user row via AdminService, and refuses anyone who does not clear it.
 *
 * Applied at the controller with `@UseGuards(AdminGuard)` rather than globally:
 * the admin surface is a small, explicitly-gated area, and a controller guard
 * keeps the check next to the routes it protects. A non-admin session gets a
 * 403; an API-key caller (no user behind it) can never be an admin.
 *
 * On success it stashes the resolved AdminIdentity and the client IP on the
 * request so handlers reach them via @Admin() / @AdminRequestIp() without
 * re-querying or re-deriving.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(
    private readonly admins: AdminService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const actor = request.actor;
    // AuthGuard runs first and sets actor; its absence means the route was
    // reached without authentication, which must never happen for /admin.
    if (!actor) throw new UnauthorizedException("Sign in to continue.");

    const admin = await this.admins.resolveAdmin(actor.userId);
    if (!admin) throw new ForbiddenException("You don't have access to the admin area.");

    request.admin = admin;
    request.adminRequestIp = this.resolveIp(request);
    return true;
  }

  /** The spoof-proof client IP, derived the same way the throttler does. */
  private resolveIp(request: Record<string, any>): string {
    const socketIp: string = request?.raw?.socket?.remoteAddress ?? request?.ip ?? "";
    return clientIpFromXff({
      xff: request?.headers?.["x-forwarded-for"],
      socketIp,
      trustedHops: this.env.TRUSTED_PROXY_HOPS,
    });
  }
}

/** The confirmed platform admin for this request. Only resolvable behind
 *  AdminGuard, which is the only thing that sets it. */
export const Admin = createParamDecorator((_data: unknown, ctx: ExecutionContext): AdminIdentity => {
  const request = ctx.switchToHttp().getRequest();
  if (!request.admin) throw new UnauthorizedException();
  return request.admin;
});

/** The resolved client IP for this request, for the admin audit trail. */
export const AdminRequestIp = createParamDecorator((_data: unknown, ctx: ExecutionContext): string | null => {
  const request = ctx.switchToHttp().getRequest();
  return request.adminRequestIp ?? null;
});

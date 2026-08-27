import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  createParamDecorator,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { createHash } from "node:crypto";
import { and, apiKeys, eq, isNull, type Database } from "@snapurl/database";
import { DB } from "../database/database.module.js";
import { TokenService } from "./token.service.js";

export interface RequestActor {
  userId: string | null;
  workspaceId: string;
  role: string;
  email: string;
  /** Set when the caller authenticated with an API key rather than a session. */
  apiKeyId?: string;
  scopes?: string[];
  label: string;
}

declare module "fastify" {
  interface FastifyRequest {
    actor?: RequestActor;
  }
}

export const IS_PUBLIC = "isPublic";
/** Opts a route out of authentication. Applied per-route, never per-module —
 *  a public module is one forgotten decorator away from leaking everything. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const REQUIRED_ROLES = "requiredRoles";
export const Roles = (...roles: Array<"owner" | "admin" | "editor" | "viewer">) =>
  SetMetadata(REQUIRED_ROLES, roles);

export const REQUIRED_SCOPE = "requiredScope";
export const Scope = (scope: string) => SetMetadata(REQUIRED_SCOPE, scope);

export const Actor = createParamDecorator((_data: unknown, ctx: ExecutionContext): RequestActor => {
  const request = ctx.switchToHttp().getRequest();
  if (!request.actor) throw new UnauthorizedException();
  return request.actor;
});

/** owner ⊃ admin ⊃ editor ⊃ viewer. Higher rank satisfies a lower requirement. */
const RANK: Record<string, number> = { viewer: 0, editor: 1, admin: 2, owner: 3 };

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    @Inject(DB) private readonly db: Database,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const header: string | undefined = request.headers?.authorization;
    if (!header?.startsWith("Bearer ")) {
      throw new UnauthorizedException("Sign in to continue.");
    }

    const credential = header.slice(7).trim();
    request.actor = credential.startsWith("snap_")
      ? await this.actorFromApiKey(credential)
      : await this.actorFromJwt(credential);

    const required = this.reflector.getAllAndOverride<string[]>(REQUIRED_ROLES, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (required?.length) {
      const have = RANK[request.actor.role] ?? -1;
      const need = Math.min(...required.map((r) => RANK[r] ?? 99));
      if (have < need) throw new ForbiddenException("You don't have permission to do that.");
    }

    const scope = this.reflector.getAllAndOverride<string>(REQUIRED_SCOPE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (scope && request.actor.scopes && !request.actor.scopes.includes(scope)) {
      throw new ForbiddenException(`This API key is missing the "${scope}" scope.`);
    }

    return true;
  }

  private async actorFromJwt(token: string): Promise<RequestActor> {
    const claims = await this.tokens.verifyAccessToken(token);
    return {
      userId: claims.sub,
      workspaceId: claims.wid,
      role: claims.role,
      email: claims.email,
      label: claims.email,
    };
  }

  /** API keys are stored hashed, so the lookup is by hash, not by value. */
  private async actorFromApiKey(key: string): Promise<RequestActor> {
    const keyHash = createHash("sha256").update(key).digest("hex");
    const [row] = await this.db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.keyHash, keyHash), isNull(apiKeys.revokedAt)))
      .limit(1);

    if (!row) throw new UnauthorizedException("That API key isn't valid.");

    // Fire-and-forget: a failed usage stamp must not fail the request.
    void this.db
      .update(apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiKeys.id, row.id))
      .catch(() => {});

    return {
      userId: null,
      workspaceId: row.workspaceId,
      // An API key acts with a fixed rank — it cannot be an owner, so it can
      // never delete the workspace that issued it.
      role: "editor",
      email: `apikey:${row.keyPrefix}`,
      apiKeyId: row.id,
      scopes: row.scopes,
      label: `API key "${row.name}"`,
    };
  }
}

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import * as argon2 from "argon2";
import { and, eq, isNull, sql } from "@snapurl/database";
import {
  domains,
  memberships,
  recoveryCodes,
  users,
  workspaces,
  type Database,
  type Executor,
} from "@snapurl/database";
import type {
  AuthSession,
  AuthUser,
  LoginInput,
  LoginResult,
  RegisterInput,
  TotpSetup,
} from "@snapurl/contract";
import { DB } from "../database/database.module.js";
import { ENV, type Env } from "../config/env.js";
import { TokenService } from "./token.service.js";
import { TotpService } from "./totp.service.js";

/** "Dhananjay Thomble" → "DT". The UI renders these in avatars. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

const ARGON_OPTIONS = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 };

/** Verifying this costs the same as verifying a real hash, which is the point.
 *  Returning early for an unknown email leaks which addresses have accounts. */
const DUMMY_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$c25hcHVybC1kdW1teS1zYWx0$4Xk1Yh0lPQKRZ0T0lLQKzXKXCVLuQ0dCMuoJXqLYQmY";

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly tokens: TokenService,
    private readonly totp: TotpService,
  ) {}

  async register(input: RegisterInput, userAgent?: string): Promise<AuthSession> {
    const email = input.email.toLowerCase().trim();

    const [existing] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = ${email}`)
      .limit(1);
    if (existing) {
      throw new ConflictException("An account with that email already exists. Try signing in instead.");
    }

    const passwordHash = await argon2.hash(input.password, ARGON_OPTIONS);

    /* One workspace per user at registration.

       The contract has workspaces/current (singular) and the UI has no
       workspace switcher, so this is what the frontend expects. The schema is
       many-to-many, so supporting more later is a UI change, not a migration. */
    const { user, workspace, role } = await this.db.transaction(async (tx) => {
      const [user] = await tx
        .insert(users)
        .values({ name: input.name.trim(), email, passwordHash })
        .returning();

      const baseSlug = slugify(input.name) || "workspace";
      const [workspace] = await tx
        .insert(workspaces)
        .values({
          name: `${input.name.trim()}'s workspace`,
          slug: await uniqueWorkspaceSlug(tx, baseSlug),
          defaultRedirect: "302",
        })
        .returning();

      /* The shared short domain is a system domain owned by nobody, so every
         workspace points at the same row rather than trying to claim it.
         The first registration creates it; the rest find it. */
      await tx
        .insert(domains)
        .values({
          workspaceId: null,
          domain: this.env.DEFAULT_DOMAIN,
          isSystem: true,
          status: "live",
          ssl: "active",
          verifiedAt: new Date(),
        })
        .onConflictDoNothing();

      const [systemDomain] = await tx
        .select({ id: domains.id })
        .from(domains)
        .where(sql`lower(${domains.domain}) = ${this.env.DEFAULT_DOMAIN.toLowerCase()}`)
        .limit(1);

      if (systemDomain) {
        await tx.update(workspaces).set({ defaultDomainId: systemDomain.id }).where(eq(workspaces.id, workspace!.id));
      }

      await tx.insert(memberships).values({
        workspaceId: workspace!.id,
        userId: user!.id,
        email,
        role: "owner",
        status: "active",
        acceptedAt: new Date(),
      });

      return { user: user!, workspace: workspace!, role: "owner" as const };
    });

    return this.issueSession(user, workspace.id, role, userAgent);
  }

  async login(input: LoginInput, userAgent?: string): Promise<LoginResult> {
    const email = input.email.toLowerCase().trim();
    const [user] = await this.db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${email}`)
      .limit(1);

    // Always do the work, even for an unknown address, so response time does
    // not tell an attacker which emails have accounts.
    const ok = user
      ? await argon2.verify(user.passwordHash, input.password).catch(() => false)
      : await argon2.verify(DUMMY_HASH, input.password).catch(() => false);

    if (!user || !ok) {
      throw new UnauthorizedException("That email and password don't match.");
    }

    /* G6 — with 2FA on, login returns a challenge rather than a session.
       Without it, the response shape is exactly what it was before, so the
       existing frontend keeps working untouched. */
    if (user.totpEnabledAt && user.totpSecret) {
      return { challenge: "totp" as const, challengeToken: await this.tokens.signChallengeToken(user.id) };
    }

    const membership = await this.primaryMembership(user.id);
    return this.issueSession(user, membership.workspaceId, membership.role, userAgent);
  }

  async verifyTotp(challengeToken: string, code: string, userAgent?: string): Promise<AuthSession> {
    const userId = await this.tokens.verifyChallengeToken(challengeToken);
    const [user] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user?.totpSecret) throw new UnauthorizedException("Two-factor authentication isn't set up.");

    let accepted = this.totp.verify(code, user.totpSecret);

    // Fall back to recovery codes, which are single-use.
    if (!accepted) {
      const unused = await this.db
        .select()
        .from(recoveryCodes)
        .where(and(eq(recoveryCodes.userId, userId), isNull(recoveryCodes.usedAt)));

      for (const candidate of unused) {
        if (await this.totp.verifyRecoveryCode(candidate.codeHash, code)) {
          await this.db
            .update(recoveryCodes)
            .set({ usedAt: new Date() })
            .where(eq(recoveryCodes.id, candidate.id));
          accepted = true;
          break;
        }
      }
    }

    if (!accepted) throw new UnauthorizedException("That code isn't right. Try the next one from your app.");

    const membership = await this.primaryMembership(user.id);
    return this.issueSession(user, membership.workspaceId, membership.role, userAgent);
  }

  async setupTotp(userId: string): Promise<TotpSetup> {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw new UnauthorizedException();
    if (user.totpEnabledAt) {
      throw new BadRequestException("Two-factor authentication is already on. Turn it off first to re-enrol.");
    }

    // Stored but not enabled — until a code is verified, nothing has changed.
    const secret = this.totp.generateSecret();
    await this.db.update(users).set({ totpSecret: secret }).where(eq(users.id, userId));

    return { otpauthUri: this.totp.otpauthUri(user.email, secret), secret };
  }

  async enableTotp(userId: string, code: string): Promise<{ recoveryCodes: string[] }> {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user?.totpSecret) throw new BadRequestException("Start by scanning the QR code.");
    if (!this.totp.verify(code, user.totpSecret)) {
      throw new BadRequestException("That code isn't right. Check your app and try the current code.");
    }

    const codes = this.totp.generateRecoveryCodes();
    const hashes = await Promise.all(codes.map((c) => this.totp.hashRecoveryCode(c)));

    await this.db.transaction(async (tx) => {
      await tx.update(users).set({ totpEnabledAt: new Date() }).where(eq(users.id, userId));
      await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
      await tx.insert(recoveryCodes).values(hashes.map((codeHash) => ({ userId, codeHash })));
    });

    // Shown once. There is deliberately no endpoint to read them back.
    return { recoveryCodes: codes };
  }

  async disableTotp(userId: string, password: string): Promise<void> {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw new UnauthorizedException();
    if (!(await argon2.verify(user.passwordHash, password).catch(() => false))) {
      throw new UnauthorizedException("That password isn't right.");
    }

    await this.db.transaction(async (tx) => {
      await tx.update(users).set({ totpSecret: null, totpEnabledAt: null }).where(eq(users.id, userId));
      await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
    });
  }

  async refresh(refreshToken: string, userAgent?: string) {
    const { userId, refreshToken: next } = await this.tokens.rotate(refreshToken, userAgent);
    const [user] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw new UnauthorizedException();

    // Rebuild claims from current data so a role change lands on next refresh.
    const membership = await this.primaryMembership(userId);
    const accessToken = await this.tokens.signAccessToken({
      sub: user.id,
      wid: membership.workspaceId,
      role: membership.role,
      email: user.email,
    });
    return { accessToken, refreshToken: next };
  }

  async logout(refreshToken: string, allDevices: boolean): Promise<void> {
    if (allDevices) {
      const userId = await this.userIdForRefreshToken(refreshToken);
      if (userId) await this.tokens.revokeAllForUser(userId);
      return;
    }
    await this.tokens.revokeByToken(refreshToken);
  }

  async me(userId: string): Promise<AuthUser> {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw new UnauthorizedException();
    const membership = await this.primaryMembership(userId);

    // Cheap presence signal for the team page's "last active" column.
    await this.db.update(users).set({ lastActiveAt: new Date() }).where(eq(users.id, userId));

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      initials: initialsOf(user.name),
      role: membership.role as AuthUser["role"],
    };
  }

  private async userIdForRefreshToken(token: string): Promise<string | null> {
    try {
      const { userId } = await this.tokens.rotate(token);
      return userId;
    } catch {
      return null;
    }
  }

  private async primaryMembership(userId: string) {
    const [membership] = await this.db
      .select({ workspaceId: memberships.workspaceId, role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.userId, userId), eq(memberships.status, "active")))
      .limit(1);
    if (!membership) throw new UnauthorizedException("Your account isn't attached to a workspace.");
    return membership;
  }

  private async issueSession(
    user: { id: string; name: string; email: string },
    workspaceId: string,
    role: string,
    userAgent?: string,
  ): Promise<AuthSession> {
    const accessToken = await this.tokens.signAccessToken({
      sub: user.id,
      wid: workspaceId,
      role,
      email: user.email,
    });
    const refreshToken = await this.tokens.issueRefreshToken(user.id, undefined, userAgent);
    return {
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        initials: initialsOf(user.name),
        role: role as AuthUser["role"],
      },
    };
  }
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

async function uniqueWorkspaceSlug(tx: Executor, base: string): Promise<string> {
  for (let i = 0; i < 20; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const [taken] = await tx
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.slug, candidate))
      .limit(1);
    if (!taken) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}

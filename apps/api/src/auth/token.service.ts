import { Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { and, eq, isNull, refreshTokens, type Database } from "@snapurl/database";
import { DB } from "../database/database.module.js";
import { ENV, type Env } from "../config/env.js";

export interface AccessTokenClaims {
  sub: string;
  wid: string;
  role: string;
  email: string;
}

/* ============================================================
   Refresh token rotation with reuse detection.

   Every refresh issues a new token and marks the old one
   replaced. A token that has already been replaced can only be
   presented by someone who kept a copy — so instead of refusing
   just that token, the whole family is revoked and every session
   descended from that login is dead.

   The cost is that a genuine race (two tabs refreshing at once)
   logs the user out. That is the right trade: the alternative is
   that a stolen refresh token keeps working alongside the real
   one, indefinitely, with nothing to detect it.
   ============================================================ */

@Injectable()
export class TokenService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly jwt: JwtService,
  ) {}

  /** Stored hashed: a leaked database should not hand over live sessions. */
  private hash(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  async signAccessToken(claims: AccessTokenClaims): Promise<string> {
    return this.jwt.signAsync(claims, {
      secret: this.env.JWT_ACCESS_SECRET,
      // @nestjs/jwt types expiresIn against ms's StringValue union, which a
      // config string cannot satisfy statically. The value is validated by
      // EnvSchema and by jsonwebtoken at sign time.
      expiresIn: this.env.JWT_ACCESS_TTL as unknown as number,
    });
  }

  async verifyAccessToken(token: string): Promise<AccessTokenClaims> {
    try {
      return await this.jwt.verifyAsync<AccessTokenClaims>(token, {
        secret: this.env.JWT_ACCESS_SECRET,
      });
    } catch {
      throw new UnauthorizedException("Your session has expired. Sign in again to continue.");
    }
  }

  async issueRefreshToken(userId: string, familyId: string = randomUUID(), userAgent?: string): Promise<string> {
    const token = randomBytes(48).toString("base64url");
    const expiresAt = new Date(Date.now() + this.env.JWT_REFRESH_TTL_DAYS * 86_400_000);

    await this.db.insert(refreshTokens).values({
      userId,
      familyId,
      tokenHash: this.hash(token),
      expiresAt,
      userAgent: userAgent ?? null,
    });

    return token;
  }

  /**
   * Exchange a refresh token for a new pair.
   *
   * Returns the userId so the caller can rebuild the claims from current data —
   * a role change should take effect on the next refresh, not on the next login.
   */
  async rotate(token: string, userAgent?: string): Promise<{ userId: string; refreshToken: string }> {
    const tokenHash = this.hash(token);
    const [row] = await this.db.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, tokenHash)).limit(1);

    if (!row) throw new UnauthorizedException("That session is no longer valid. Sign in again.");

    /* A replayed token means someone kept a copy, so the whole family dies.
       An already-revoked token usually means that already happened — telling
       the two apart keeps the message honest for the person who did nothing
       wrong and just had their session revoked out from under them. */
    if (row.replacedById) {
      await this.revokeFamily(row.familyId);
      throw new UnauthorizedException(
        "That session was already used, so we've signed out every device for safety. Sign in again.",
      );
    }
    if (row.revokedAt) {
      throw new UnauthorizedException("That session was signed out. Sign in again.");
    }
    if (row.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException("That session has expired. Sign in again.");
    }

    const next = await this.issueRefreshToken(row.userId, row.familyId, userAgent);
    const [replacement] = await this.db
      .select({ id: refreshTokens.id })
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, this.hash(next)))
      .limit(1);

    await this.db
      .update(refreshTokens)
      .set({ replacedById: replacement?.id ?? null, revokedAt: new Date() })
      .where(eq(refreshTokens.id, row.id));

    return { userId: row.userId, refreshToken: next };
  }

  /* G2 — logout used to be client-side only, so the refresh token stayed valid
     for its full 30-day life after the user signed out. */
  async revokeByToken(token: string): Promise<void> {
    const [row] = await this.db
      .select({ familyId: refreshTokens.familyId })
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, this.hash(token)))
      .limit(1);
    if (row) await this.revokeFamily(row.familyId);
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
  }

  /** "Sign out everywhere" — and what we do when a password changes. */
  async revokeAllForUser(userId: string): Promise<void> {
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
  }

  /* G6 — the short-lived token that carries a login across the 2FA prompt.
     Two minutes: long enough to read a code off a phone, short enough that a
     half-finished login is not a standing credential. */
  async signChallengeToken(userId: string): Promise<string> {
    return this.jwt.signAsync(
      { sub: userId, purpose: "totp" },
      { secret: this.env.JWT_ACCESS_SECRET, expiresIn: "2m" },
    );
  }

  async verifyChallengeToken(token: string): Promise<string> {
    try {
      const claims = await this.jwt.verifyAsync<{ sub: string; purpose: string }>(token, {
        secret: this.env.JWT_ACCESS_SECRET,
      });
      if (claims.purpose !== "totp") throw new Error("wrong purpose");
      return claims.sub;
    } catch {
      throw new UnauthorizedException("That sign-in attempt timed out. Start again.");
    }
  }

  /* G3 — the unlock token for password-protected links.

     Bound to one link id so it cannot be replayed against another link, and
     five minutes because it travels in a query string and therefore lands in
     browser history. */
  async signUnlockToken(linkId: string): Promise<string> {
    return this.jwt.signAsync(
      { sub: linkId, purpose: "unlock" },
      { secret: this.env.JWT_ACCESS_SECRET, expiresIn: "5m" },
    );
  }
}

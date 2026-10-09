import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import * as argon2 from "argon2";
import { and, asc, eq, isNull, sql } from "@snapurl/database";
import {
  auditLog,
  domains,
  memberships,
  oauthIdentities,
  recoveryCodes,
  users,
  workspaces,
  type Database,
  type Executor,
} from "@snapurl/database";
import type {
  AcceptedInvite,
  AuthSession,
  AuthUser,
  LoginInput,
  LoginResult,
  InviteErrorCode,
  RegisterInput,
  TotpSetup,
  UserWorkspace,
} from "@snapurl/contract";
import { DB } from "../database/database.module.js";
import { ENV, type Env } from "../config/env.js";
import { TokenService } from "./token.service.js";
import { TotpService } from "./totp.service.js";
import { OAuthService, type OAuthProvider } from "./oauth.service.js";
import { MailService } from "../mail/mail.service.js";

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
/** The invitation email says "The link expires in 7 days" (MailService.sendInvite). */
export const INVITE_TTL_MS = 7 * 86_400_000;

/** A refusal from acceptInvite. The body carries a stable `code` alongside the
 *  human message so the /invite page can branch without parsing prose. */
function inviteError(
  Exc: typeof NotFoundException | typeof GoneException | typeof ConflictException | typeof ForbiddenException,
  code: InviteErrorCode,
  message: string,
) {
  return new Exc({ message, code });
}

const DUMMY_HASH =
  "$argon2id$v=19$m=19456,t=2,p=1$c25hcHVybC1kdW1teS1zYWx0$4Xk1Yh0lPQKRZ0T0lLQKzXKXCVLuQ0dCMuoJXqLYQmY";

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly tokens: TokenService,
    private readonly totp: TotpService,
    private readonly oauth: OAuthService,
    private readonly mail: MailService,
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

      const workspace = await this.provisionWorkspace(tx, user!.id, input.name, email);
      return { user: user!, workspace, role: "owner" as const };
    });

    /* Send the verification email, but never let a mail hiccup fail signup —
       the account exists and the user can re-request from the app. */
    try {
      const token = await this.tokens.issueEmailVerificationToken(user.id);
      await this.mail.sendEmailVerification({ to: user.email, token });
    } catch {
      // best-effort; resend endpoint covers the failure path.
    }

    return this.issueSession(user, workspace.id, role, userAgent);
  }

  /* P0 — email verification.

     verifyEmail consumes a single-use token and stamps email_verified_at.
     Idempotent-ish: a second use of the same token fails (single-use), which
     is the honest behaviour — the address is already verified by then.

     resendEmailVerification mirrors password-reset's anti-enumeration: the
     same response whether or not the email exists or is already verified, and
     work happens only for an existing, still-unverified account. */
  async verifyEmail(token: string): Promise<void> {
    const userId = await this.tokens.consumeEmailVerificationToken(token);
    await this.db
      .update(users)
      .set({ emailVerifiedAt: new Date(), updatedAt: new Date() })
      .where(eq(users.id, userId));
  }

  async resendEmailVerification(email: string): Promise<void> {
    const normalized = email.toLowerCase().trim();
    const [user] = await this.db
      .select({ id: users.id, email: users.email, emailVerifiedAt: users.emailVerifiedAt })
      .from(users)
      .where(sql`lower(${users.email}) = ${normalized}`)
      .limit(1);

    if (!user || user.emailVerifiedAt) return;

    const token = await this.tokens.issueEmailVerificationToken(user.id);
    await this.mail.sendEmailVerification({ to: user.email, token });
  }

  /**
   * Everything a brand new account needs besides the user row.
   *
   * Shared by password registration and first-time OAuth sign-in so the two
   * cannot drift into producing differently-shaped accounts — the kind of
   * difference that surfaces months later as "domains work for people who
   * signed up with email".
   */
  private async provisionWorkspace(tx: Executor, userId: string, displayName: string, email: string) {
    const baseSlug = slugify(displayName) || "workspace";
    const workspace = await insertWorkspaceWithUniqueSlug(tx, baseSlug, `${displayName.trim()}'s workspace`);

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
      await tx.update(workspaces).set({ defaultDomainId: systemDomain.id }).where(eq(workspaces.id, workspace.id));
    }

    await tx.insert(memberships).values({
      workspaceId: workspace.id,
      userId,
      email,
      role: "owner",
      status: "active",
      acceptedAt: new Date(),
    });

    return workspace;
  }

  /**
   * Sign in with an ID token from Google or Apple.
   *
   * Three cases, in the order they are checked, and the order is the security
   * argument:
   *
   * 1. **The identity is already linked** — (provider, subject) matches a row.
   *    Sign that user in. Email is never consulted, so a provider-side address
   *    change cannot move the account.
   * 2. **The email matches an existing account** — link, but only if the
   *    provider asserts the address is verified. An unverified assertion is
   *    someone typing an address into a form, and honouring it would let
   *    anyone who can create an account at a sloppy provider claim any
   *    SnapURL account by email. Refused rather than silently creating a
   *    duplicate account, which would be confusing in a different way.
   * 3. **Nobody has that email** — create the account with no password and
   *    provision it exactly as registration does.
   *
   * Two-factor still applies. A user who turned TOTP on did so for this
   * account; the provider having its own second factor is not something we can
   * verify, and skipping ours would mean a compromised Google account walks
   * straight past a control the person deliberately added.
   */
  async oauthSignIn(
    provider: OAuthProvider,
    idToken: string,
    nonce: string,
    userAgent?: string,
  ): Promise<LoginResult> {
    const profile = await this.oauth.verify(provider, idToken, nonce);

    const [linked] = await this.db
      .select({ userId: oauthIdentities.userId })
      .from(oauthIdentities)
      .where(and(eq(oauthIdentities.provider, provider), eq(oauthIdentities.subject, profile.subject)))
      .limit(1);

    let userId = linked?.userId ?? null;

    if (!userId) {
      const [existing] = await this.db
        .select({ id: users.id })
        .from(users)
        .where(sql`lower(${users.email}) = ${profile.email}`)
        .limit(1);

      if (existing) {
        if (!profile.emailVerified) {
          throw new UnauthorizedException(
            "That provider has not verified this email address, so it cannot be linked to an existing account. Sign in with your password instead.",
          );
        }
        await this.db
          .insert(oauthIdentities)
          .values({ userId: existing.id, provider, subject: profile.subject, email: profile.email });
        userId = existing.id;
      } else {
        // Apple sends a name only on the very first authorisation, and may
        // send none at all, so the local-part is the fallback rather than an
        // empty string that would render as a blank account everywhere.
        const displayName = profile.name ?? profile.email.split("@")[0] ?? "there";
        userId = await this.db.transaction(async (tx) => {
          const [user] = await tx
            .insert(users)
            .values({
              name: displayName,
              email: profile.email,
              passwordHash: null,
              // The provider checked it; recording that avoids asking again.
              emailVerifiedAt: profile.emailVerified ? new Date() : null,
            })
            .returning();
          await tx
            .insert(oauthIdentities)
            .values({ userId: user!.id, provider, subject: profile.subject, email: profile.email });
          await this.provisionWorkspace(tx, user!.id, displayName, profile.email);
          return user!.id;
        });
      }
    }

    const [user] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw new UnauthorizedException();

    if (user.totpEnabledAt && user.totpSecret) {
      return { challenge: "totp" as const, challengeToken: await this.tokens.signChallengeToken(user.id) };
    }

    const membership = await this.primaryMembership(user.id);
    return this.issueSession(user, membership.workspaceId, membership.role, userAgent);
  }

  async login(input: LoginInput, userAgent?: string): Promise<LoginResult> {
    const email = input.email.toLowerCase().trim();
    const [user] = await this.db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${email}`)
      .limit(1);

    /* A user with no password hash signs in through a provider and cannot
       authenticate here at all. argon2.verify would throw on null and the
       catch below would turn that into `false`, which is the right answer by
       accident — this makes it the right answer on purpose, and keeps the
       dummy-hash timing for that case too.

       The error stays the generic one. Saying "this account uses Google"
       would be friendlier and would also confirm to an attacker that the
       address is registered, which is the property the DUMMY_HASH comparison
       below exists to protect. */
    const hash = user?.passwordHash ?? null;

    // Always do the work, even for an unknown address, so response time does
    // not tell an attacker which emails have accounts.
    const ok = hash
      ? await argon2.verify(hash, input.password).catch(() => false)
      : await argon2.verify(DUMMY_HASH, input.password).catch(() => false);

    if (!user || !hash || !ok) {
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
    /* Turning 2FA off is a step down in security, so it is gated on proving
       the first factor. An account that signs in through a provider has no
       password to prove, and accepting one anyway — or letting argon2 throw
       its way to a rejection — are both worse than saying so. Naming the
       situation is safe here: the caller is already authenticated as this
       user, so there is nothing left to enumerate. */
    if (!user.passwordHash) {
      throw new UnauthorizedException(
        "This account signs in with a provider and has no password, so two-factor authentication can't be turned off this way.",
      );
    }
    if (!(await argon2.verify(user.passwordHash, password).catch(() => false))) {
      throw new UnauthorizedException("That password isn't right.");
    }

    await this.db.transaction(async (tx) => {
      await tx.update(users).set({ totpSecret: null, totpEnabledAt: null }).where(eq(users.id, userId));
      await tx.delete(recoveryCodes).where(eq(recoveryCodes.userId, userId));
    });
  }

  async refresh(refreshToken: string, userAgent?: string, workspaceId?: string) {
    const { userId, refreshToken: next } = await this.tokens.rotate(refreshToken, userAgent);
    const [user] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw new UnauthorizedException();

    /* Rebuild claims from current data so a role change lands on next refresh.
       The workspace hint (#668) keeps a multi-workspace user where they are;
       it is honoured only while that membership is still active, so a removal
       or role change is picked up here too. */
    const membership =
      (workspaceId ? await this.activeMembership(userId, workspaceId) : null) ??
      (await this.primaryMembership(userId));
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

  /* P0 — password reset, request step.

     Returns void regardless of outcome: the caller gets the same 202 whether
     or not the email has an account, so this endpoint cannot be used to learn
     which addresses are registered. We only do work — mint a token, send mail —
     when the user exists AND has a password (an OAuth-only user has no password
     to reset; sending them a reset link would be a dead end). */
  async requestPasswordReset(email: string): Promise<void> {
    const normalized = email.toLowerCase().trim();
    const [user] = await this.db
      .select({ id: users.id, passwordHash: users.passwordHash, email: users.email })
      .from(users)
      .where(sql`lower(${users.email}) = ${normalized}`)
      .limit(1);

    if (!user || !user.passwordHash) return;

    const token = await this.tokens.issuePasswordResetToken(user.id);
    await this.mail.sendPasswordReset({ to: user.email, token });
  }

  /* P0 — password reset, confirm step.

     Consuming the token is atomic and single-use (TokenService guards on
     usedAt IS NULL + not expired). A successful reset also revokes every
     refresh-token family for the user: a password change is implicitly a
     "sign out everywhere", so a session opened with the old credentials — or
     by whoever prompted the reset — does not survive it. */
  async confirmPasswordReset(token: string, newPassword: string): Promise<void> {
    const userId = await this.tokens.consumePasswordResetToken(token);
    const passwordHash = await argon2.hash(newPassword, ARGON_OPTIONS);
    await this.db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, userId));
    await this.tokens.revokeAllForUser(userId);
  }

  async me(userId: string, workspaceId?: string, tokenRole?: string): Promise<AuthUser> {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw new UnauthorizedException();
    // The role shown (and used to gate the UI) is the role in the workspace this
    // session is in, not in whichever workspace happens to be the default.
    let membership: { workspaceId: string; role: string };
    if (workspaceId) {
      const current = await this.activeMembership(userId, workspaceId);
      /* #699 — the guard trusts the token's claims until it expires. If the
         membership behind them is gone, or the role changed, answering with a
         different workspace's role would hide that. 401 instead: the client
         refreshes, and refresh rebuilds the claims from current data. */
      if (!current || (tokenRole !== undefined && current.role !== tokenRole)) {
        throw new UnauthorizedException("Your access to this workspace has changed.");
      }
      membership = current;
    } else {
      membership = await this.primaryMembership(userId);
    }

    // Cheap presence signals for the team page's "last active" column: the
    // account-wide one, and (#699) the one for this workspace, which is what
    // teammates are shown.
    const now = new Date();
    await this.db.update(users).set({ lastActiveAt: now }).where(eq(users.id, userId));
    await this.db
      .update(memberships)
      .set({ lastActiveAt: now })
      .where(
        and(
          eq(memberships.userId, userId),
          eq(memberships.workspaceId, membership.workspaceId),
          eq(memberships.status, "active"),
        ),
      );

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

  /* The workspace a fresh sign-in lands in.

     Before #668 nobody could have two active memberships, so `.limit(1)` with
     no ORDER BY was harmless. Accepting an invitation makes it reachable, and
     an unordered pick could land the same person in a different workspace on
     different sign-ins. The order is the first workspace they actually joined
     (accepted_at), which for everyone is the personal workspace created at
     registration; the switcher (POST /auth/refresh with a workspaceId) reaches the others. */
  private async primaryMembership(userId: string) {
    const [membership] = await this.db
      .select({ workspaceId: memberships.workspaceId, role: memberships.role })
      .from(memberships)
      .where(and(eq(memberships.userId, userId), eq(memberships.status, "active")))
      .orderBy(sql`${memberships.acceptedAt} asc nulls last`, asc(memberships.createdAt), asc(memberships.id))
      .limit(1);
    if (!membership) throw new UnauthorizedException("Your account isn't attached to a workspace.");
    return membership;
  }

  private async activeMembership(userId: string, workspaceId: string) {
    const [membership] = await this.db
      .select({ workspaceId: memberships.workspaceId, role: memberships.role })
      .from(memberships)
      .where(
        and(
          eq(memberships.userId, userId),
          eq(memberships.workspaceId, workspaceId),
          eq(memberships.status, "active"),
        ),
      )
      .limit(1);
    return membership ?? null;
  }

  /* ── #668: team invitations ──────────────────────────────────────────────

     Accepting is a session-only action (the route has no @Scope, so the guard
     refuses API keys) and is keyed on the secret token alone — the endpoint
     never takes an email, so it cannot be used to learn whether an address has
     been invited. Checks, in order, each with its own status + code:

       1. a membership row whose invite_token_hash matches   else 404 invite_invalid
       2. still `invited`                                    else 409 invite_used
       3. within 7 days of invited_at                        else 410 invite_expired
       4. caller's email == invited email (case-insensitive) else 403 invite_email_mismatch
       5. caller's email is verified                         else 403 email_unverified
       6. caller not already active in that workspace        else 409 already_member

     Everything after (1) is only reachable by someone holding a valid token,
     i.e. someone the invitation was delivered to (or forwarded to).

     Single use: the activating UPDATE is guarded on status = 'invited' AND the
     same hash, so of two concurrent accepts exactly one changes a row; the
     other gets invite_used. The hash is kept on the row rather than nulled so
     a re-presented token can say "already accepted" instead of "not valid" —
     the status, not the hash, is what makes it unusable, and only hashes are
     ever stored.

     Email verification (5): the token proves control of the invited inbox,
     but the *account* presenting it must also have proven its address. That
     stops someone who registered an unverified account under another person's
     email from turning a leaked or forwarded invite link into membership. */
  async acceptInvite(userId: string, rawToken: string): Promise<AcceptedInvite> {
    const tokenHash = createHash("sha256").update(rawToken).digest("hex");

    const [invite] = await this.db
      .select()
      .from(memberships)
      .where(eq(memberships.inviteTokenHash, tokenHash))
      .limit(1);

    /* The lookup is by SHA-256 of the token, which an attacker cannot steer
       byte by byte, so the probe leaks nothing useful. The constant-time
       comparison is still the authoritative check, so correctness never rests
       on how Postgres compares text. */
    if (!invite?.inviteTokenHash || !constantTimeHexEqual(invite.inviteTokenHash, tokenHash)) {
      throw inviteError(
        NotFoundException,
        "invite_invalid",
        "This invitation link isn't valid. Ask the person who invited you to send a new one.",
      );
    }

    if (invite.status !== "invited") {
      throw inviteError(ConflictException, "invite_used", "This invitation has already been accepted.");
    }

    const invitedAt = invite.invitedAt ?? invite.createdAt;
    if (Date.now() - invitedAt.getTime() > INVITE_TTL_MS) {
      throw inviteError(
        GoneException,
        "invite_expired",
        "This invitation has expired. Ask the person who invited you to send a new one.",
      );
    }

    const [user] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw new UnauthorizedException();

    // Neither address is named: the message goes to whoever is signed in, who
    // is not necessarily the person the invitation was for.
    const sameEmail = user.email.toLowerCase().trim() === invite.email.toLowerCase().trim();
    if (!sameEmail || (invite.userId !== null && invite.userId !== user.id)) {
      throw inviteError(
        ForbiddenException,
        "invite_email_mismatch",
        "This invitation was sent to a different email address. Sign in with the address it was sent to.",
      );
    }

    if (!user.emailVerifiedAt) {
      throw inviteError(
        ForbiddenException,
        "email_unverified",
        "Verify your email address first, then open the invitation link again.",
      );
    }

    if (await this.activeMembership(user.id, invite.workspaceId)) {
      throw inviteError(ConflictException, "already_member", "You're already a member of this workspace.");
    }

    /* #699 — activation and its audit row commit together: if the audit insert
       failed after a committed activation, the person would already be a
       member but be told the accept failed. */
    const accepted = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(memberships)
        .set({ status: "active", userId: user.id, acceptedAt: new Date() })
        .where(
          and(
            eq(memberships.id, invite.id),
            eq(memberships.status, "invited"),
            eq(memberships.inviteTokenHash, tokenHash),
          ),
        )
        .returning({ workspaceId: memberships.workspaceId, role: memberships.role });

      if (!row) {
        /* The guarded UPDATE matched nothing, so the row changed since it was
           read. Say what actually happened: a concurrent accept leaves it
           active ("already accepted"); an admin revoking the invitation in the
           meantime deletes it, which is the same as a link that isn't valid. */
        const [now] = await tx
          .select({ status: memberships.status, inviteTokenHash: memberships.inviteTokenHash })
          .from(memberships)
          .where(eq(memberships.id, invite.id))
          .limit(1);
        if (now && now.status !== "invited" && now.inviteTokenHash === tokenHash) {
          throw inviteError(ConflictException, "invite_used", "This invitation has already been accepted.");
        }
        throw inviteError(
          NotFoundException,
          "invite_invalid",
          "This invitation link isn't valid. Ask the person who invited you to send a new one.",
        );
      }

      await tx.insert(auditLog).values({
        workspaceId: row.workspaceId,
        actorId: user.id,
        actorLabel: user.email,
        action: "member.joined",
        targetType: "membership",
        targetId: invite.id,
        metadata: { email: user.email, role: row.role },
      });
      return row;
    });

    /* #699 — no access token here. Accepting is authorised by an access token,
       and minting a new one from it would extend a session that may already
       have been revoked. The client enters the workspace with
       POST /auth/refresh {refreshToken, workspaceId}, which checks the
       refresh-token family. */
    return {
      workspaceId: accepted.workspaceId,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        initials: initialsOf(user.name),
        role: accepted.role as AuthUser["role"],
      },
    };
  }

  async listWorkspaces(userId: string, currentWorkspaceId: string): Promise<UserWorkspace[]> {
    const rows = await this.db
      .select({ id: workspaces.id, name: workspaces.name, role: memberships.role })
      .from(memberships)
      .innerJoin(workspaces, eq(memberships.workspaceId, workspaces.id))
      .where(and(eq(memberships.userId, userId), eq(memberships.status, "active")))
      .orderBy(sql`${memberships.acceptedAt} asc nulls last`, asc(memberships.createdAt), asc(memberships.id));
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      initials: initialsOf(row.name),
      role: row.role as UserWorkspace["role"],
      current: row.id === currentWorkspaceId,
    }));
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

function constantTimeHexEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "hex");
  const right = Buffer.from(b, "hex");
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/**
 * Inserts a new workspace whose slug is unique, making the INSERT itself the
 * authority rather than a prior SELECT.
 *
 * The previous version picked a candidate with a SELECT ... WHERE slug = ...
 * and only then inserted it. That is check-then-act: two concurrent
 * registrations with the same display name can both see `base` (or
 * `base-2`, `base-3`, ...) as free and both attempt it, and one loses on
 * `workspaces_slug_key` — a raw 23505 that `PostgresErrorFilter` turns into
 * an unhelpful "That already exists." 409, failing the signup outright.
 *
 * This version never SELECTs first. Every attempt is an INSERT ...
 * ON CONFLICT (slug) DO NOTHING RETURNING *, so a lost race simply returns no
 * row instead of throwing, and the loop retries with a fresh candidate. The
 * readable base / base-2 / base-3 ladder is kept for the first 20 attempts —
 * that is cosmetic, not a correctness mechanism, since ON CONFLICT makes each
 * attempt safe regardless of whether the candidate happens to collide.
 *
 * Past the ladder, the fallback adds real randomness (`randomBytes`) instead
 * of relying on `Date.now()` alone: millisecond-precision timestamps collide
 * whenever two registrations for the same base land in the same millisecond,
 * which is exactly the regime a busy shared name (e.g. a common company name)
 * puts you in. Random suffixes plus the retry loop make a second collision on
 * the fallback vanishingly unlikely, and even that residual case just retries.
 */
async function insertWorkspaceWithUniqueSlug(
  tx: Executor,
  base: string,
  name: string,
): Promise<typeof workspaces.$inferSelect> {
  const MAX_ATTEMPTS = 30;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const candidate =
      attempt === 0
        ? base
        : attempt < 20
          ? `${base}-${attempt + 1}`
          : `${base}-${randomBytes(6).toString("hex")}`;

    const [workspace] = await tx
      .insert(workspaces)
      .values({ name, slug: candidate, defaultRedirect: "302" })
      .onConflictDoNothing({ target: workspaces.slug })
      .returning();

    if (workspace) return workspace;
    // Lost the race (or the ladder candidate was already taken) — loop and
    // try the next candidate. No 23505 ever reaches the caller from here.
  }
  // Astronomically unlikely with 6 random bytes per attempt over 30 tries,
  // but fail loudly rather than silently returning an unpersisted workspace.
  throw new Error(`Could not allocate a unique workspace slug for base "${base}" after ${MAX_ATTEMPTS} attempts.`);
}

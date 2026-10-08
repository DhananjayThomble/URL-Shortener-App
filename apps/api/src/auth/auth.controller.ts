import { Body, Controller, Get, HttpCode, Post, Req } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import type { FastifyRequest } from "fastify";
import {
  AcceptInviteInput,
  LoginInput,
  LogoutInput,
  OAuthSignInInput,
  PasswordResetConfirmInput,
  PasswordResetRequestInput,
  EmailVerifyInput,
  EmailVerifyResendInput,
  RefreshInput,
  RegisterInput,
  SwitchWorkspaceInput,
  TotpDisableInput,
  TotpEnableInput,
  TotpVerifyInput,
} from "@snapurl/contract";
import { zodBody } from "../common/zod.pipe.js";
import { AuthService } from "./auth.service.js";
import { Actor, Public, type RequestActor } from "./auth.guard.js";

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post("register")
  register(@Body(zodBody(RegisterInput)) input: RegisterInput, @Req() req: FastifyRequest) {
    return this.auth.register(input, req.headers["user-agent"]);
  }

  /* 5/min per client IP, far tighter than the global 120/min. login hashes
     with argon2id (19 MiB) even on unknown emails — correct anti-enumeration,
     and free CPU burn for an attacker. 5 attempts a minute is generous for a
     person who fat-fingers a password and punishing for a script. Keyed on the
     trustworthy IP (ProxyAwareThrottlerGuard), so a rotating X-Forwarded-For
     cannot reset it. */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post("login")
  @HttpCode(200)
  login(@Body(zodBody(LoginInput)) input: LoginInput, @Req() req: FastifyRequest) {
    return this.auth.login(input, req.headers["user-agent"]);
  }

  /* Public by necessity — this is how someone without a session gets one. The
     ID token is the credential, and OAuthService treats it as hostile until
     every claim checks out. */
  @Public()
  @Post("oauth")
  oauth(@Body(zodBody(OAuthSignInInput)) input: OAuthSignInInput, @Req() req: FastifyRequest) {
    return this.auth.oauthSignIn(input.provider, input.idToken, input.nonce, req.headers["user-agent"]);
  }

  @Public()
  @Post("refresh")
  @HttpCode(200)
  refresh(@Body(zodBody(RefreshInput)) input: RefreshInput, @Req() req: FastifyRequest) {
    return this.auth.refresh(input.refreshToken, req.headers["user-agent"], input.workspaceId);
  }

  /* #668 — accept a team invitation. Session-only: no @Scope, so the guard
     refuses API keys (fail-closed), and an anonymous caller gets 401 — the web
     /invite page sends them to sign in or register first and comes back with
     the token preserved.

     Throttled like the other token-consuming auth routes. The token carries
     256 bits, so guessing is not the threat; the limit is there so the route
     cannot be hammered as a cheap DB probe. 10/min rather than login's 5/min:
     this does no argon2 work, and one person legitimately retries it (verify
     email, come back, accept). Keyed on the trustworthy IP. */
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post("invite/accept")
  @HttpCode(200)
  acceptInvite(@Actor() actor: RequestActor, @Body(zodBody(AcceptInviteInput)) input: AcceptInviteInput) {
    return this.auth.acceptInvite(actor.userId!, input.token);
  }

  /* #668 — the workspace switcher. Access tokens are bound to one workspace,
     so switching means a new access token for the target; the refresh token is
     unchanged and keeps the workspace via RefreshInput.workspaceId. */
  @Get("workspaces")
  workspaces(@Actor() actor: RequestActor) {
    return this.auth.listWorkspaces(actor.userId!, actor.workspaceId);
  }

  @Post("workspace")
  @HttpCode(200)
  switchWorkspace(@Actor() actor: RequestActor, @Body(zodBody(SwitchWorkspaceInput)) input: SwitchWorkspaceInput) {
    return this.auth.switchWorkspace(actor.userId!, input.workspaceId);
  }

  /* G2 — this endpoint did not exist, so signing out left the refresh token
     valid for its full 30-day life. Public because the access token may already
     have expired by the time someone clicks sign out; the refresh token in the
     body is the credential. */
  @Public()
  @Post("logout")
  @HttpCode(204)
  async logout(@Body(zodBody(LogoutInput)) input: LogoutInput) {
    await this.auth.logout(input.refreshToken, input.allDevices);
  }

  /* P0 — password reset. Both public: someone locked out has no session.

     request: always 202, same response for known and unknown emails, so it is
     not an enumeration oracle. Tightly throttled — it sends mail and does an
     argon2-free DB lookup, but a loose limit would let it be used to spam an
     inbox or probe for accounts.
     confirm: 200 on success. Throttled because it runs argon2id on every call. */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post("password-reset/request")
  @HttpCode(202)
  async requestPasswordReset(@Body(zodBody(PasswordResetRequestInput)) input: PasswordResetRequestInput) {
    await this.auth.requestPasswordReset(input.email);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post("password-reset/confirm")
  @HttpCode(200)
  async confirmPasswordReset(@Body(zodBody(PasswordResetConfirmInput)) input: PasswordResetConfirmInput) {
    await this.auth.confirmPasswordReset(input.token, input.password);
  }

  /* P0 — email verification. verify is public (the link is clicked from an
     email, often before signing in). resend is public + throttled and, like
     password-reset request, gives the same response for any email so it can't
     be used to probe which addresses exist or are already verified. */
  @Public()
  @Post("email/verify")
  @HttpCode(200)
  async verifyEmail(@Body(zodBody(EmailVerifyInput)) input: EmailVerifyInput) {
    await this.auth.verifyEmail(input.token);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post("email/resend")
  @HttpCode(202)
  async resendEmailVerification(@Body(zodBody(EmailVerifyResendInput)) input: EmailVerifyResendInput) {
    await this.auth.resendEmailVerification(input.email);
  }

  @Get("me")
  me(@Actor() actor: RequestActor) {
    return this.auth.me(actor.userId!, actor.workspaceId);
  }

  /* G6 — two-factor. The team page renders a 2FA column, so there has to be a
     way for it to become true. */

  @Post("2fa/setup")
  setupTotp(@Actor() actor: RequestActor) {
    return this.auth.setupTotp(actor.userId!);
  }

  @Post("2fa/enable")
  @HttpCode(200)
  enableTotp(@Actor() actor: RequestActor, @Body(zodBody(TotpEnableInput)) input: TotpEnableInput) {
    return this.auth.enableTotp(actor.userId!, input.code);
  }

  /* 5/min per client IP. 2fa/verify loops argon2id over EVERY unused recovery
     code, so it is the most expensive call in this controller — the tight limit
     matters most here. Keyed on the trustworthy IP so it cannot be reset with a
     rotating X-Forwarded-For. */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post("2fa/verify")
  @HttpCode(200)
  verifyTotp(@Body(zodBody(TotpVerifyInput)) input: TotpVerifyInput, @Req() req: FastifyRequest) {
    return this.auth.verifyTotp(input.challengeToken, input.code, req.headers["user-agent"]);
  }

  @Post("2fa/disable")
  @HttpCode(204)
  async disableTotp(@Actor() actor: RequestActor, @Body(zodBody(TotpDisableInput)) input: TotpDisableInput) {
    await this.auth.disableTotp(actor.userId!, input.password);
  }
}

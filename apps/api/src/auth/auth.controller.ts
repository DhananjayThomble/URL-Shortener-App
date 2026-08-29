import { Body, Controller, Get, HttpCode, Post, Req } from "@nestjs/common";
import type { FastifyRequest } from "fastify";
import {
  LoginInput,
  LogoutInput,
  OAuthSignInInput,
  RefreshInput,
  RegisterInput,
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

  @Public()
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
    return this.auth.oauthSignIn(input.provider, input.idToken, req.headers["user-agent"]);
  }

  @Public()
  @Post("refresh")
  @HttpCode(200)
  refresh(@Body(zodBody(RefreshInput)) input: RefreshInput, @Req() req: FastifyRequest) {
    return this.auth.refresh(input.refreshToken, req.headers["user-agent"]);
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

  @Get("me")
  me(@Actor() actor: RequestActor) {
    return this.auth.me(actor.userId!);
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

  @Public()
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

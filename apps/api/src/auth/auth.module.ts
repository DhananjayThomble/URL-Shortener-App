import { Global, Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AuthController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";
import { TokenService } from "./token.service.js";
import { TotpService } from "./totp.service.js";
import { OAuthService } from "./oauth.service.js";
import { BotProtectionService } from "./bot-protection.service.js";
import { SignupRefusalService } from "./signup-refusal.service.js";
import { MailDomainService } from "./mail-domain.service.js";

/* Global because AuthGuard is bound application-wide in app.module and needs
   TokenService wherever it runs. BotProtectionService and SignupRefusalService
   (#993) are exported too: the links service reads the refusal log for the
   new-account caps, and both are reused across the sign-up paths.
   MailDomainService (#1007) is the fail-open MX/A/AAAA sign-up check. */
@Global()
@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    TotpService,
    OAuthService,
    BotProtectionService,
    SignupRefusalService,
    MailDomainService,
  ],
  exports: [
    AuthService,
    TokenService,
    TotpService,
    OAuthService,
    BotProtectionService,
    SignupRefusalService,
    MailDomainService,
  ],
})
export class AuthModule {}

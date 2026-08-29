import { Global, Module } from "@nestjs/common";
import { JwtModule } from "@nestjs/jwt";
import { AuthController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";
import { TokenService } from "./token.service.js";
import { TotpService } from "./totp.service.js";
import { OAuthService } from "./oauth.service.js";

/* Global because AuthGuard is bound application-wide in app.module and needs
   TokenService wherever it runs. */
@Global()
@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, TokenService, TotpService, OAuthService],
  exports: [AuthService, TokenService, TotpService, OAuthService],
})
export class AuthModule {}

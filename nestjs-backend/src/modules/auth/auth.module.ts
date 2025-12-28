import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { LocalStrategy } from './strategies/local.strategy';
// import { ApiKeyStrategy } from './strategies/api-key.strategy';
import { UsersModule } from '../users/users.module';
import { RedisModule } from '../../config/redis.module';
import { EnhancedJwtService } from './services/enhanced-jwt.service';
import { EmailVerificationService } from './services/email-verification.service';
import { PasswordResetService } from './services/password-reset.service';
import { RateLimitingService } from './services/rate-limiting.service';
import { EnhancedRateLimitGuard } from './guards/enhanced-rate-limit.guard';
import { SanitizationPipe } from './pipes/sanitization.pipe';
import { CommonModule } from '../../common/common.module';

@Module({
  imports: [
    UsersModule,
    PassportModule,
    RedisModule,
    CommonModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get('JWT_SECRET'),
        signOptions: {
          expiresIn: configService.get('JWT_EXPIRES_IN', '15m'),
        },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService, 
    LocalStrategy, 
    JwtStrategy, 
    EnhancedJwtService, 
    EmailVerificationService, 
    PasswordResetService,
    RateLimitingService,
    EnhancedRateLimitGuard,
    SanitizationPipe,
  ], // ApiKeyStrategy
  exports: [
    AuthService, 
    EnhancedJwtService, 
    EmailVerificationService, 
    PasswordResetService,
    RateLimitingService,
    EnhancedRateLimitGuard,
    SanitizationPipe,
  ],
})
export class AuthModule {}
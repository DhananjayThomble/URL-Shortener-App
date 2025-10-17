import { ConfigService } from '@nestjs/config';

export interface SecurityConfig {
  bcryptSaltRounds: number;
  jwtSecret: string;
  jwtExpiresIn: string;
  jwtRefreshSecret: string;
  jwtRefreshExpiresIn: string;
  sessionSecret: string;
  corsOrigins: string[];
  rateLimiting: {
    global: { windowMs: number; max: number };
    auth: { windowMs: number; max: number };
    urlCreation: { windowMs: number; max: number };
    urlAccess: { windowMs: number; max: number };
  };
  apiKeys: string[];
}

export const getSecurityConfig = (configService: ConfigService): SecurityConfig => ({
  bcryptSaltRounds: parseInt(configService.get('BCRYPT_SALT_ROUNDS', '12'), 10),
  jwtSecret: configService.get('JWT_SECRET', 'fallback-secret-change-in-production'),
  jwtExpiresIn: configService.get('JWT_EXPIRES_IN', '15m'),
  jwtRefreshSecret: configService.get('JWT_REFRESH_SECRET', 'fallback-refresh-secret'),
  jwtRefreshExpiresIn: configService.get('JWT_REFRESH_EXPIRES_IN', '7d'),
  sessionSecret: configService.get('SESSION_SECRET', 'fallback-session-secret'),
  corsOrigins: configService.get('FRONTEND_URL', 'http://localhost:3001').split(','),
  rateLimiting: {
    global: {
      windowMs: parseInt(configService.get('RATE_LIMIT_GLOBAL_WINDOW', '900000'), 10),
      max: parseInt(configService.get('RATE_LIMIT_GLOBAL_MAX', '1000'), 10),
    },
    auth: {
      windowMs: parseInt(configService.get('RATE_LIMIT_AUTH_WINDOW', '900000'), 10),
      max: parseInt(configService.get('RATE_LIMIT_AUTH_MAX', '5'), 10),
    },
    urlCreation: {
      windowMs: 60000,
      max: 10,
    },
    urlAccess: {
      windowMs: 60000,
      max: 100,
    },
  },
  apiKeys: configService.get('VALID_API_KEYS', '').split(',').filter(Boolean),
});
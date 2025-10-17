import { ConfigService } from '@nestjs/config';
import { ThrottlerModuleOptions } from '@nestjs/throttler';

export const getRateLimitConfig = (configService: ConfigService): ThrottlerModuleOptions => ({
  throttlers: [
    {
      name: 'global',
      ttl: configService.get('RATE_LIMIT_GLOBAL_WINDOW', 900000), // 15 minutes
      limit: configService.get('RATE_LIMIT_GLOBAL_MAX', 1000),
    },
    {
      name: 'auth',
      ttl: configService.get('RATE_LIMIT_AUTH_WINDOW', 900000), // 15 minutes
      limit: configService.get('RATE_LIMIT_AUTH_MAX', 5),
    },
    {
      name: 'url-creation',
      ttl: 60000, // 1 minute
      limit: 10,
    },
    {
      name: 'url-access',
      ttl: 60000, // 1 minute
      limit: 100,
    },
  ],
  storage: {
    // Redis storage will be configured here
    // This requires a custom storage implementation
  },
});

export const rateLimitConfig = {
  global: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // limit each IP to 1000 requests per windowMs
  },
  auth: {
    windowMs: 15 * 60 * 1000,
    max: 5, // limit login attempts
  },
  urlCreation: {
    windowMs: 60 * 1000, // 1 minute
    max: 10, // limit URL creation
  },
  urlAccess: {
    windowMs: 60 * 1000,
    max: 100, // limit URL redirections
  },
};
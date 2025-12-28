import { ConfigService } from '@nestjs/config';

export interface CacheConfig {
  redis: {
    host: string;
    port: number;
    password?: string;
    db: number;
    keyPrefix: string;
    retryDelayOnFailover: number;
    maxRetriesPerRequest: number;
    lazyConnect: boolean;
  };
  ttl: {
    urlResolution: number;
    userSession: number;
    analytics: number;
    metadata: number;
    popularUrls: number;
    default: number;
  };
  strategies: {
    enableCompression: boolean;
    enableCacheWarming: boolean;
    maxKeyLength: number;
    maxValueSize: number;
  };
}

export const getCacheConfig = (configService: ConfigService): CacheConfig => ({
  redis: {
    host: configService.get('REDIS_HOST', 'localhost'),
    port: parseInt(configService.get('REDIS_PORT', '6379'), 10),
    password: configService.get('REDIS_PASSWORD'),
    db: parseInt(configService.get('REDIS_DB', '0'), 10),
    keyPrefix: configService.get('REDIS_KEY_PREFIX', 'urlshortener:'),
    retryDelayOnFailover: 100,
    maxRetriesPerRequest: 3,
    lazyConnect: true,
  },
  ttl: {
    urlResolution: parseInt(configService.get('CACHE_TTL_URL', '3600'), 10), // 1 hour
    userSession: parseInt(configService.get('CACHE_TTL_SESSION', '900'), 10), // 15 minutes
    analytics: parseInt(configService.get('CACHE_TTL_ANALYTICS', '300'), 10), // 5 minutes
    metadata: parseInt(configService.get('CACHE_TTL_METADATA', '86400'), 10), // 24 hours
    popularUrls: parseInt(configService.get('CACHE_TTL_POPULAR', '1800'), 10), // 30 minutes
    default: parseInt(configService.get('CACHE_TTL_DEFAULT', '3600'), 10), // 1 hour
  },
  strategies: {
    enableCompression: configService.get('CACHE_ENABLE_COMPRESSION', 'true') === 'true',
    enableCacheWarming: configService.get('CACHE_ENABLE_WARMING', 'true') === 'true',
    maxKeyLength: parseInt(configService.get('CACHE_MAX_KEY_LENGTH', '250'), 10),
    maxValueSize: parseInt(configService.get('CACHE_MAX_VALUE_SIZE', '1048576'), 10), // 1MB
  },
});
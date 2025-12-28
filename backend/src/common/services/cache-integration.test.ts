// Simple integration test to verify cache service functionality
import { CacheService } from './cache.service';
import { ConfigService } from '@nestjs/config';

describe('Cache Integration Test', () => {
  let cacheService: CacheService;
  let configService: ConfigService;

  beforeAll(() => {
    // Mock ConfigService
    configService = {
      get: jest.fn((key: string, defaultValue?: any) => {
        const config = {
          REDIS_URL: 'redis://localhost:6379',
          REDIS_HOST: 'localhost',
          REDIS_PORT: '6379',
        };
        return config[key] || defaultValue;
      }),
    } as any;

    cacheService = new CacheService(configService);
  });

  it('should have all required cache methods', () => {
    expect(cacheService.get).toBeDefined();
    expect(cacheService.set).toBeDefined();
    expect(cacheService.del).toBeDefined();
    expect(cacheService.exists).toBeDefined();
    expect(cacheService.increment).toBeDefined();
    expect(cacheService.expire).toBeDefined();
    expect(cacheService.getOrSet).toBeDefined();
    expect(cacheService.mget).toBeDefined();
    expect(cacheService.mset).toBeDefined();
    expect(cacheService.invalidatePattern).toBeDefined();
    expect(cacheService.getStats).toBeDefined();
    expect(cacheService.healthCheck).toBeDefined();
  });

  it('should have specialized cache methods', () => {
    expect(cacheService.cacheUrlResolution).toBeDefined();
    expect(cacheService.getCachedUrlResolution).toBeDefined();
    expect(cacheService.invalidateUrlCache).toBeDefined();
    expect(cacheService.cacheUserSession).toBeDefined();
    expect(cacheService.getCachedUserSession).toBeDefined();
    expect(cacheService.invalidateUserSession).toBeDefined();
    expect(cacheService.cacheAnalytics).toBeDefined();
    expect(cacheService.getCachedAnalytics).toBeDefined();
    expect(cacheService.invalidateAnalyticsCache).toBeDefined();
  });

  it('should have cache key generators', () => {
    expect(cacheService.generateUrlCacheKey('test123')).toBe('url:test123');
    expect(cacheService.generateUserCacheKey('user123')).toBe('user:user123');
    expect(cacheService.generateUserSessionKey('user123')).toBe('session:user123');
    expect(cacheService.generateAnalyticsCacheKey('url123', 'daily')).toBe('analytics:url123:daily');
    expect(cacheService.generateRateLimitKey('192.168.1.1', 'create-url')).toBe('ratelimit:create-url:192.168.1.1');
  });

  it('should have cache warming methods', () => {
    expect(cacheService.warmUrlCache).toBeDefined();
  });
});
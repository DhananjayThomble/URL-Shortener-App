import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class CacheService implements OnModuleInit, OnModuleDestroy {
  private redis: Redis;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    const redisUrl = this.configService.get('REDIS_URL');
    
    if (redisUrl) {
      this.redis = new Redis(redisUrl);
    } else {
      this.redis = new Redis({
        host: this.configService.get('REDIS_HOST', 'localhost'),
        port: this.configService.get('REDIS_PORT', 6379),
        password: this.configService.get('REDIS_PASSWORD'),
        maxRetriesPerRequest: 3,
        lazyConnect: true,
      });
    }

    this.redis.on('connect', () => {
      console.log('✅ Connected to Redis');
    });

    this.redis.on('error', (error) => {
      console.error('❌ Redis connection error:', error);
    });
  }

  async onModuleDestroy() {
    if (this.redis) {
      await this.redis.quit();
    }
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const value = await this.redis.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      console.error(`Cache get error for key ${key}:`, error);
      return null;
    }
  }

  async set(key: string, value: any, ttl?: number): Promise<void> {
    try {
      const serializedValue = JSON.stringify(value);
      if (ttl) {
        await this.redis.setex(key, ttl, serializedValue);
      } else {
        await this.redis.set(key, serializedValue);
      }
    } catch (error) {
      console.error(`Cache set error for key ${key}:`, error);
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.redis.del(key);
    } catch (error) {
      console.error(`Cache delete error for key ${key}:`, error);
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      const result = await this.redis.exists(key);
      return result === 1;
    } catch (error) {
      console.error(`Cache exists error for key ${key}:`, error);
      return false;
    }
  }

  async increment(key: string): Promise<number> {
    try {
      return await this.redis.incr(key);
    } catch (error) {
      console.error(`Cache increment error for key ${key}:`, error);
      return 0;
    }
  }

  async expire(key: string, ttl: number): Promise<void> {
    try {
      await this.redis.expire(key, ttl);
    } catch (error) {
      console.error(`Cache expire error for key ${key}:`, error);
    }
  }

  async flushAll(): Promise<void> {
    try {
      await this.redis.flushall();
    } catch (error) {
      console.error('Cache flush all error:', error);
    }
  }

  // Utility methods for common cache patterns
  async getOrSet<T>(
    key: string,
    factory: () => Promise<T>,
    ttl?: number,
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    const value = await factory();
    await this.set(key, value, ttl);
    return value;
  }

  async mget<T>(keys: string[]): Promise<(T | null)[]> {
    try {
      const values = await this.redis.mget(...keys);
      return values.map(value => value ? JSON.parse(value) : null);
    } catch (error) {
      console.error('Cache mget error:', error);
      return keys.map(() => null);
    }
  }

  async mset(keyValuePairs: Array<{ key: string; value: any; ttl?: number }>): Promise<void> {
    try {
      const pipeline = this.redis.pipeline();
      
      for (const { key, value, ttl } of keyValuePairs) {
        const serializedValue = JSON.stringify(value);
        if (ttl) {
          pipeline.setex(key, ttl, serializedValue);
        } else {
          pipeline.set(key, serializedValue);
        }
      }
      
      await pipeline.exec();
    } catch (error) {
      console.error('Cache mset error:', error);
    }
  }

  async invalidatePattern(pattern: string): Promise<void> {
    try {
      const keys = await this.redis.keys(pattern);
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    } catch (error) {
      console.error(`Cache invalidate pattern error for ${pattern}:`, error);
    }
  }

  async getStats(): Promise<{
    memory: string;
    keys: number;
    hits: number;
    misses: number;
  }> {
    try {
      const info = await this.redis.info('memory');
      const keyspace = await this.redis.info('keyspace');
      const stats = await this.redis.info('stats');
      
      // Parse Redis info response
      const memoryMatch = info.match(/used_memory_human:([^\r\n]+)/);
      const keysMatch = keyspace.match(/keys=(\d+)/);
      const hitsMatch = stats.match(/keyspace_hits:(\d+)/);
      const missesMatch = stats.match(/keyspace_misses:(\d+)/);
      
      return {
        memory: memoryMatch ? memoryMatch[1] : 'Unknown',
        keys: keysMatch ? parseInt(keysMatch[1], 10) : 0,
        hits: hitsMatch ? parseInt(hitsMatch[1], 10) : 0,
        misses: missesMatch ? parseInt(missesMatch[1], 10) : 0,
      };
    } catch (error) {
      console.error('Cache stats error:', error);
      return { memory: 'Unknown', keys: 0, hits: 0, misses: 0 };
    }
  }

  // Cache key generators with namespacing
  generateUrlCacheKey(shortCode: string): string {
    return `url:${shortCode}`;
  }

  generateUserCacheKey(userId: string): string {
    return `user:${userId}`;
  }

  generateUserSessionKey(userId: string): string {
    return `session:${userId}`;
  }

  generateAnalyticsCacheKey(urlId: string, period: string): string {
    return `analytics:${urlId}:${period}`;
  }

  generateMetadataCacheKey(url: string): string {
    const urlHash = require('crypto').createHash('md5').update(url).digest('hex');
    return `metadata:${urlHash}`;
  }

  generateRateLimitKey(identifier: string, endpoint: string): string {
    return `ratelimit:${endpoint}:${identifier}`;
  }

  generatePopularUrlsKey(userId: string): string {
    return `popular:${userId}`;
  }

  generateUserUrlsCountKey(userId: string): string {
    return `count:urls:${userId}`;
  }

  // Specialized caching methods
  async cacheUrlResolution(shortCode: string, originalUrl: string, ttl = 3600): Promise<void> {
    await this.set(this.generateUrlCacheKey(shortCode), originalUrl, ttl);
  }

  async getCachedUrlResolution(shortCode: string): Promise<string | null> {
    return this.get<string>(this.generateUrlCacheKey(shortCode));
  }

  async invalidateUrlCache(shortCode: string): Promise<void> {
    await this.del(this.generateUrlCacheKey(shortCode));
  }

  async cacheUserSession(userId: string, sessionData: any, ttl = 900): Promise<void> {
    await this.set(this.generateUserSessionKey(userId), sessionData, ttl);
  }

  async getCachedUserSession(userId: string): Promise<any> {
    return this.get(this.generateUserSessionKey(userId));
  }

  async invalidateUserSession(userId: string): Promise<void> {
    await this.del(this.generateUserSessionKey(userId));
  }

  async cacheAnalytics(urlId: string, period: string, data: any, ttl = 300): Promise<void> {
    await this.set(this.generateAnalyticsCacheKey(urlId, period), data, ttl);
  }

  async getCachedAnalytics(urlId: string, period: string): Promise<any> {
    return this.get(this.generateAnalyticsCacheKey(urlId, period));
  }

  async invalidateAnalyticsCache(urlId: string): Promise<void> {
    await this.invalidatePattern(`analytics:${urlId}:*`);
  }

  async cacheMetadata(url: string, metadata: any, ttl = 86400): Promise<void> {
    await this.set(this.generateMetadataCacheKey(url), metadata, ttl);
  }

  async getCachedMetadata(url: string): Promise<any> {
    return this.get(this.generateMetadataCacheKey(url));
  }

  async cachePopularUrls(userId: string, urls: any[], ttl = 1800): Promise<void> {
    await this.set(this.generatePopularUrlsKey(userId), urls, ttl);
  }

  async getCachedPopularUrls(userId: string): Promise<any[]> {
    return this.get<any[]>(this.generatePopularUrlsKey(userId));
  }

  async invalidateUserCache(userId: string): Promise<void> {
    await this.invalidatePattern(`user:${userId}*`);
    await this.invalidatePattern(`session:${userId}*`);
    await this.invalidatePattern(`popular:${userId}*`);
    await this.invalidatePattern(`count:*:${userId}*`);
  }

  // Cache warming methods
  async warmUrlCache(urls: Array<{ shortCode: string; originalUrl: string }>): Promise<void> {
    const keyValuePairs = urls.map(url => ({
      key: this.generateUrlCacheKey(url.shortCode),
      value: url.originalUrl,
      ttl: 3600,
    }));
    
    await this.mset(keyValuePairs);
  }

  // Health check
  async healthCheck(): Promise<boolean> {
    try {
      await this.redis.ping();
      return true;
    } catch (error) {
      console.error('Redis health check failed:', error);
      return false;
    }
  }
}
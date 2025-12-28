import { Injectable, Inject, OnModuleDestroy } from '@nestjs/common';
import Redis, { Cluster } from 'ioredis';
import { RedisConfigService } from './redis.config';
import { REDIS_CLIENT, REDIS_CACHE_CLIENT, REDIS_SESSION_CLIENT } from './redis.module';

@Injectable()
export class RedisService implements OnModuleDestroy {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redisClient: Redis | Cluster,
    @Inject(REDIS_CACHE_CLIENT) private readonly cacheClient: Redis | Cluster,
    @Inject(REDIS_SESSION_CLIENT) private readonly sessionClient: Redis | Cluster,
    private readonly redisConfigService: RedisConfigService,
  ) {}

  // General Redis operations
  getClient(): Redis | Cluster {
    return this.redisClient;
  }

  getCacheClient(): Redis | Cluster {
    return this.cacheClient;
  }

  getSessionClient(): Redis | Cluster {
    return this.sessionClient;
  }

  // Health check
  async healthCheck(): Promise<{
    main: boolean;
    cache: boolean;
    session: boolean;
  }> {
    const [main, cache, session] = await Promise.all([
      this.redisConfigService.healthCheck(this.redisClient),
      this.redisConfigService.healthCheck(this.cacheClient),
      this.redisConfigService.healthCheck(this.sessionClient),
    ]);

    return { main, cache, session };
  }

  // Cache operations with TTL
  async setCache(key: string, value: any, ttl?: number): Promise<void> {
    const serializedValue = JSON.stringify(value);
    if (ttl) {
      await this.cacheClient.setex(key, ttl, serializedValue);
    } else {
      await this.cacheClient.set(key, serializedValue);
    }
  }

  async getCache<T>(key: string): Promise<T | null> {
    const value = await this.cacheClient.get(key);
    if (!value) return null;
    
    try {
      return JSON.parse(value) as T;
    } catch {
      return value as unknown as T;
    }
  }

  async deleteCache(key: string): Promise<void> {
    await this.cacheClient.del(key);
  }

  async deleteCachePattern(pattern: string): Promise<void> {
    const keys = await this.cacheClient.keys(pattern);
    if (keys.length > 0) {
      await this.cacheClient.del(...keys);
    }
  }

  // Session operations
  async setSession(sessionId: string, data: any, ttl: number): Promise<void> {
    const serializedData = JSON.stringify(data);
    await this.sessionClient.setex(sessionId, ttl, serializedData);
  }

  async getSession<T>(sessionId: string): Promise<T | null> {
    const data = await this.sessionClient.get(sessionId);
    if (!data) return null;
    
    try {
      return JSON.parse(data) as T;
    } catch {
      return null;
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.sessionClient.del(sessionId);
  }

  async extendSession(sessionId: string, ttl: number): Promise<void> {
    await this.sessionClient.expire(sessionId, ttl);
  }

  // Rate limiting operations
  async incrementRateLimit(key: string, ttl: number): Promise<number> {
    const multi = this.redisClient.multi();
    multi.incr(key);
    multi.expire(key, ttl);
    const results = await multi.exec();
    return results?.[0]?.[1] as number || 0;
  }

  async getRateLimit(key: string): Promise<number> {
    const count = await this.redisClient.get(key);
    return count ? parseInt(count, 10) : 0;
  }

  // JWT blacklist operations
  async blacklistToken(tokenId: string, ttl: number): Promise<void> {
    await this.redisClient.setex(`jwt:blacklist:${tokenId}`, ttl, '1');
  }

  async isTokenBlacklisted(tokenId: string): Promise<boolean> {
    const result = await this.redisClient.get(`jwt:blacklist:${tokenId}`);
    return result === '1';
  }

  // Cleanup on module destroy
  async onModuleDestroy(): Promise<void> {
    await Promise.all([
      this.redisClient.quit(),
      this.cacheClient.quit(),
      this.sessionClient.quit(),
    ]);
  }
}
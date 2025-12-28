import { Injectable, Logger, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis, { Cluster } from 'ioredis';
import { REDIS_CACHE_CLIENT } from '../../config/redis.module';
import { getCacheTTLConfig, CacheTTLConfig, CACHE_KEYS } from '../../config/redis.config';

export interface CacheOptions {
  ttl?: number;
  tags?: string[];
  namespace?: string;
}

export interface CacheStats {
  hits: number;
  misses: number;
  sets: number;
  deletes: number;
  hitRate: number;
}

@Injectable()
export class CachingService {
  private readonly logger = new Logger(CachingService.name);
  private readonly ttlConfig: CacheTTLConfig;
  private readonly stats: CacheStats = {
    hits: 0,
    misses: 0,
    sets: 0,
    deletes: 0,
    hitRate: 0,
  };

  constructor(
    @Inject(REDIS_CACHE_CLIENT) private readonly redis: Redis | Cluster,
    private readonly configService: ConfigService,
  ) {
    this.ttlConfig = getCacheTTLConfig(configService);
  }

  /**
   * Cache-aside pattern: Get from cache, if miss then fetch from source
   */
  async getOrSet<T>(
    key: string,
    fetchFunction: () => Promise<T>,
    options: CacheOptions = {},
  ): Promise<T> {
    const cacheKey = this.buildKey(key, options.namespace);
    
    try {
      // Try to get from cache first
      const cached = await this.get<T>(cacheKey);
      if (cached !== null) {
        this.stats.hits++;
        this.updateHitRate();
        return cached;
      }

      // Cache miss - fetch from source
      this.stats.misses++;
      this.updateHitRate();
      
      const data = await fetchFunction();
      
      // Store in cache for future requests
      await this.set(cacheKey, data, options);
      
      return data;
    } catch (error) {
      this.logger.error(`Cache operation failed for key ${cacheKey}:`, error);
      // Fallback to direct fetch if cache fails
      return await fetchFunction();
    }
  }

  /**
   * Set value in cache with optional TTL and tags
   */
  async set<T>(key: string, value: T, options: CacheOptions = {}): Promise<void> {
    const cacheKey = this.buildKey(key, options.namespace);
    const ttl = options.ttl || this.ttlConfig.default;
    
    try {
      const serializedValue = JSON.stringify({
        data: value,
        timestamp: Date.now(),
        tags: options.tags || [],
      });

      await this.redis.setex(cacheKey, ttl, serializedValue);
      
      // Store tags for invalidation
      if (options.tags && options.tags.length > 0) {
        await this.storeTags(cacheKey, options.tags);
      }
      
      this.stats.sets++;
      this.logger.debug(`Cached key ${cacheKey} with TTL ${ttl}s`);
    } catch (error) {
      this.logger.error(`Failed to set cache for key ${cacheKey}:`, error);
      throw error;
    }
  }

  /**
   * Get value from cache
   */
  async get<T>(key: string, namespace?: string): Promise<T | null> {
    const cacheKey = this.buildKey(key, namespace);
    
    try {
      const value = await this.redis.get(cacheKey);
      if (!value) {
        return null;
      }

      const parsed = JSON.parse(value);
      return parsed.data as T;
    } catch (error) {
      this.logger.error(`Failed to get cache for key ${cacheKey}:`, error);
      return null;
    }
  }

  /**
   * Delete specific key from cache
   */
  async delete(key: string, namespace?: string): Promise<void> {
    const cacheKey = this.buildKey(key, namespace);
    
    try {
      await this.redis.del(cacheKey);
      this.stats.deletes++;
      this.logger.debug(`Deleted cache key ${cacheKey}`);
    } catch (error) {
      this.logger.error(`Failed to delete cache for key ${cacheKey}:`, error);
      throw error;
    }
  }

  /**
   * Delete multiple keys by pattern
   */
  async deletePattern(pattern: string, namespace?: string): Promise<number> {
    const searchPattern = this.buildKey(pattern, namespace);
    
    try {
      const keys = await this.redis.keys(searchPattern);
      if (keys.length === 0) {
        return 0;
      }

      await this.redis.del(...keys);
      this.stats.deletes += keys.length;
      this.logger.debug(`Deleted ${keys.length} cache keys matching pattern ${searchPattern}`);
      return keys.length;
    } catch (error) {
      this.logger.error(`Failed to delete cache pattern ${searchPattern}:`, error);
      throw error;
    }
  }

  /**
   * Invalidate cache by tags
   */
  async invalidateByTags(tags: string[]): Promise<number> {
    let totalDeleted = 0;
    
    try {
      for (const tag of tags) {
        const tagKey = `${CACHE_KEYS.METADATA}tag:${tag}`;
        const keys = await this.redis.smembers(tagKey);
        
        if (keys.length > 0) {
          // Delete all keys associated with this tag
          await this.redis.del(...keys);
          // Delete the tag set itself
          await this.redis.del(tagKey);
          
          totalDeleted += keys.length;
          this.logger.debug(`Invalidated ${keys.length} cache keys for tag ${tag}`);
        }
      }
      
      this.stats.deletes += totalDeleted;
      return totalDeleted;
    } catch (error) {
      this.logger.error(`Failed to invalidate cache by tags ${tags.join(', ')}:`, error);
      throw error;
    }
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    return { ...this.stats };
  }

  /**
   * Reset cache statistics
   */
  resetStats(): void {
    this.stats.hits = 0;
    this.stats.misses = 0;
    this.stats.sets = 0;
    this.stats.deletes = 0;
    this.stats.hitRate = 0;
  }

  /**
   * Get cache info and memory usage
   */
  async getCacheInfo(): Promise<{
    memory: any;
    keyspace: any;
    stats: CacheStats;
  }> {
    try {
      const info = await this.redis.info('memory');
      const keyspace = await this.redis.info('keyspace');
      
      return {
        memory: this.parseRedisInfo(info),
        keyspace: this.parseRedisInfo(keyspace),
        stats: this.getStats(),
      };
    } catch (error) {
      this.logger.error('Failed to get cache info:', error);
      throw error;
    }
  }

  /**
   * Warm up cache with frequently accessed data
   */
  async warmUp(warmUpData: Array<{ key: string; fetchFunction: () => Promise<any>; options?: CacheOptions }>): Promise<void> {
    this.logger.log('Starting cache warm-up...');
    
    const promises = warmUpData.map(async ({ key, fetchFunction, options }) => {
      try {
        await this.getOrSet(key, fetchFunction, options);
      } catch (error) {
        this.logger.warn(`Failed to warm up cache for key ${key}:`, error);
      }
    });

    await Promise.allSettled(promises);
    this.logger.log(`Cache warm-up completed for ${warmUpData.length} keys`);
  }

  /**
   * Clear all cache data
   */
  async clear(): Promise<void> {
    try {
      await this.redis.flushdb();
      this.resetStats();
      this.logger.log('Cache cleared successfully');
    } catch (error) {
      this.logger.error('Failed to clear cache:', error);
      throw error;
    }
  }

  /**
   * Check if key exists in cache
   */
  async exists(key: string, namespace?: string): Promise<boolean> {
    const cacheKey = this.buildKey(key, namespace);
    
    try {
      const result = await this.redis.exists(cacheKey);
      return result === 1;
    } catch (error) {
      this.logger.error(`Failed to check existence for key ${cacheKey}:`, error);
      return false;
    }
  }

  /**
   * Get TTL for a key
   */
  async getTTL(key: string, namespace?: string): Promise<number> {
    const cacheKey = this.buildKey(key, namespace);
    
    try {
      return await this.redis.ttl(cacheKey);
    } catch (error) {
      this.logger.error(`Failed to get TTL for key ${cacheKey}:`, error);
      return -1;
    }
  }

  /**
   * Extend TTL for a key
   */
  async extendTTL(key: string, ttl: number, namespace?: string): Promise<void> {
    const cacheKey = this.buildKey(key, namespace);
    
    try {
      await this.redis.expire(cacheKey, ttl);
      this.logger.debug(`Extended TTL for key ${cacheKey} to ${ttl}s`);
    } catch (error) {
      this.logger.error(`Failed to extend TTL for key ${cacheKey}:`, error);
      throw error;
    }
  }

  /**
   * Build cache key with namespace
   */
  private buildKey(key: string, namespace?: string): string {
    const prefix = this.configService.get('REDIS_KEY_PREFIX', 'urlshortener:');
    const ns = namespace ? `${namespace}:` : '';
    return `${prefix}${ns}${key}`;
  }

  /**
   * Store tags for cache invalidation
   */
  private async storeTags(cacheKey: string, tags: string[]): Promise<void> {
    const promises = tags.map(tag => {
      const tagKey = `${CACHE_KEYS.METADATA}tag:${tag}`;
      return this.redis.sadd(tagKey, cacheKey);
    });

    await Promise.all(promises);
  }

  /**
   * Update hit rate calculation
   */
  private updateHitRate(): void {
    const total = this.stats.hits + this.stats.misses;
    this.stats.hitRate = total > 0 ? (this.stats.hits / total) * 100 : 0;
  }

  /**
   * Parse Redis INFO command output
   */
  private parseRedisInfo(info: string): Record<string, any> {
    const result: Record<string, any> = {};
    const lines = info.split('\r\n');
    
    for (const line of lines) {
      if (line.includes(':')) {
        const [key, value] = line.split(':');
        result[key] = isNaN(Number(value)) ? value : Number(value);
      }
    }
    
    return result;
  }
}
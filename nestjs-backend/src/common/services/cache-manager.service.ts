import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';

import { CacheService } from './cache.service';

export interface CacheMetrics {
  hitRate: number;
  missRate: number;
  totalOperations: number;
  memoryUsage: string;
  keyCount: number;
  evictions: number;
}

@Injectable()
export class CacheManagerService implements OnModuleInit {
  private readonly logger = new Logger(CacheManagerService.name);
  private metrics: CacheMetrics = {
    hitRate: 0,
    missRate: 0,
    totalOperations: 0,
    memoryUsage: '0B',
    keyCount: 0,
    evictions: 0,
  };

  constructor(
    private cacheService: CacheService,
    private configService: ConfigService,
  ) {}

  async onModuleInit() {
    await this.initializeCacheWarming();
  }

  async getMetrics(): Promise<CacheMetrics> {
    try {
      const stats = await this.cacheService.getStats();
      
      const totalOps = stats.hits + stats.misses;
      this.metrics = {
        hitRate: totalOps > 0 ? (stats.hits / totalOps) * 100 : 0,
        missRate: totalOps > 0 ? (stats.misses / totalOps) * 100 : 0,
        totalOperations: totalOps,
        memoryUsage: stats.memory,
        keyCount: stats.keys,
        evictions: 0, // Would need to be tracked separately
      };

      return this.metrics;
    } catch (error) {
      this.logger.error('Failed to get cache metrics:', error);
      return this.metrics;
    }
  }

  async clearCache(pattern?: string): Promise<number> {
    try {
      if (pattern) {
        await this.cacheService.invalidatePattern(pattern);
        this.logger.log(`Cleared cache with pattern: ${pattern}`);
        return 1; // Pattern-based clearing doesn't return count
      } else {
        await this.cacheService.flushAll();
        this.logger.log('Cleared entire cache');
        return 1;
      }
    } catch (error) {
      this.logger.error('Failed to clear cache:', error);
      return 0;
    }
  }

  async preloadPopularUrls(): Promise<void> {
    try {
      this.logger.log('Preloading popular URLs into cache...');
      
      // This would typically fetch from database
      // Since we don't have direct access to the URL service here,
      // we'll implement a basic cache warming strategy
      
      // In a real implementation, you would:
      // 1. Inject the UrlsService or create a dedicated warming service
      // 2. Fetch the most accessed URLs from the database
      // 3. Preload them into cache
      
      // For now, we'll log that the warming process is initiated
      this.logger.log('Cache warming initiated - popular URLs will be cached on first access');
      
      // You could also implement cache warming by:
      // - Reading from a configuration file of important URLs
      // - Using analytics data to determine popular URLs
      // - Implementing a background job that runs periodically
      
    } catch (error) {
      this.logger.error('Failed to preload popular URLs:', error);
    }
  }

  async optimizeCache(): Promise<void> {
    try {
      this.logger.log('Starting cache optimization...');
      
      // Get current metrics
      const metrics = await this.getMetrics();
      
      // If hit rate is low, consider cache warming
      if (metrics.hitRate < 70) {
        this.logger.warn(`Low cache hit rate: ${metrics.hitRate.toFixed(2)}%`);
        await this.preloadPopularUrls();
      }
      
      // If memory usage is high, consider cleanup
      if (metrics.keyCount > 100000) {
        this.logger.warn(`High key count: ${metrics.keyCount}`);
        await this.cleanupExpiredKeys();
      }
      
      this.logger.log('Cache optimization completed');
    } catch (error) {
      this.logger.error('Cache optimization failed:', error);
    }
  }

  async validateCacheHealth(): Promise<boolean> {
    try {
      const isHealthy = await this.cacheService.healthCheck();
      
      if (!isHealthy) {
        this.logger.error('Cache health check failed');
        return false;
      }

      const metrics = await this.getMetrics();
      
      // Check for concerning metrics
      if (metrics.hitRate < 50) {
        this.logger.warn(`Low cache hit rate: ${metrics.hitRate.toFixed(2)}%`);
      }
      
      if (metrics.keyCount > 500000) {
        this.logger.warn(`Very high key count: ${metrics.keyCount}`);
      }

      return true;
    } catch (error) {
      this.logger.error('Cache health validation failed:', error);
      return false;
    }
  }

  async getCacheSize(): Promise<{ keys: number; memory: string }> {
    try {
      const stats = await this.cacheService.getStats();
      return {
        keys: stats.keys,
        memory: stats.memory,
      };
    } catch (error) {
      this.logger.error('Failed to get cache size:', error);
      return { keys: 0, memory: '0B' };
    }
  }

  async exportCacheKeys(pattern = '*'): Promise<string[]> {
    try {
      // This would be implemented with Redis SCAN for production
      // to avoid blocking the server with large key sets
      this.logger.log(`Exporting cache keys with pattern: ${pattern}`);
      return []; // Placeholder
    } catch (error) {
      this.logger.error('Failed to export cache keys:', error);
      return [];
    }
  }

  // Scheduled tasks
  @Cron(CronExpression.EVERY_HOUR)
  async scheduledCacheOptimization() {
    if (this.configService.get('CACHE_AUTO_OPTIMIZE', 'true') === 'true') {
      await this.optimizeCache();
    }
  }

  @Cron(CronExpression.EVERY_6_HOURS)
  async scheduledCacheWarming() {
    if (this.configService.get('CACHE_ENABLE_WARMING', 'true') === 'true') {
      await this.preloadPopularUrls();
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async scheduledHealthCheck() {
    const isHealthy = await this.validateCacheHealth();
    if (!isHealthy) {
      this.logger.error('Scheduled cache health check failed');
      // Could send alerts here
    }
  }

  private async initializeCacheWarming(): Promise<void> {
    if (this.configService.get('CACHE_ENABLE_WARMING', 'true') === 'true') {
      // Delay initial warming to allow application to fully start
      setTimeout(async () => {
        await this.preloadPopularUrls();
      }, 30000); // 30 seconds delay
    }
  }

  private async cleanupExpiredKeys(): Promise<void> {
    try {
      this.logger.log('Cleaning up expired cache keys...');
      // Redis automatically handles TTL expiration, but we could
      // implement additional cleanup logic here if needed
      this.logger.log('Cache cleanup completed');
    } catch (error) {
      this.logger.error('Cache cleanup failed:', error);
    }
  }
}
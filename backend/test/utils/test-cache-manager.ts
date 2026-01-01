/**
 * Enhanced Test Cache Manager
 * Provides comprehensive Redis cache setup, teardown, and isolation for tests
 */

import Redis, { Cluster } from 'ioredis';
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { RedisModule } from '../../src/config/redis.module';
import { RedisConfigService } from '../../src/config/redis.config';
import { CACHE_KEYS } from '../../src/config/redis.config';

export interface TestCacheConfig {
  isolationLevel: 'namespace' | 'database' | 'instance';
  autoCleanup: boolean;
  mockMode: boolean;
  keyPrefix: string;
  flushOnSetup: boolean;
}

export interface CacheTestData {
  key: string;
  value: any;
  ttl?: number;
  namespace?: string;
}

export interface MockCacheOperation {
  method: string;
  key: string;
  value?: any;
  result?: any;
  callCount: number;
}

export class TestCacheManager {
  private redisClient: Redis | Cluster;
  private testModule: TestingModule;
  private mockRedis: Map<string, any> = new Map();
  private mockOperations: Map<string, MockCacheOperation> = new Map();
  private testNamespace: string;
  private originalKeyPrefix: string;
  private isConnected = false;

  constructor(private config: TestCacheConfig = {
    isolationLevel: 'namespace',
    autoCleanup: true,
    mockMode: false,
    keyPrefix: 'test:',
    flushOnSetup: true,
  }) {
    this.testNamespace = `test_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  }

  /**
   * Initialize test cache connections and setup
   */
  async setupTestCache(): Promise<void> {
    try {
      if (this.config.mockMode) {
        await this.setupMockCache();
      } else {
        await this.setupRealCache();
      }

      // Setup isolation based on configuration
      await this.setupIsolation();

      // Flush cache if configured
      if (this.config.flushOnSetup) {
        await this.clearCache();
      }

      console.log(`✅ Test cache setup complete: ${this.testNamespace}`);
    } catch (error) {
      console.error('❌ Test cache setup failed:', error);
      throw error;
    }
  }

  /**
   * Setup mock cache for unit testing
   */
  private async setupMockCache(): Promise<void> {
    this.mockRedis.clear();
    this.mockOperations.clear();
    
    // Create mock Redis client
    this.redisClient = {
      get: jest.fn().mockImplementation((key: string) => {
        this.recordOperation('get', key);
        return Promise.resolve(this.mockRedis.get(this.prefixKey(key)));
      }),
      set: jest.fn().mockImplementation((key: string, value: any, ...args: any[]) => {
        this.recordOperation('set', key, value);
        this.mockRedis.set(this.prefixKey(key), value);
        return Promise.resolve('OK');
      }),
      setex: jest.fn().mockImplementation((key: string, ttl: number, value: any) => {
        this.recordOperation('setex', key, value);
        this.mockRedis.set(this.prefixKey(key), value);
        // In a real implementation, we'd handle TTL
        return Promise.resolve('OK');
      }),
      del: jest.fn().mockImplementation((key: string | string[]) => {
        const keys = Array.isArray(key) ? key : [key];
        let deletedCount = 0;
        keys.forEach(k => {
          this.recordOperation('del', k);
          const prefixedKey = this.prefixKey(k);
          if (this.mockRedis.has(prefixedKey)) {
            this.mockRedis.delete(prefixedKey);
            deletedCount++;
          }
        });
        return Promise.resolve(deletedCount);
      }),
      exists: jest.fn().mockImplementation((key: string) => {
        this.recordOperation('exists', key);
        return Promise.resolve(this.mockRedis.has(this.prefixKey(key)) ? 1 : 0);
      }),
      keys: jest.fn().mockImplementation((pattern: string) => {
        this.recordOperation('keys', pattern);
        const regex = new RegExp(pattern.replace(/\*/g, '.*'));
        return Promise.resolve(
          Array.from(this.mockRedis.keys()).filter(key => regex.test(key))
        );
      }),
      flushdb: jest.fn().mockImplementation(() => {
        this.recordOperation('flushdb', '');
        this.mockRedis.clear();
        return Promise.resolve('OK');
      }),
      ping: jest.fn().mockImplementation(() => {
        this.recordOperation('ping', '');
        return Promise.resolve('PONG');
      }),
      quit: jest.fn().mockImplementation(() => {
        this.recordOperation('quit', '');
        return Promise.resolve('OK');
      }),
      disconnect: jest.fn().mockImplementation(() => {
        this.recordOperation('disconnect', '');
        return Promise.resolve();
      }),
    } as any;

    this.isConnected = true;
  }

  /**
   * Setup real Redis cache for integration testing
   */
  private async setupRealCache(): Promise<void> {
    // Create test module with Redis configuration
    this.testModule = await Test.createTestingModule({
      imports: [RedisModule],
      providers: [
        {
          provide: ConfigService,
          useValue: this.createTestConfigService(),
        },
        RedisConfigService,
      ],
    }).compile();

    // Get Redis client from module
    const redisConfigService = this.testModule.get<RedisConfigService>(RedisConfigService);
    this.redisClient = redisConfigService.createRedisInstance();

    // Setup connection event handlers
    redisConfigService.setupConnectionEventHandlers(this.redisClient);

    // Wait for connection
    await this.waitForConnection();
    this.isConnected = true;
  }

  /**
   * Setup cache isolation based on configuration
   */
  private async setupIsolation(): Promise<void> {
    switch (this.config.isolationLevel) {
      case 'namespace':
        // Use namespace prefix for isolation
        this.originalKeyPrefix = this.config.keyPrefix;
        this.config.keyPrefix = `${this.testNamespace}:${this.config.keyPrefix}`;
        break;
      case 'database':
        // Use different Redis database (0-15)
        if (!this.config.mockMode && this.redisClient instanceof Redis) {
          const dbIndex = Math.floor(Math.random() * 15) + 1; // Use DB 1-15 for tests
          await this.redisClient.select(dbIndex);
        }
        break;
      case 'instance':
        // Instance-level isolation is handled by separate Redis instances
        break;
    }
  }

  /**
   * Clear all cache data
   */
  async clearCache(): Promise<void> {
    try {
      if (this.config.mockMode) {
        this.mockRedis.clear();
        this.mockOperations.clear();
      } else {
        if (this.config.isolationLevel === 'namespace') {
          // Clear only keys with our namespace
          const pattern = `${this.testNamespace}:*`;
          const keys = await this.redisClient.keys(pattern);
          if (keys.length > 0) {
            await this.redisClient.del(...keys);
          }
        } else {
          // Clear entire database
          await this.redisClient.flushdb();
        }
      }

      console.log('🧹 Test cache cleared successfully');
    } catch (error) {
      console.error('❌ Test cache clear failed:', error);
      throw error;
    }
  }

  /**
   * Set cache value with optional TTL
   */
  async set(key: string, value: any, ttl?: number): Promise<void> {
    const prefixedKey = this.prefixKey(key);
    const serializedValue = JSON.stringify(value);

    if (ttl) {
      await this.redisClient.setex(prefixedKey, ttl, serializedValue);
    } else {
      await this.redisClient.set(prefixedKey, serializedValue);
    }
  }

  /**
   * Get cache value
   */
  async get<T = any>(key: string): Promise<T | null> {
    const prefixedKey = this.prefixKey(key);
    const value = await this.redisClient.get(prefixedKey);
    
    if (value === null) {
      return null;
    }

    try {
      return JSON.parse(value);
    } catch {
      return value as T;
    }
  }

  /**
   * Delete cache key(s)
   */
  async delete(key: string | string[]): Promise<number> {
    const keys = Array.isArray(key) ? key : [key];
    const prefixedKeys = keys.map(k => this.prefixKey(k));
    return await this.redisClient.del(...prefixedKeys);
  }

  /**
   * Check if key exists
   */
  async exists(key: string): Promise<boolean> {
    const prefixedKey = this.prefixKey(key);
    const result = await this.redisClient.exists(prefixedKey);
    return result === 1;
  }

  /**
   * Get all keys matching pattern
   */
  async keys(pattern: string): Promise<string[]> {
    const prefixedPattern = this.prefixKey(pattern);
    const keys = await this.redisClient.keys(prefixedPattern);
    // Remove prefix from returned keys
    return keys.map(key => key.replace(this.config.keyPrefix, ''));
  }

  /**
   * Seed cache with test data
   */
  async seedTestData(testData: CacheTestData[]): Promise<void> {
    try {
      for (const data of testData) {
        const key = data.namespace ? `${data.namespace}:${data.key}` : data.key;
        await this.set(key, data.value, data.ttl);
      }

      console.log(`🌱 Test cache seeded with ${testData.length} entries`);
    } catch (error) {
      console.error('❌ Test cache seeding failed:', error);
      throw error;
    }
  }

  /**
   * Verify cache operation was called
   */
  verifyOperation(method: string, key: string, expectedCallCount = 1): boolean {
    if (!this.config.mockMode) {
      throw new Error('Operation verification only available in mock mode');
    }

    const operationKey = `${method}:${key}`;
    const operation = this.mockOperations.get(operationKey);
    
    return operation ? operation.callCount === expectedCallCount : false;
  }

  /**
   * Verify cache value matches expected
   */
  async verifyCache(key: string, expectedValue: any): Promise<boolean> {
    try {
      const actualValue = await this.get(key);
      return JSON.stringify(actualValue) === JSON.stringify(expectedValue);
    } catch {
      return false;
    }
  }

  /**
   * Get cache statistics
   */
  async getCacheStats(): Promise<{
    keyCount: number;
    memoryUsage: string;
    hitRate?: number;
    operations: MockCacheOperation[];
  }> {
    const stats = {
      keyCount: 0,
      memoryUsage: '0B',
      operations: Array.from(this.mockOperations.values()),
    };

    try {
      if (this.config.mockMode) {
        stats.keyCount = this.mockRedis.size;
        stats.memoryUsage = `${JSON.stringify(Array.from(this.mockRedis.entries())).length}B`;
      } else {
        const info = await this.redisClient.info('memory');
        const keyspaceInfo = await this.redisClient.info('keyspace');
        
        // Parse keyspace info for key count
        const keyspaceMatch = keyspaceInfo.match(/keys=(\d+)/);
        stats.keyCount = keyspaceMatch ? parseInt(keyspaceMatch[1]) : 0;
        
        // Parse memory usage
        const memoryMatch = info.match(/used_memory_human:([^\r\n]+)/);
        stats.memoryUsage = memoryMatch ? memoryMatch[1].trim() : '0B';
      }
    } catch (error) {
      console.warn('Could not retrieve cache stats:', error.message);
    }

    return stats;
  }

  /**
   * Get Redis client for direct operations
   */
  getClient(): Redis | Cluster {
    return this.redisClient;
  }

  /**
   * Check if cache is ready
   */
  async isReady(): Promise<boolean> {
    try {
      const result = await this.redisClient.ping();
      return result === 'PONG' && this.isConnected;
    } catch {
      return false;
    }
  }

  /**
   * Teardown test cache and cleanup resources
   */
  async teardownTestCache(): Promise<void> {
    try {
      // Clear cache if auto cleanup is enabled
      if (this.config.autoCleanup) {
        await this.clearCache();
      }

      // Disconnect from Redis
      if (this.redisClient && this.isConnected) {
        if (this.config.mockMode) {
          // Mock cleanup
          this.mockRedis.clear();
          this.mockOperations.clear();
        } else {
          // Real Redis cleanup
          await this.redisClient.quit();
        }
      }

      // Close test module
      if (this.testModule) {
        await this.testModule.close();
      }

      this.isConnected = false;
      console.log('🧹 Test cache teardown complete');
    } catch (error) {
      console.error('❌ Test cache teardown failed:', error);
      throw error;
    }
  }

  // Private helper methods

  private prefixKey(key: string): string {
    return `${this.config.keyPrefix}${key}`;
  }

  private recordOperation(method: string, key: string, value?: any): void {
    if (!this.config.mockMode) return;

    const operationKey = `${method}:${key}`;
    const existing = this.mockOperations.get(operationKey);
    
    if (existing) {
      existing.callCount++;
    } else {
      this.mockOperations.set(operationKey, {
        method,
        key,
        value,
        callCount: 1,
      });
    }
  }

  private async waitForConnection(timeout = 10000): Promise<void> {
    const start = Date.now();
    
    while (Date.now() - start < timeout) {
      try {
        const result = await this.redisClient.ping();
        if (result === 'PONG') {
          return;
        }
      } catch {
        // Continue waiting
      }
      
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    throw new Error('Redis connection timeout');
  }

  private createTestConfigService(): ConfigService {
    const testConfig = new Map([
      ['NODE_ENV', 'test'],
      ['REDIS_HOST', process.env.REDIS_HOST || 'localhost'],
      ['REDIS_PORT', process.env.REDIS_PORT || '6379'],
      ['REDIS_PASSWORD', process.env.REDIS_PASSWORD],
      ['REDIS_DB', '1'], // Use DB 1 for tests
      ['REDIS_KEY_PREFIX', this.config.keyPrefix],
      ['REDIS_CLUSTER_ENABLED', 'false'],
    ]);

    return {
      get: (key: string, defaultValue?: any) => testConfig.get(key) || defaultValue,
    } as ConfigService;
  }
}

// Utility functions for common cache testing patterns

/**
 * Create test cache data with realistic values
 */
export function createTestCacheData(count = 5): CacheTestData[] {
  const data: CacheTestData[] = [];
  
  for (let i = 0; i < count; i++) {
    data.push({
      key: `test_key_${i}`,
      value: {
        id: i,
        name: `Test Item ${i}`,
        timestamp: Date.now(),
        data: Math.random().toString(36),
      },
      ttl: Math.floor(Math.random() * 3600) + 60, // 1-60 minutes
      namespace: i % 2 === 0 ? 'even' : 'odd',
    });
  }
  
  return data;
}

/**
 * Create cache data for specific cache keys
 */
export function createCacheDataForKeys(keys: typeof CACHE_KEYS): CacheTestData[] {
  return [
    {
      key: keys.URL_RESOLUTION + 'test123',
      value: { originalUrl: 'https://example.com', shortCode: 'test123' },
      ttl: 3600,
    },
    {
      key: keys.USER_SESSION + 'user456',
      value: { userId: 'user456', sessionId: 'session789' },
      ttl: 900,
    },
    {
      key: keys.ANALYTICS + 'daily:2024-01-01',
      value: { clicks: 100, visitors: 50, date: '2024-01-01' },
      ttl: 86400,
    },
    {
      key: keys.RATE_LIMIT + '192.168.1.1',
      value: { count: 5, resetTime: Date.now() + 3600000 },
      ttl: 3600,
    },
  ];
}

// Export singleton instance for global use
export const testCacheManager = new TestCacheManager();
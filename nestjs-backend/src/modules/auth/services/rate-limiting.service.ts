import { Injectable, Logger, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { REDIS_CLIENT } from '../../../config/redis.module';

export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  blockDurationMs?: number;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
}

export interface RateLimitResult {
  allowed: boolean;
  totalHits: number;
  remainingPoints: number;
  msBeforeNext: number;
  isBlocked: boolean;
}

@Injectable()
export class RateLimitingService {
  private readonly logger = new Logger(RateLimitingService.name);

  // Default rate limit configurations
  private readonly configs: Record<string, RateLimitConfig> = {
    global: {
      windowMs: 15 * 60 * 1000, // 15 minutes
      maxRequests: 1000,
    },
    auth: {
      windowMs: 15 * 60 * 1000, // 15 minutes
      maxRequests: 5,
      blockDurationMs: 60 * 60 * 1000, // 1 hour block after exceeding
    },
    'auth-sensitive': {
      windowMs: 15 * 60 * 1000, // 15 minutes
      maxRequests: 3,
      blockDurationMs: 2 * 60 * 60 * 1000, // 2 hour block
    },
    'password-reset': {
      windowMs: 15 * 60 * 1000, // 15 minutes
      maxRequests: 3,
      blockDurationMs: 60 * 60 * 1000, // 1 hour block
    },
    'email-verification': {
      windowMs: 15 * 60 * 1000, // 15 minutes
      maxRequests: 5,
      blockDurationMs: 30 * 60 * 1000, // 30 minutes block
    },
    'url-creation': {
      windowMs: 60 * 1000, // 1 minute
      maxRequests: 10,
    },
    'url-access': {
      windowMs: 60 * 1000, // 1 minute
      maxRequests: 100,
    },
    'api-general': {
      windowMs: 60 * 1000, // 1 minute
      maxRequests: 60,
    },
  };

  constructor(
    private readonly configService: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /**
   * Check rate limit for a key
   */
  async checkRateLimit(
    key: string,
    configName: string = 'global',
    customConfig?: Partial<RateLimitConfig>
  ): Promise<RateLimitResult> {
    try {
      const config = { ...this.configs[configName], ...customConfig };
      if (!config) {
        throw new Error(`Rate limit configuration '${configName}' not found`);
      }

      const now = Date.now();
      const windowStart = now - config.windowMs;
      const rateLimitKey = `rate_limit:${configName}:${key}`;
      const blockKey = `rate_limit_block:${configName}:${key}`;

      // Check if currently blocked
      const blockExpiry = await this.redis.get(blockKey);
      if (blockExpiry && parseInt(blockExpiry, 10) > now) {
        const msBeforeNext = parseInt(blockExpiry, 10) - now;
        return {
          allowed: false,
          totalHits: config.maxRequests,
          remainingPoints: 0,
          msBeforeNext,
          isBlocked: true,
        };
      }

      // Use Redis pipeline for atomic operations
      const pipeline = this.redis.pipeline();
      
      // Remove expired entries
      pipeline.zremrangebyscore(rateLimitKey, 0, windowStart);
      
      // Count current requests in window
      pipeline.zcard(rateLimitKey);
      
      // Add current request
      pipeline.zadd(rateLimitKey, now, `${now}-${Math.random()}`);
      
      // Set expiration for cleanup
      pipeline.expire(rateLimitKey, Math.ceil(config.windowMs / 1000));

      const results = await pipeline.exec();
      const currentCount = (results?.[1]?.[1] as number) || 0;
      const totalHits = currentCount + 1; // Including the current request

      const remainingPoints = Math.max(0, config.maxRequests - totalHits);
      const allowed = totalHits <= config.maxRequests;

      // If limit exceeded and block duration is configured, set block
      if (!allowed && config.blockDurationMs) {
        const blockUntil = now + config.blockDurationMs;
        await this.redis.setex(blockKey, Math.ceil(config.blockDurationMs / 1000), blockUntil.toString());
        
        this.logger.warn(`Rate limit exceeded for ${key} (${configName}). Blocked until ${new Date(blockUntil).toISOString()}`);
      }

      // Calculate time until window resets
      const oldestEntry = await this.redis.zrange(rateLimitKey, 0, 0, 'WITHSCORES');
      const msBeforeNext = oldestEntry.length > 0 
        ? Math.max(0, (parseInt(oldestEntry[1], 10) + config.windowMs) - now)
        : config.windowMs;

      if (!allowed) {
        this.logger.debug(`Rate limit exceeded for ${key} (${configName}): ${totalHits}/${config.maxRequests}`);
      }

      return {
        allowed,
        totalHits,
        remainingPoints,
        msBeforeNext,
        isBlocked: false,
      };
    } catch (error) {
      this.logger.error(`Error checking rate limit for ${key}:`, error.stack);
      // Fail open - allow request if Redis is down
      return {
        allowed: true,
        totalHits: 0,
        remainingPoints: 1000,
        msBeforeNext: 0,
        isBlocked: false,
      };
    }
  }

  /**
   * Reset rate limit for a key
   */
  async resetRateLimit(key: string, configName: string = 'global'): Promise<void> {
    try {
      const rateLimitKey = `rate_limit:${configName}:${key}`;
      const blockKey = `rate_limit_block:${configName}:${key}`;
      
      await Promise.all([
        this.redis.del(rateLimitKey),
        this.redis.del(blockKey),
      ]);

      this.logger.debug(`Rate limit reset for ${key} (${configName})`);
    } catch (error) {
      this.logger.error(`Error resetting rate limit for ${key}:`, error.stack);
    }
  }

  /**
   * Get rate limit status without incrementing
   */
  async getRateLimitStatus(key: string, configName: string = 'global'): Promise<RateLimitResult> {
    try {
      const config = this.configs[configName];
      if (!config) {
        throw new Error(`Rate limit configuration '${configName}' not found`);
      }

      const now = Date.now();
      const windowStart = now - config.windowMs;
      const rateLimitKey = `rate_limit:${configName}:${key}`;
      const blockKey = `rate_limit_block:${configName}:${key}`;

      // Check if currently blocked
      const blockExpiry = await this.redis.get(blockKey);
      if (blockExpiry && parseInt(blockExpiry, 10) > now) {
        const msBeforeNext = parseInt(blockExpiry, 10) - now;
        return {
          allowed: false,
          totalHits: config.maxRequests,
          remainingPoints: 0,
          msBeforeNext,
          isBlocked: true,
        };
      }

      // Clean up expired entries and count current requests
      await this.redis.zremrangebyscore(rateLimitKey, 0, windowStart);
      const currentCount = await this.redis.zcard(rateLimitKey);

      const remainingPoints = Math.max(0, config.maxRequests - currentCount);
      const allowed = currentCount < config.maxRequests;

      // Calculate time until window resets
      const oldestEntry = await this.redis.zrange(rateLimitKey, 0, 0, 'WITHSCORES');
      const msBeforeNext = oldestEntry.length > 0 
        ? Math.max(0, (parseInt(oldestEntry[1], 10) + config.windowMs) - now)
        : config.windowMs;

      return {
        allowed,
        totalHits: currentCount,
        remainingPoints,
        msBeforeNext,
        isBlocked: false,
      };
    } catch (error) {
      this.logger.error(`Error getting rate limit status for ${key}:`, error.stack);
      return {
        allowed: true,
        totalHits: 0,
        remainingPoints: 1000,
        msBeforeNext: 0,
        isBlocked: false,
      };
    }
  }

  /**
   * Block a key for a specific duration
   */
  async blockKey(key: string, configName: string, durationMs: number): Promise<void> {
    try {
      const blockKey = `rate_limit_block:${configName}:${key}`;
      const blockUntil = Date.now() + durationMs;
      
      await this.redis.setex(blockKey, Math.ceil(durationMs / 1000), blockUntil.toString());
      
      this.logger.warn(`Manually blocked ${key} (${configName}) until ${new Date(blockUntil).toISOString()}`);
    } catch (error) {
      this.logger.error(`Error blocking key ${key}:`, error.stack);
    }
  }

  /**
   * Unblock a key
   */
  async unblockKey(key: string, configName: string): Promise<void> {
    try {
      const blockKey = `rate_limit_block:${configName}:${key}`;
      await this.redis.del(blockKey);
      
      this.logger.log(`Unblocked ${key} (${configName})`);
    } catch (error) {
      this.logger.error(`Error unblocking key ${key}:`, error.stack);
    }
  }

  /**
   * Get all blocked keys
   */
  async getBlockedKeys(): Promise<Array<{ key: string; configName: string; expiresAt: Date }>> {
    try {
      const blockKeys = await this.redis.keys('rate_limit_block:*');
      const blockedKeys = [];

      for (const blockKey of blockKeys) {
        const expiry = await this.redis.get(blockKey);
        if (expiry) {
          const [, configName, ...keyParts] = blockKey.split(':');
          const key = keyParts.join(':');
          
          blockedKeys.push({
            key,
            configName,
            expiresAt: new Date(parseInt(expiry, 10)),
          });
        }
      }

      return blockedKeys;
    } catch (error) {
      this.logger.error('Error getting blocked keys:', error.stack);
      return [];
    }
  }

  /**
   * Clean up expired rate limit data
   */
  async cleanup(): Promise<void> {
    try {
      const now = Date.now();
      const keys = await this.redis.keys('rate_limit:*');
      
      for (const key of keys) {
        // Remove entries older than the maximum window size
        const maxWindow = Math.max(...Object.values(this.configs).map(c => c.windowMs));
        const cutoff = now - maxWindow;
        
        await this.redis.zremrangebyscore(key, 0, cutoff);
        
        // Remove empty keys
        const count = await this.redis.zcard(key);
        if (count === 0) {
          await this.redis.del(key);
        }
      }

      this.logger.debug('Rate limit cleanup completed');
    } catch (error) {
      this.logger.error('Error during rate limit cleanup:', error.stack);
    }
  }

  /**
   * Get rate limit configuration
   */
  getConfig(configName: string): RateLimitConfig | undefined {
    return this.configs[configName];
  }

  /**
   * Update rate limit configuration
   */
  updateConfig(configName: string, config: RateLimitConfig): void {
    this.configs[configName] = config;
    this.logger.log(`Updated rate limit configuration for ${configName}`);
  }
}
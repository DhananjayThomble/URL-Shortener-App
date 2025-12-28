import { Injectable, Logger, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  keyGenerator?: (req: any) => string;
  skipIf?: (req: any) => boolean;
  onLimitReached?: (req: any, info: RateLimitInfo) => void;
  message?: string;
  standardHeaders?: boolean;
  legacyHeaders?: boolean;
}

export interface RateLimitInfo {
  totalHits: number;
  totalTime: number;
  resetTime: Date;
  remaining: number;
}

export interface EndpointRateLimit {
  endpoint: string;
  method: string;
  windowMs: number;
  maxRequests: number;
  currentRequests: number;
  resetTime: Date;
}

@Injectable()
export class AdvancedRateLimitingService {
  private readonly logger = new Logger(AdvancedRateLimitingService.name);

  constructor(
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Check if request should be rate limited
   */
  async checkRateLimit(
    key: string,
    config: RateLimitConfig,
  ): Promise<{ allowed: boolean; info: RateLimitInfo }> {
    const now = Date.now();
    const window = Math.floor(now / config.windowMs);
    const redisKey = `rate_limit:${key}:${window}`;

    try {
      // Use Redis pipeline for atomic operations
      const pipeline = this.redis.pipeline();
      pipeline.incr(redisKey);
      pipeline.expire(redisKey, Math.ceil(config.windowMs / 1000));
      
      const results = await pipeline.exec();
      const totalHits = results?.[0]?.[1] as number || 0;

      const resetTime = new Date((window + 1) * config.windowMs);
      const remaining = Math.max(0, config.maxRequests - totalHits);

      const info: RateLimitInfo = {
        totalHits,
        totalTime: config.windowMs,
        resetTime,
        remaining,
      };

      const allowed = totalHits <= config.maxRequests;

      if (!allowed) {
        this.logger.warn(`Rate limit exceeded for key: ${key}`, {
          key,
          totalHits,
          maxRequests: config.maxRequests,
          windowMs: config.windowMs,
        });
      }

      return { allowed, info };
    } catch (error) {
      this.logger.error('Rate limiting check failed', error);
      // Fail open - allow request if Redis is down
      return {
        allowed: true,
        info: {
          totalHits: 0,
          totalTime: config.windowMs,
          resetTime: new Date(now + config.windowMs),
          remaining: config.maxRequests,
        },
      };
    }
  }

  /**
   * Get rate limit status for a key
   */
  async getRateLimitStatus(key: string, windowMs: number): Promise<RateLimitInfo | null> {
    const now = Date.now();
    const window = Math.floor(now / windowMs);
    const redisKey = `rate_limit:${key}:${window}`;

    try {
      const totalHits = await this.redis.get(redisKey);
      const ttl = await this.redis.ttl(redisKey);

      if (totalHits === null) {
        return null;
      }

      return {
        totalHits: parseInt(totalHits, 10),
        totalTime: windowMs,
        resetTime: new Date(now + (ttl * 1000)),
        remaining: 0, // Would need maxRequests to calculate
      };
    } catch (error) {
      this.logger.error('Failed to get rate limit status', error);
      return null;
    }
  }

  /**
   * Reset rate limit for a key
   */
  async resetRateLimit(key: string, windowMs: number): Promise<void> {
    const now = Date.now();
    const window = Math.floor(now / windowMs);
    const redisKey = `rate_limit:${key}:${window}`;

    try {
      await this.redis.del(redisKey);
      this.logger.log(`Rate limit reset for key: ${key}`);
    } catch (error) {
      this.logger.error('Failed to reset rate limit', error);
    }
  }

  /**
   * Get rate limiting analytics
   */
  async getRateLimitAnalytics(
    timeRange: { start: Date; end: Date },
    groupBy: 'hour' | 'day' = 'hour',
  ): Promise<{
    totalRequests: number;
    blockedRequests: number;
    topBlockedKeys: Array<{ key: string; count: number }>;
    timeSeriesData: Array<{ timestamp: Date; requests: number; blocked: number }>;
  }> {
    try {
      const analyticsKey = 'rate_limit_analytics';
      const start = timeRange.start.getTime();
      const end = timeRange.end.getTime();

      // This would typically query from a time-series database
      // For now, we'll return mock data structure
      return {
        totalRequests: 0,
        blockedRequests: 0,
        topBlockedKeys: [],
        timeSeriesData: [],
      };
    } catch (error) {
      this.logger.error('Failed to get rate limit analytics', error);
      throw error;
    }
  }

  /**
   * Record rate limit event for analytics
   */
  async recordRateLimitEvent(
    key: string,
    endpoint: string,
    method: string,
    blocked: boolean,
    userAgent?: string,
    ip?: string,
  ): Promise<void> {
    try {
      const event = {
        timestamp: new Date().toISOString(),
        key,
        endpoint,
        method,
        blocked,
        userAgent,
        ip,
      };

      // Store in Redis for real-time analytics
      const analyticsKey = `rate_limit_events:${Date.now()}`;
      await this.redis.setex(analyticsKey, 86400, JSON.stringify(event)); // 24 hours TTL

      // Also increment counters for quick stats
      const dateKey = new Date().toISOString().split('T')[0];
      const pipeline = this.redis.pipeline();
      
      pipeline.hincrby(`rate_limit_stats:${dateKey}`, 'total_requests', 1);
      if (blocked) {
        pipeline.hincrby(`rate_limit_stats:${dateKey}`, 'blocked_requests', 1);
        pipeline.zincrby(`rate_limit_blocked_keys:${dateKey}`, 1, key);
      }
      
      await pipeline.exec();
    } catch (error) {
      this.logger.error('Failed to record rate limit event', error);
    }
  }

  /**
   * Get endpoint-specific rate limits
   */
  async getEndpointRateLimits(): Promise<EndpointRateLimit[]> {
    try {
      // This would typically come from configuration or database
      const endpoints: EndpointRateLimit[] = [
        {
          endpoint: '/api/v1/auth/login',
          method: 'POST',
          windowMs: 15 * 60 * 1000, // 15 minutes
          maxRequests: 5,
          currentRequests: 0,
          resetTime: new Date(),
        },
        {
          endpoint: '/api/v1/enhanced-links',
          method: 'POST',
          windowMs: 60 * 60 * 1000, // 1 hour
          maxRequests: 100,
          currentRequests: 0,
          resetTime: new Date(),
        },
        {
          endpoint: '/api/v1/analytics/*',
          method: 'GET',
          windowMs: 60 * 60 * 1000, // 1 hour
          maxRequests: 1000,
          currentRequests: 0,
          resetTime: new Date(),
        },
      ];

      // Get current usage for each endpoint
      for (const endpoint of endpoints) {
        const key = `${endpoint.method}:${endpoint.endpoint}`;
        const status = await this.getRateLimitStatus(key, endpoint.windowMs);
        if (status) {
          endpoint.currentRequests = status.totalHits;
          endpoint.resetTime = status.resetTime;
        }
      }

      return endpoints;
    } catch (error) {
      this.logger.error('Failed to get endpoint rate limits', error);
      return [];
    }
  }

  /**
   * Update rate limit configuration
   */
  async updateRateLimitConfig(
    endpoint: string,
    method: string,
    config: Partial<RateLimitConfig>,
  ): Promise<void> {
    try {
      const configKey = `rate_limit_config:${method}:${endpoint}`;
      await this.redis.hset(configKey, config as any);
      
      this.logger.log(`Updated rate limit config for ${method} ${endpoint}`, config);
    } catch (error) {
      this.logger.error('Failed to update rate limit config', error);
      throw error;
    }
  }

  /**
   * Get rate limit configuration for endpoint
   */
  async getRateLimitConfig(endpoint: string, method: string): Promise<RateLimitConfig | null> {
    try {
      const configKey = `rate_limit_config:${method}:${endpoint}`;
      const config = await this.redis.hgetall(configKey);
      
      if (Object.keys(config).length === 0) {
        return null;
      }

      return {
        windowMs: parseInt(config.windowMs, 10),
        maxRequests: parseInt(config.maxRequests, 10),
        message: config.message,
        standardHeaders: config.standardHeaders === 'true',
        legacyHeaders: config.legacyHeaders === 'true',
      };
    } catch (error) {
      this.logger.error('Failed to get rate limit config', error);
      return null;
    }
  }

  /**
   * Generate default key for rate limiting
   */
  generateKey(req: any, prefix: string = 'default'): string {
    const ip = req.ip || req.connection?.remoteAddress || 'unknown';
    const userId = req.user?.id || 'anonymous';
    const userAgent = req.get('User-Agent') || 'unknown';
    
    // Create a hash of user agent to avoid very long keys
    const userAgentHash = this.hashString(userAgent).substring(0, 8);
    
    return `${prefix}:${userId}:${ip}:${userAgentHash}`;
  }

  /**
   * Generate endpoint-specific key
   */
  generateEndpointKey(req: any, endpoint: string, method: string): string {
    const baseKey = this.generateKey(req, 'endpoint');
    return `${baseKey}:${method}:${endpoint}`;
  }

  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }
}
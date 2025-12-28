import {
  Injectable,
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';
import { AdvancedRateLimitingService, RateLimitConfig } from '../services/advanced-rate-limiting.service';
import { ApiAnalyticsService } from '../services/api-analytics.service';
import { RateLimitException } from '../exceptions/custom.exceptions';

export const RATE_LIMIT_KEY = 'rateLimit';

export interface RateLimitOptions {
  windowMs?: number;
  maxRequests?: number;
  keyGenerator?: (req: Request) => string;
  skipIf?: (req: Request) => boolean;
  message?: string;
  standardHeaders?: boolean;
  legacyHeaders?: boolean;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
  onLimitReached?: (req: Request) => void;
}

/**
 * Decorator to apply rate limiting to endpoints
 */
export const RateLimit = (options: RateLimitOptions) => {
  return (target: any, propertyKey?: string, descriptor?: PropertyDescriptor) => {
    if (propertyKey && descriptor) {
      // Method decorator
      Reflect.defineMetadata(RATE_LIMIT_KEY, options, descriptor.value);
    } else {
      // Class decorator
      Reflect.defineMetadata(RATE_LIMIT_KEY, options, target);
    }
  };
};

@Injectable()
export class ComprehensiveRateLimitGuard implements CanActivate {
  private readonly logger = new Logger(ComprehensiveRateLimitGuard.name);

  constructor(
    private readonly rateLimitService: AdvancedRateLimitingService,
    private readonly analyticsService: ApiAnalyticsService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    // Get rate limit configuration from decorator
    const rateLimitOptions = this.getRateLimitOptions(context);
    
    if (!rateLimitOptions) {
      return true; // No rate limiting configured
    }

    // Check if request should be skipped
    if (rateLimitOptions.skipIf && rateLimitOptions.skipIf(request)) {
      return true;
    }

    // Generate rate limit key
    const key = this.generateRateLimitKey(request, rateLimitOptions);
    
    // Create rate limit configuration
    const config: RateLimitConfig = {
      windowMs: rateLimitOptions.windowMs || 60 * 1000, // Default 1 minute
      maxRequests: rateLimitOptions.maxRequests || 100, // Default 100 requests
      keyGenerator: rateLimitOptions.keyGenerator,
      skipIf: rateLimitOptions.skipIf,
      message: rateLimitOptions.message || 'Too many requests',
      standardHeaders: rateLimitOptions.standardHeaders !== false,
      legacyHeaders: rateLimitOptions.legacyHeaders !== false,
    };

    try {
      // Check rate limit
      const { allowed, info } = await this.rateLimitService.checkRateLimit(key, config);

      // Set rate limit headers
      this.setRateLimitHeaders(response, info, config);

      // Record analytics event
      await this.analyticsService.recordApiUsage({
        timestamp: new Date(),
        endpoint: request.path,
        method: request.method,
        statusCode: allowed ? 200 : 429,
        responseTime: 0, // Will be updated by response interceptor
        userId: request['user']?.id,
        userAgent: request.get('User-Agent'),
        ip: request.ip,
        apiVersion: request['apiVersion'],
        requestId: request['requestId'],
        rateLimited: !allowed,
      });

      // Record rate limit event for analytics
      await this.rateLimitService.recordRateLimitEvent(
        key,
        request.path,
        request.method,
        !allowed,
        request.get('User-Agent'),
        request.ip,
      );

      if (!allowed) {
        // Call onLimitReached callback if provided
        if (rateLimitOptions.onLimitReached) {
          rateLimitOptions.onLimitReached(request);
        }

        // Log rate limit exceeded
        this.logger.warn(`Rate limit exceeded for key: ${key}`, {
          key,
          endpoint: request.path,
          method: request.method,
          ip: request.ip,
          userAgent: request.get('User-Agent'),
          userId: request['user']?.id,
          totalHits: info.totalHits,
          maxRequests: config.maxRequests,
          resetTime: info.resetTime,
        });

        throw new RateLimitException(
          config.message,
          Math.ceil((info.resetTime.getTime() - Date.now()) / 1000),
        );
      }

      return true;
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      this.logger.error('Rate limiting check failed', error);
      // Fail open - allow request if rate limiting service is down
      return true;
    }
  }

  private getRateLimitOptions(context: ExecutionContext): RateLimitOptions | null {
    // Check method-level decorator first
    const methodOptions = this.reflector.get<RateLimitOptions>(
      RATE_LIMIT_KEY,
      context.getHandler(),
    );

    if (methodOptions) {
      return methodOptions;
    }

    // Check class-level decorator
    const classOptions = this.reflector.get<RateLimitOptions>(
      RATE_LIMIT_KEY,
      context.getClass(),
    );

    return classOptions || null;
  }

  private generateRateLimitKey(request: Request, options: RateLimitOptions): string {
    if (options.keyGenerator) {
      return options.keyGenerator(request);
    }

    // Default key generation strategy
    const endpoint = request.path;
    const method = request.method;
    
    // Use different strategies based on endpoint sensitivity
    if (this.isAuthEndpoint(endpoint)) {
      // For auth endpoints, use IP + user agent for stricter limiting
      return this.rateLimitService.generateKey(request, 'auth');
    } else if (this.isUserSpecificEndpoint(endpoint)) {
      // For user-specific endpoints, use user ID if available
      const userId = request['user']?.id;
      if (userId) {
        return `user:${userId}:${method}:${endpoint}`;
      }
    }

    // Default: IP-based limiting
    return this.rateLimitService.generateEndpointKey(request, endpoint, method);
  }

  private setRateLimitHeaders(response: Response, info: any, config: RateLimitConfig): void {
    if (config.standardHeaders) {
      // Standard rate limit headers (draft RFC)
      response.setHeader('RateLimit-Limit', config.maxRequests);
      response.setHeader('RateLimit-Remaining', Math.max(0, info.remaining));
      response.setHeader('RateLimit-Reset', Math.ceil(info.resetTime.getTime() / 1000));
      response.setHeader('RateLimit-Policy', `${config.maxRequests};w=${Math.ceil(config.windowMs / 1000)}`);
    }

    if (config.legacyHeaders) {
      // Legacy X-RateLimit headers
      response.setHeader('X-RateLimit-Limit', config.maxRequests);
      response.setHeader('X-RateLimit-Remaining', Math.max(0, info.remaining));
      response.setHeader('X-RateLimit-Reset', Math.ceil(info.resetTime.getTime() / 1000));
    }

    // Always set Retry-After header when rate limited
    if (info.remaining <= 0) {
      const retryAfter = Math.ceil((info.resetTime.getTime() - Date.now()) / 1000);
      response.setHeader('Retry-After', retryAfter);
    }
  }

  private isAuthEndpoint(endpoint: string): boolean {
    const authEndpoints = ['/auth/login', '/auth/register', '/auth/forgot-password', '/auth/reset-password'];
    return authEndpoints.some(authEndpoint => endpoint.includes(authEndpoint));
  }

  private isUserSpecificEndpoint(endpoint: string): boolean {
    const userEndpoints = ['/enhanced-links', '/bio-pages', '/analytics', '/profile'];
    return userEndpoints.some(userEndpoint => endpoint.includes(userEndpoint));
  }
}

/**
 * Predefined rate limit configurations for common scenarios
 */
export const RateLimitPresets = {
  // Authentication endpoints - very strict
  AUTH: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 5,
    message: 'Too many authentication attempts. Please try again later.',
  },

  // Link creation - moderate
  LINK_CREATION: {
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 100,
    message: 'Link creation rate limit exceeded. Please try again later.',
  },

  // Analytics - generous for dashboards
  ANALYTICS: {
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 1000,
    message: 'Analytics request rate limit exceeded.',
  },

  // General API - balanced
  GENERAL: {
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 500,
    message: 'API rate limit exceeded. Please try again later.',
  },

  // Public endpoints - more restrictive
  PUBLIC: {
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 200,
    message: 'Public API rate limit exceeded.',
  },

  // Bulk operations - very restrictive
  BULK_OPERATIONS: {
    windowMs: 60 * 60 * 1000, // 1 hour
    maxRequests: 10,
    message: 'Bulk operation rate limit exceeded. Please try again later.',
  },
};
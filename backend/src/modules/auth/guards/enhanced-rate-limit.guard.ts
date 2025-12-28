import { Injectable, CanActivate, ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';
import { RateLimitingService } from '../services/rate-limiting.service';

export const RATE_LIMIT_KEY = 'rate_limit';

export interface RateLimitOptions {
  configName?: string;
  keyGenerator?: (req: Request) => string;
  skipIf?: (req: Request) => boolean;
  onLimitReached?: (req: Request, res: Response) => void;
}

export const RateLimit = (options: RateLimitOptions = {}) => {
  return Reflect.metadata(RATE_LIMIT_KEY, options);
};

@Injectable()
export class EnhancedRateLimitGuard implements CanActivate {
  constructor(
    private readonly rateLimitingService: RateLimitingService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    // Get rate limit options from decorator
    const options = this.reflector.getAllAndOverride<RateLimitOptions>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!options) {
      return true; // No rate limiting configured
    }

    // Check if request should be skipped
    if (options.skipIf && options.skipIf(request)) {
      return true;
    }

    // Generate rate limit key
    const key = options.keyGenerator 
      ? options.keyGenerator(request)
      : this.generateDefaultKey(request);

    const configName = options.configName || 'global';

    // Check rate limit
    const result = await this.rateLimitingService.checkRateLimit(key, configName);

    // Set rate limit headers
    this.setRateLimitHeaders(response, result, configName);

    if (!result.allowed) {
      // Call custom handler if provided
      if (options.onLimitReached) {
        options.onLimitReached(request, response);
      }

      const message = result.isBlocked 
        ? `You are temporarily blocked. Try again in ${Math.ceil(result.msBeforeNext / 60000)} minutes.`
        : `Rate limit exceeded. Try again in ${Math.ceil(result.msBeforeNext / 1000)} seconds.`;

      throw new HttpException({
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        message,
        error: 'Too Many Requests',
        retryAfter: Math.ceil(result.msBeforeNext / 1000),
      }, HttpStatus.TOO_MANY_REQUESTS);
    }

    return true;
  }

  private generateDefaultKey(request: Request): string {
    // Use user ID if authenticated, otherwise use IP
    const user = (request as any).user;
    if (user && user.id) {
      return `user:${user.id}`;
    }

    // Get real IP address
    const forwarded = request.headers['x-forwarded-for'] as string;
    const ip = forwarded ? forwarded.split(',')[0].trim() : request.ip;
    
    return `ip:${ip}`;
  }

  private setRateLimitHeaders(response: Response, result: any, configName: string): void {
    const config = this.rateLimitingService.getConfig(configName);
    
    if (config) {
      response.setHeader('X-RateLimit-Limit', config.maxRequests);
      response.setHeader('X-RateLimit-Remaining', Math.max(0, result.remainingPoints));
      response.setHeader('X-RateLimit-Reset', new Date(Date.now() + result.msBeforeNext).toISOString());
      response.setHeader('X-RateLimit-Window', config.windowMs);
    }

    if (result.isBlocked) {
      response.setHeader('X-RateLimit-Blocked', 'true');
      response.setHeader('Retry-After', Math.ceil(result.msBeforeNext / 1000));
    }
  }
}